'use strict';

const jiraService = require('../jira/jira.service');

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
    .replace(/^\/\.netlify\/functions\/jira\/?/, '')
    .replace(/^\/api\/jira\/?/, '')
    .replace(/\/$/, '');
  const params = new URLSearchParams(search || '');
  return fromPath || params.get('action') || '';
}

function routeName(req) {
  const host = (req.headers && req.headers.host) || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  return routeNameFromPath(url.pathname, url.search);
}

async function handleJiraEvent({ method, route, refresh }) {
  const verb = String(method || 'GET').toUpperCase();
  const action = String(route || '').replace(/\/$/, '');

  if (verb === 'OPTIONS') {
    return { status: 204, body: {} };
  }

  if ((action === 'health' || action === '') && verb === 'GET') {
    if (!jiraService.isConfigured()) {
      return {
        status: 200,
        body: {
          ok: true,
          configured: false
        }
      };
    }
    const health = await jiraService.getHealth();
    return { status: 200, body: health };
  }

  if (action === 'issues' && verb === 'GET') {
    if (!jiraService.isConfigured()) {
      return {
        status: 500,
        body: {
          error: 'not_configured',
          message: 'لم يتم ضبط JIRA_BASE_URL و JIRA_EMAIL و JIRA_API_TOKEN على الخادم.'
        }
      };
    }
    const issues = await jiraService.listQueueIssues({ force: !!refresh });
    return { status: 200, body: { issues } };
  }

  if (action === 'fields' && verb === 'GET') {
    if (!jiraService.isConfigured()) {
      return {
        status: 500,
        body: {
          error: 'not_configured',
          message: 'لم يتم ضبط JIRA_BASE_URL و JIRA_EMAIL و JIRA_API_TOKEN على الخادم.'
        }
      };
    }
    const fields = await jiraService.listFieldMetadata();
    return { status: 200, body: fields };
  }

  return {
    status: 404,
    body: {
      error: 'not_found',
      message: 'مسار Jira غير معروف.'
    }
  };
}

async function handleJiraRequest(req, res) {
  try {
    const host = (req.headers && req.headers.host) || 'localhost';
    const url = new URL(req.url, `http://${host}`);
    const result = await handleJiraEvent({
      method: req.method,
      route: routeName(req),
      refresh: url.searchParams.get('refresh') === '1'
    });
    sendJson(res, result.status, result.body);
  } catch (err) {
    const status = Number(err && err.status) || 500;
    sendJson(res, status, {
      error: (err && err.code) || 'jira_error',
      message: (err && err.message) || 'تعذر إكمال طلب Jira.'
    });
  }
}

module.exports = handleJiraRequest;
module.exports.handleJiraRequest = handleJiraRequest;
module.exports.handleJiraEvent = handleJiraEvent;
module.exports.routeNameFromPath = routeNameFromPath;
