'use strict';

require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleClickUpRequest } = require('./api/clickup');
const { handleJiraRequest } = require('./api/jira');
const { handleStoreRequest } = require('./api/store');

const PORT = Number(process.env.PORT) || 3456;
const ROOT = __dirname;
const INDEX = 'frontend-plan-generator_24.html';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
  const rel = decoded === '/' ? INDEX : decoded.replace(/^\/+/, '');
  const resolved = path.normalize(path.join(root, rel));
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

function sendFile(res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

function setApiCors(req, res) {
  const origin = (req.headers && req.headers.origin) || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url.startsWith('/api/')) {
    setApiCors(req, res);
    if (String(req.method || '').toUpperCase() === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
  }
  if (url.startsWith('/api/clickup')) {
    handleClickUpRequest(req, res);
    return;
  }
  if (url.startsWith('/api/jira')) {
    handleJiraRequest(req, res);
    return;
  }
  if (url.startsWith('/api/store')) {
    handleStoreRequest(req, res);
    return;
  }
  const filePath = safeJoin(ROOT, url);
  if (!filePath) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }
  sendFile(res, filePath);
});

server.listen(PORT, () => {
  const clickupConfigured = !!(process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_TOKEN);
  const jiraConfigured = !!(
    process.env.JIRA_BASE_URL &&
    (process.env.JIRA_API_TOKEN || process.env.JIRA_TOKEN) &&
    (process.env.JIRA_USERNAME || process.env.JIRA_EMAIL)
  );
  console.log(`خُطّة running on http://localhost:${PORT}`);
  console.log(`ClickUp token: ${clickupConfigured ? 'loaded from environment' : 'missing — add CLICKUP_API_TOKEN to .env'}`);
  console.log(`Jira token: ${jiraConfigured ? 'loaded from environment' : 'missing — add JIRA_* vars to .env'}`);
  console.log('Cloud store: /api/store (users + plans)');
});
