'use strict';

const storeService = require('../store/store.service');

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
    .replace(/^\/\.netlify\/functions\/store\/?/, '')
    .replace(/^\/api\/store\/?/, '')
    .replace(/\/$/, '');
  const params = new URLSearchParams(search || '');
  return fromPath || params.get('action') || '';
}

function routeName(req) {
  const host = (req.headers && req.headers.host) || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  return routeNameFromPath(url.pathname, url.search);
}

function getBearerToken(headers, body) {
  const auth = (headers && (headers.authorization || headers.Authorization)) || '';
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();
  if (body && body.token) return String(body.token).trim();
  return '';
}

async function handleStoreEvent({ method, route, body, headers }) {
  const verb = String(method || 'GET').toUpperCase();
  const action = String(route || '').replace(/\/$/, '');

  if (verb === 'OPTIONS') {
    return { status: 204, body: {} };
  }

  if ((action === 'health' || action === '') && verb === 'GET') {
    return {
      status: 200,
      body: { ok: true, cloud: true }
    };
  }

  if (action === 'register' && verb === 'POST') {
    const result = await storeService.register({
      name: body && body.name,
      email: body && body.email,
      password: body && body.password
    });
    return { status: 201, body: result };
  }

  if (action === 'login' && verb === 'POST') {
    const result = await storeService.login({
      email: body && body.email,
      password: body && body.password
    });
    return { status: 200, body: result };
  }

  if (action === 'me' && verb === 'GET') {
    const token = getBearerToken(headers, body);
    const user = await storeService.me(token);
    return { status: 200, body: { user } };
  }

  if (action === 'plans' && verb === 'GET') {
    const token = getBearerToken(headers, body);
    const result = await storeService.listPlansForToken(token);
    return { status: 200, body: result };
  }

  if (action === 'plans' && verb === 'PUT') {
    const token = getBearerToken(headers, body);
    const result = await storeService.putPlansForToken(token, body && body.plans);
    return { status: 200, body: result };
  }

  return {
    status: 404,
    body: {
      error: 'not_found',
      message: 'مسار التخزين غير معروف.'
    }
  };
}

async function handleStoreRequest(req, res) {
  try {
    const method = String(req.method || 'GET').toUpperCase();
    const body = method === 'POST' || method === 'PUT' || method === 'PATCH'
      ? await readJsonBody(req)
      : {};
    const result = await handleStoreEvent({
      method,
      route: routeName(req),
      body,
      headers: req.headers || {}
    });
    sendJson(res, result.status, result.body);
  } catch (err) {
    const status = Number(err && err.status) || 500;
    sendJson(res, status, {
      error: (err && err.code) || 'store_error',
      message: (err && err.message) || 'تعذر إكمال طلب التخزين.'
    });
  }
}

module.exports = handleStoreRequest;
module.exports.handleStoreRequest = handleStoreRequest;
module.exports.handleStoreEvent = handleStoreEvent;
module.exports.routeNameFromPath = routeNameFromPath;
