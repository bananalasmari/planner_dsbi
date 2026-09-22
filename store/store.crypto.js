'use strict';

const crypto = require('crypto');

function secret() {
  return String(process.env.STORE_SECRET || process.env.KHUTTA_STORE_SECRET || 'khutta-dev-secret-change-me').trim();
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function hashPassword(password, salt) {
  const usedSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password || ''), usedSalt, 32).toString('hex');
  return { salt: usedSalt, passwordHash: hash };
}

function verifyPassword(password, salt, passwordHash) {
  if (!salt || !passwordHash) return false;
  const next = crypto.scryptSync(String(password || ''), String(salt), 32).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(next, 'hex'), Buffer.from(String(passwordHash), 'hex'));
  } catch (_err) {
    return false;
  }
}

function signToken(payload, ttlSeconds = 60 * 60 * 24 * 60) {
  const body = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = crypto.createHmac('sha256', secret()).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!body || !body.userId || !body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch (_err) {
    return null;
  }
}

module.exports = {
  randomId,
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken
};
