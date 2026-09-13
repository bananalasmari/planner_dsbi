'use strict';

require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleClickUpRequest } = require('./api/clickup');

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

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url.startsWith('/api/clickup')) {
    handleClickUpRequest(req, res);
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
  const configured = !!(process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_TOKEN);
  console.log(`خُطّة running on http://localhost:${PORT}`);
  console.log(`ClickUp token: ${configured ? 'loaded from environment' : 'missing — add CLICKUP_API_TOKEN to .env'}`);
});
