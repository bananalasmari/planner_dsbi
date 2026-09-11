'use strict';

const clickupService = require('../clickup/clickup.service');

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(status).json(body);
    return;
  }
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_err) {
    const error = new Error('بيانات الإرسال غير صالحة.');
    error.status = 400;
    throw error;
  }
}

function routeNameFromPath(pathname, search) {
  const fromPath = String(pathname || '')
    .replace(/^\/\.netlify\/functions\/clickup\/?/, '')
    .replace(/^\/api\/clickup\/?/, '')
    .replace(/\/$/, '');
  const params = new URLSearchParams(search || '');
  return fromPath || params.get('action') || '';
}

function routeName(req) {
  const host = (req.headers && req.headers.host) || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  return routeNameFromPath(url.pathname, url.search);
}

async function handleClickUpEvent({ method, route, body }) {
  const verb = String(method || 'GET').toUpperCase();
  const action = String(route || '').replace(/\/$/, '');

  if (verb === 'OPTIONS') {
    return { status: 204, body: {} };
  }

  if ((action === 'health' || action === '') && verb === 'GET') {
    return {
      status: 200,
      body: {
        ok: true,
        configured: clickupService.isConfigured()
      }
    };
  }

  if (action === 'projects' && verb === 'GET') {
    if (!clickupService.isConfigured()) {
      return {
        status: 500,
        body: {
          error: 'not_configured',
          message: 'لم يتم ضبط CLICKUP_API_TOKEN على الخادم. أضفه في Environment Variables ثم أعد النشر.'
        }
      };
    }
    const projects = await clickupService.listParentProjects();
    return { status: 200, body: { projects } };
  }

  if (action === 'send' && verb === 'POST') {
    if (!clickupService.isConfigured()) {
      return {
        status: 500,
        body: {
          error: 'not_configured',
          message: 'لم يتم ضبط CLICKUP_API_TOKEN على الخادم. أضفه في Environment Variables ثم أعد النشر.'
        }
      };
    }
    const payload = body && typeof body === 'object' ? body : {};
    const result = await clickupService.sendPlan({
      plan: payload.plan,
      parentTaskId: payload.parentTaskId,
      existing: payload.existing || null,
      pdf: payload.pdf || null
    });
    return { status: 200, body: result };
  }

  return {
    status: 404,
    body: {
      error: 'not_found',
      message: 'مسار ClickUp غير معروف.'
    }
  };
}

async function handleClickUpRequest(req, res) {
  try {
    const body = String(req.method || '').toUpperCase() === 'POST'
      ? await readJsonBody(req)
      : {};
    const result = await handleClickUpEvent({
      method: req.method,
      route: routeName(req),
      body
    });
    sendJson(res, result.status, result.body);
  } catch (err) {
    const status = Number(err && err.status) || (err && err.code === 'TOKEN_MISSING' ? 500 : 500);
    sendJson(res, status, {
      error: (err && err.code) || 'clickup_error',
      message: (err && err.message) || 'تعذر إكمال طلب ClickUp.'
    });
  }
}

module.exports = handleClickUpRequest;
module.exports.handleClickUpRequest = handleClickUpRequest;
module.exports.handleClickUpEvent = handleClickUpEvent;
module.exports.routeNameFromPath = routeNameFromPath;
