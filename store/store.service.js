'use strict';

const fs = require('fs');
const path = require('path');
const cryptoUtil = require('./store.crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PLANS_DIR = path.join(DATA_DIR, 'plans');

function ensureLocalDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PLANS_DIR)) fs.mkdirSync(PLANS_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8');
}

function readJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (_err) {
    return fallback;
  }
}

function writeJsonFile(file, value) {
  ensureLocalDirs();
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function useNetlifyBlobs() {
  return !!(process.env.NETLIFY || process.env.NETLIFY_DEV || process.env.NETLIFY_BLOBS_CONTEXT);
}

async function getBlobStore(name) {
  const { getStore } = require('@netlify/blobs');
  return getStore({ name, consistency: 'strong' });
}

async function listUsers() {
  if (useNetlifyBlobs()) {
    const store = await getBlobStore('khutta-users');
    const listed = await store.list();
    const users = [];
    for (const blob of listed.blobs || []) {
      const user = await store.get(blob.key, { type: 'json' });
      if (user && user.id) users.push(user);
    }
    return users;
  }
  ensureLocalDirs();
  const users = readJsonFile(USERS_FILE, []);
  return Array.isArray(users) ? users : [];
}

async function saveUser(user) {
  if (!user || !user.id || !user.email) {
    const err = new Error('بيانات المستخدم غير مكتملة.');
    err.status = 400;
    throw err;
  }
  if (useNetlifyBlobs()) {
    const store = await getBlobStore('khutta-users');
    await store.setJSON(user.email, user);
    await store.setJSON(`id:${user.id}`, { email: user.email });
    return user;
  }
  const users = await listUsers();
  const idx = users.findIndex(item => item.id === user.id || item.email === user.email);
  if (idx >= 0) users[idx] = user;
  else users.push(user);
  writeJsonFile(USERS_FILE, users);
  return user;
}

async function findUserByEmail(email) {
  const needle = String(email || '').trim().toLowerCase();
  if (!needle) return null;
  if (useNetlifyBlobs()) {
    const store = await getBlobStore('khutta-users');
    return (await store.get(needle, { type: 'json' })) || null;
  }
  const users = await listUsers();
  return users.find(user => user.email === needle) || null;
}

async function findUserById(id) {
  const userId = String(id || '').trim();
  if (!userId) return null;
  if (useNetlifyBlobs()) {
    const store = await getBlobStore('khutta-users');
    const pointer = await store.get(`id:${userId}`, { type: 'json' });
    if (!pointer || !pointer.email) return null;
    return (await store.get(pointer.email, { type: 'json' })) || null;
  }
  const users = await listUsers();
  return users.find(user => user.id === userId) || null;
}

function plansFileFor(userId) {
  return path.join(PLANS_DIR, `${userId}.json`);
}

async function getPlans(userId) {
  const id = String(userId || '').trim();
  if (!id) return [];
  if (useNetlifyBlobs()) {
    const store = await getBlobStore('khutta-plans');
    const plans = await store.get(id, { type: 'json' });
    return Array.isArray(plans) ? plans : [];
  }
  ensureLocalDirs();
  const plans = readJsonFile(plansFileFor(id), []);
  return Array.isArray(plans) ? plans : [];
}

async function savePlans(userId, plans) {
  const id = String(userId || '').trim();
  if (!id) {
    const err = new Error('معرّف المستخدم مطلوب.');
    err.status = 400;
    throw err;
  }
  const list = Array.isArray(plans) ? plans : [];
  if (useNetlifyBlobs()) {
    const store = await getBlobStore('khutta-plans');
    await store.setJSON(id, list);
    return list;
  }
  writeJsonFile(plansFileFor(id), list);
  return list;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email
  };
}

async function register({ name, email, password }) {
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanName) {
    const err = new Error('اكتب اسمك');
    err.status = 400;
    throw err;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    const err = new Error('الإيميل غير صحيح');
    err.status = 400;
    throw err;
  }
  if (String(password || '').length < 6) {
    const err = new Error('كلمة المرور لازم 6 خانات على الأقل');
    err.status = 400;
    throw err;
  }
  if (await findUserByEmail(cleanEmail)) {
    const err = new Error('هذا الإيميل مسجّل مسبقًا');
    err.status = 409;
    throw err;
  }
  const { salt, passwordHash } = cryptoUtil.hashPassword(password);
  const user = {
    id: cryptoUtil.randomId('usr'),
    name: cleanName,
    email: cleanEmail,
    passwordHash,
    salt,
    createdAt: new Date().toISOString()
  };
  await saveUser(user);
  const token = cryptoUtil.signToken({ userId: user.id, email: user.email });
  return { token, user: publicUser(user) };
}

async function login({ email, password }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const user = await findUserByEmail(cleanEmail);
  if (!user || !cryptoUtil.verifyPassword(password, user.salt, user.passwordHash)) {
    const err = new Error('الإيميل أو كلمة المرور غير صحيحة');
    err.status = 401;
    throw err;
  }
  const token = cryptoUtil.signToken({ userId: user.id, email: user.email });
  return { token, user: publicUser(user) };
}

async function me(token) {
  const payload = cryptoUtil.verifyToken(token);
  if (!payload) {
    const err = new Error('انتهت الجلسة. سجّل دخولك مرة ثانية.');
    err.status = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  const user = await findUserById(payload.userId);
  if (!user) {
    const err = new Error('الحساب غير موجود.');
    err.status = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  return publicUser(user);
}

async function requireUser(token) {
  const user = await me(token);
  return user;
}

async function listPlansForToken(token) {
  const user = await requireUser(token);
  const plans = await getPlans(user.id);
  return { user, plans };
}

async function putPlansForToken(token, plans) {
  const user = await requireUser(token);
  const saved = await savePlans(user.id, plans);
  return { user, plans: saved };
}

module.exports = {
  register,
  login,
  me,
  listPlansForToken,
  putPlansForToken,
  verifyToken: cryptoUtil.verifyToken
};
