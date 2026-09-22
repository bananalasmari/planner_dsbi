'use strict';

const types = require('./clickup.types');
const mapper = require('./clickup.mapper');

const API_BASE = types.API_BASE || 'https://api.clickup.com/api/v2';

function getToken() {
  return String(process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_TOKEN || '').trim();
}

function isConfigured() {
  return !!getToken();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mapClickUpError(status, data) {
  const raw = (data && (data.err || data.error || data.ECODE || data.message)) || '';
  if (status === 401 || status === 403) {
    return 'توكن ClickUp غير صالح أو ما عنده صلاحية كافية. راجع CLICKUP_API_TOKEN.';
  }
  if (status === 404) {
    return 'ما لقينا المشروع أو المهمة في ClickUp. تأكد إن الـ Parent Task موجود.';
  }
  if (status === 429) {
    return 'ClickUp رفض الطلب مؤقتًا بسبب كثرة الطلبات. حاول بعد لحظات.';
  }
  if (/subtask|nested|parent/i.test(String(raw))) {
    return 'هيكلة المهام المتداخلة غير مسموحة في مساحة ClickUp هذه.';
  }
  if (raw) return `ClickUp: ${raw}`;
  return `تعذر التواصل مع ClickUp (رمز ${status}).`;
}

function isNestingError(err) {
  const text = `${err && err.message} ${JSON.stringify((err && err.payload) || {})}`;
  return /subtask|nested|parent|SUBTASK|NEST/i.test(text);
}

async function clickupFetch(pathname, { method = 'GET', body } = {}, attempt = 0) {
  const token = getToken();
  if (!token) {
    const err = new Error('لم يتم ضبط CLICKUP_API_TOKEN على الخادم. أضفه في ملف .env ثم أعد تشغيل السيرفر.');
    err.code = 'TOKEN_MISSING';
    err.status = 500;
    throw err;
  }
  const res = await fetch(API_BASE + pathname, {
    method,
    headers: {
      Authorization: token,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_err) {
    data = { err: text };
  }
  if (res.status === 429 && attempt < 4) {
    const headerWait = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(headerWait) && headerWait > 0
      ? headerWait * 1000
      : 200 * Math.pow(2, attempt);
    await sleep(waitMs);
    return clickupFetch(pathname, { method, body }, attempt + 1);
  }
  if (!res.ok) {
    const err = new Error(mapClickUpError(res.status, data));
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

async function mapLimit(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const results = new Array(list.length);
  let cursor = 0;
  const workers = Math.min(Math.max(1, limit), list.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(list[index], index);
    }
  }));
  return results;
}

function toProject(task) {
  if (!task || !task.id) return null;
  return {
    id: String(task.id),
    name: task.name || 'بدون اسم',
    listId: task.list && task.list.id ? String(task.list.id) : '',
    url: task.url || `https://app.clickup.com/t/${task.id}`
  };
}

async function getTask(taskId) {
  return clickupFetch(`/task/${encodeURIComponent(taskId)}`);
}

async function inferTeamId() {
  const configured = String(process.env.CLICKUP_TEAM_ID || '').trim();
  if (configured) return configured;
  const data = await clickupFetch('/team');
  const teams = (data && data.teams) || [];
  if (!teams.length) {
    const err = new Error('ما لقينا أي Workspace مرتبط بالتوكن.');
    err.status = 400;
    throw err;
  }
  return String(teams[0].id);
}

async function listTopLevelFromList(listId) {
  const out = [];
  let page = 0;
  while (page < 10) {
    const qs = new URLSearchParams({
      page: String(page),
      subtasks: 'false',
      include_closed: 'false'
    });
    const data = await clickupFetch(`/list/${encodeURIComponent(listId)}/task?${qs}`);
    const tasks = (data && data.tasks) || [];
    tasks.forEach(task => {
      if (!task.parent) {
        const project = toProject(task);
        if (project) out.push(project);
      }
    });
    if (tasks.length < 100) break;
    page += 1;
  }
  return out;
}

async function listTopLevelFromTeam(teamId) {
  const out = [];
  let page = 0;
  const listId = String(process.env.CLICKUP_LIST_ID || '').trim();
  const spaceId = String(process.env.CLICKUP_SPACE_ID || '').trim();
  while (page < 10) {
    const qs = new URLSearchParams({
      page: String(page),
      subtasks: 'false',
      include_closed: 'false'
    });
    if (spaceId) qs.append('space_ids[]', spaceId);
    if (listId) qs.append('list_ids[]', listId);
    const data = await clickupFetch(`/team/${encodeURIComponent(teamId)}/task?${qs}`);
    const tasks = (data && data.tasks) || [];
    tasks.forEach(task => {
      if (!task.parent) {
        const project = toProject(task);
        if (project) out.push(project);
      }
    });
    if (tasks.length < 100) break;
    page += 1;
  }
  return out;
}

async function listParentProjects() {
  const pinned = String(process.env.CLICKUP_PARENT_TASK_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
  if (pinned.length) {
    const projects = [];
    for (const id of pinned) {
      const task = await getTask(id);
      const project = toProject(task);
      if (project) projects.push(project);
    }
    return projects;
  }
  const listId = String(process.env.CLICKUP_LIST_ID || '').trim();
  const spaceId = String(process.env.CLICKUP_SPACE_ID || '').trim();
  if (listId && !spaceId) return listTopLevelFromList(listId);
  const teamId = await inferTeamId();
  return listTopLevelFromTeam(teamId);
}

async function createTask(listId, body) {
  return clickupFetch(`/list/${encodeURIComponent(listId)}/task`, {
    method: 'POST',
    body
  });
}

async function updateTask(taskId, body) {
  const payload = { ...body };
  delete payload.parent;
  return clickupFetch(`/task/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    body: payload
  });
}

function safePdfName(name) {
  const raw = String(name || 'Khutta-Plan.pdf').trim() || 'Khutta-Plan.pdf';
  const cleaned = raw.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 120);
  return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}

function decodePdfAttachment(pdf) {
  if (!pdf || !pdf.contentBase64) return null;
  const raw = String(pdf.contentBase64).replace(/\s+/g, '');
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) {
    const err = new Error('ملف PDF فارغ، ما قدرنا نرفقه.');
    err.status = 400;
    throw err;
  }
  if (buffer.length > 50 * 1024 * 1024) {
    const err = new Error('ملف PDF أكبر من المسموح (50MB).');
    err.status = 400;
    throw err;
  }
  return {
    filename: safePdfName(pdf.filename),
    buffer,
    mimeType: pdf.mimeType || 'application/pdf'
  };
}

async function attachPdf(taskId, pdf) {
  const file = decodePdfAttachment(pdf);
  if (!file) return null;
  const token = getToken();
  const form = new FormData();
  form.append(
    'attachment',
    new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }),
    file.filename
  );
  const res = await fetch(`${API_BASE}/task/${encodeURIComponent(taskId)}/attachment`, {
    method: 'POST',
    headers: { Authorization: token },
    body: form
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_err) {
    data = { err: text };
  }
  if (!res.ok) {
    const err = new Error(mapClickUpError(res.status, data) || 'تعذر إرفاق ملف PDF في ClickUp.');
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return {
    id: data && (data.id || (data.attachment && data.attachment.id)) || '',
    title: (data && (data.title || data.name)) || file.filename,
    url: data && (data.url || data.href) || ''
  };
}

function childMapFromBinding(existing) {
  const map = Object.create(null);
  const rows = (existing && Array.isArray(existing.children)) ? existing.children : [];
  rows.forEach(row => {
    if (row && row.key && row.taskId) map[row.key] = String(row.taskId);
  });
  return map;
}

function normalizeFieldName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, '');
}

async function listCustomFields(listId) {
  const data = await clickupFetch(`/list/${encodeURIComponent(listId)}/field`);
  return (data && data.fields) || [];
}

function resolveFeaturesField(fields) {
  const configured = String(process.env.CLICKUP_FEATURES_FIELD_ID || '').trim();
  if (configured) {
    const match = (fields || []).find(field => String(field.id) === configured);
    if (match) return match;
    return { id: configured, name: 'Features', type: 'number' };
  }
  return (fields || []).find(field => {
    const name = normalizeFieldName(field.name);
    return name === 'features' || name === 'فيتشرز';
  }) || null;
}

async function setCustomField(taskId, fieldId, value) {
  return clickupFetch(`/task/${encodeURIComponent(taskId)}/field/${encodeURIComponent(fieldId)}`, {
    method: 'POST',
    body: { value }
  });
}

function resolveSprintsField(fields) {
  return (fields || []).find(field => {
    const name = normalizeFieldName(field.name);
    return name === 'sprints' || name === 'sprint';
  }) || null;
}

async function applyNumberField(taskId, field, raw) {
  if (!taskId || !field || raw == null || raw === '') return;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return;
  await setCustomField(taskId, field.id, value);
}

async function applyFeaturesField(taskId, node, featuresField) {
  if (!node || !node.customFields) return;
  await applyNumberField(taskId, featuresField, node.customFields.features);
}

async function upsertNode(listId, parentId, node, childMap) {
  const existingId = childMap[node.key];
  const body = mapper.toTaskBody(node, existingId ? undefined : parentId);
  return existingId
    ? updateTask(existingId, body)
    : createTask(listId, body);
}

async function syncPlanSubtasks({ listId, planTaskId, nodes, childMap, featuresField }) {
  const queue = (nodes || []).filter(node => String((node && node.name) || '').trim());
  // Large plans: skip per-task Features custom-field writes (root still gets them) to stay under gateway limits.
  const writeChildFeatures = queue.length <= 20 && !!featuresField;
  return mapLimit(queue, 6, async (node) => {
    const name = String(node.name || '').trim();
    const created = await upsertNode(listId, planTaskId, node, childMap);
    if (writeChildFeatures) {
      await applyFeaturesField(created.id, node, featuresField).catch(() => null);
    }
    return {
      key: node.key,
      taskId: String(created.id),
      name: created.name || name
    };
  });
}

async function sendPlan({ plan, parentTaskId, existing, pdf }) {
  if (!parentTaskId && !(existing && existing.taskId && existing.parentTaskId)) {
    const err = new Error('اختر مشروع ClickUp قبل الإرسال.');
    err.status = 400;
    throw err;
  }
  const parentId = String(parentTaskId || existing.parentTaskId);
  const parent = await getTask(parentId);
  const listId = parent && parent.list && parent.list.id;
  if (!listId) {
    const err = new Error('ما قدرنا نحدد الـ List للمشروع المختار في ClickUp.');
    err.status = 400;
    throw err;
  }

  const tree = mapper.toClickUpTree(plan);
  const childMap = childMapFromBinding(existing);
  const customFields = await listCustomFields(listId);
  const featuresField = resolveFeaturesField(customFields);
  const sprintsField = resolveSprintsField(customFields);
  const itemNodes = (tree.children || []).filter(node => String((node && node.name) || '').trim());

  async function createPlanTask() {
    return createTask(listId, mapper.toTaskBody(tree, parentId));
  }

  async function applyPlanFields(taskId) {
    await applyFeaturesField(taskId, tree, featuresField);
    await applyNumberField(taskId, sprintsField, tree.customFields && tree.customFields.sprints);
  }

  let root;
  if (existing && existing.taskId) {
    root = await updateTask(existing.taskId, mapper.toTaskBody(tree));
  } else {
    root = await createPlanTask();
  }

  // Run fields, subtasks, and PDF together — sequential calls were hitting the 26–30s Lambda limit
  // after ClickUp already had the plan, so the UI never saw success.
  const fieldsPromise = applyPlanFields(root.id).catch(() => null);
  const pdfPromise = (pdf && pdf.contentBase64)
    ? attachPdf(root.id, pdf).catch(() => null)
    : Promise.resolve(null);

  let children = [];
  try {
    const [, synced, attachment] = await Promise.all([
      fieldsPromise,
      syncPlanSubtasks({
        listId,
        planTaskId: root.id,
        nodes: itemNodes,
        childMap,
        featuresField
      }),
      pdfPromise
    ]);
    children = synced;
    return {
      taskId: String(root.id),
      url: root.url || `https://app.clickup.com/t/${root.id}`,
      parentTaskId: parentId,
      parentTaskName: parent.name || '',
      listId: String(listId),
      lastSyncedAt: new Date().toISOString(),
      children,
      attachment
    };
  } catch (err) {
    if (!isNestingError(err)) {
      await pdfPromise.catch(() => null);
      throw err;
    }
    // If plan → item nesting is blocked, attach البنود directly under the project.
    const [attachment, synced] = await Promise.all([
      pdfPromise,
      syncPlanSubtasks({
        listId,
        planTaskId: parentId,
        nodes: itemNodes,
        childMap: {},
        featuresField
      })
    ]);
    children = synced;
    return {
      taskId: String(root.id),
      url: root.url || `https://app.clickup.com/t/${root.id}`,
      parentTaskId: parentId,
      parentTaskName: parent.name || '',
      listId: String(listId),
      lastSyncedAt: new Date().toISOString(),
      children,
      attachment
    };
  }
}

module.exports = {
  isConfigured,
  listParentProjects,
  sendPlan,
  getTask,
  attachPdfToTask: attachPdf
};
