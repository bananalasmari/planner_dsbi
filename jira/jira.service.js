'use strict';

const types = require('./jira.types');

let cachedProductNameFieldId = null;
let cachedQueueJql = null;
let cachedIssues = { at: 0, rows: [] };
let authVerified = false;

const ISSUES_CACHE_MS = 30000;
const MAX_FETCH_RETRIES = 3;

function sanitizeToken(raw) {
  return String(raw || '')
    .trim()
    .replace(/^plan\s+jira\s*:\s*/i, '')
    .trim();
}

function normalizeFieldLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function getConfig() {
  const email = String(process.env.JIRA_EMAIL || '').trim();
  const username = String(process.env.JIRA_USERNAME || '').trim();
  return {
    baseUrl: String(process.env.JIRA_BASE_URL || '').replace(/\/+$/, ''),
    email,
    username,
    authUser: username || email,
    token: sanitizeToken(process.env.JIRA_API_TOKEN || process.env.JIRA_TOKEN || ''),
    queueId: String(process.env.JIRA_QUEUE_ID || types.DEFAULT_QUEUE_ID).trim(),
    queueName: String(process.env.JIRA_QUEUE_NAME || types.DEFAULT_QUEUE_NAME).trim(),
    serviceDeskId: String(process.env.JIRA_SERVICE_DESK_ID || '').trim(),
    queueJql: String(process.env.JIRA_QUEUE_JQL || '').trim(),
    productNameFieldId: String(process.env.JIRA_PRODUCT_NAME_FIELD_ID || '').trim(),
    projectKey: String(process.env.JIRA_PROJECT_KEY || types.DEFAULT_PROJECT_KEY).trim()
  };
}

function isConfigured() {
  const config = getConfig();
  if (!config.baseUrl || !config.token) return false;
  if (isDataCenterHost(config.baseUrl)) return true;
  return !!config.authUser;
}

function isDataCenterHost(baseUrl) {
  return !/atlassian\.net/i.test(String(baseUrl || ''));
}

function apiRoot(config) {
  return isDataCenterHost(config.baseUrl) ? '/rest/api/2' : '/rest/api/3';
}

function assertAuthConfig(config) {
  if (!config.token || /\s/.test(config.token)) {
    const err = new Error('JIRA_API_TOKEN غير صحيح. انسخ التوكن فقط بدون نص إضافي مثل "plan jira:".');
    err.code = 'AUTH_CONFIG';
    err.status = 500;
    throw err;
  }
  if (isDataCenterHost(config.baseUrl)) return;
  if (!config.authUser) {
    const err = new Error('أضف JIRA_EMAIL لـ Atlassian Cloud في .env.');
    err.code = 'AUTH_CONFIG';
    err.status = 500;
    throw err;
  }
  if (/your-email@|example\.com|@company\.com$/i.test(config.email)) {
    const err = new Error('JIRA_EMAIL غير صحيح. ضع إيميل حساب Atlassian الفعلي في .env.');
    err.code = 'AUTH_CONFIG';
    err.status = 500;
    throw err;
  }
}

function isProductNameField(field) {
  if (!field) return false;
  const wanted = types.PRODUCT_NAME_ALIASES.map(normalizeFieldLabel);
  const labels = [field.name, field.untranslatedName, field.key]
    .map(normalizeFieldLabel)
    .filter(Boolean);
  return labels.some(label => wanted.includes(label) || label.includes('product name'));
}

function tokenFormatHint(config) {
  if (!config || !config.token) return '';
  if (isDataCenterHost(config.baseUrl)) return '';
  if (config.token.startsWith('ATATT') && config.token.length >= 80) return '';
  if (config.token.length < 80) {
    return ' التوكن الحالي قصير ولا يبدو API token من Atlassian — أنشئ token جديد من id.atlassian.com.';
  }
  return '';
}

function buildAuthHeaders(config) {
  if (isDataCenterHost(config.baseUrl)) {
    return { Authorization: `Bearer ${config.token}` };
  }
  const encoded = Buffer.from(`${config.authUser}:${config.token}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

async function ensureAuthenticated(config) {
  if (authVerified) return;
  assertAuthConfig(config);
  try {
    await jiraFetch(`${apiRoot(config)}/myself`, { skipAuthCheck: true });
    authVerified = true;
  } catch (_err) {
    const hint = tokenFormatHint(config);
    const dcHint = isDataCenterHost(config.baseUrl)
      ? ' لـ jira.elm.sa استخدم Personal Access Token من Profile → Personal Access Tokens. لا تستخدم curl -u؛ التوكن يُرسل كـ Bearer.'
      : ' لـ Atlassian Cloud استخدم JIRA_EMAIL + API token من id.atlassian.com.';
    const err = new Error(
      `تعذر تسجيل الدخول إلى Jira. راجع JIRA_BASE_URL و JIRA_API_TOKEN.${dcHint}${hint}`
    );
    err.code = 'AUTH_FAILED';
    err.status = 500;
    throw err;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mapJiraError(status, data) {
  const raw = (data && (data.errorMessages && data.errorMessages[0])) ||
    (data && data.message) ||
    (data && data.errors && Object.values(data.errors)[0]) ||
    '';
  if (status === 401 || status === 403) {
    return 'بيانات Jira غير صالحة أو بدون صلاحية كافية. راجع JIRA_EMAIL و JIRA_API_TOKEN.';
  }
  if (status === 404) {
    return 'لم نجد المورد المطلوب في Jira. راجع JIRA_BASE_URL أو إعدادات Queue.';
  }
  if (status === 429) {
    return 'Jira رفض الطلب مؤقتًا بسبب كثرة الطلبات. حاول بعد لحظات.';
  }
  if (raw) return `Jira: ${raw}`;
  return `تعذر التواصل مع Jira (رمز ${status}).`;
}

async function jiraFetch(pathname, options = {}, attempt = 0) {
  const config = getConfig();
  if (!isConfigured()) {
    const err = new Error('لم يتم ضبط JIRA_BASE_URL و JIRA_API_TOKEN على الخادم.');
    err.code = 'TOKEN_MISSING';
    err.status = 500;
    throw err;
  }
  if (!options.skipAuthCheck) {
    await ensureAuthenticated(config);
  }
  const url = pathname.startsWith('http') ? pathname : `${config.baseUrl}${pathname}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      ...buildAuthHeaders(config),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_err) {
    data = { message: text };
  }
  if (!res.ok) {
    if (res.status === 429 && attempt < MAX_FETCH_RETRIES) {
      await sleep(1200 * (attempt + 1));
      return jiraFetch(pathname, options, attempt + 1);
    }
    const err = new Error(mapJiraError(res.status, data));
    err.status = res.status;
    err.code = res.status === 429 ? 'RATE_LIMIT' : (err.code || 'jira_error');
    err.payload = data;
    throw err;
  }
  return data;
}

function extractProductName(fieldValue) {
  if (fieldValue == null || fieldValue === '') return '';
  if (typeof fieldValue === 'string') return fieldValue.trim();
  if (Array.isArray(fieldValue)) {
    return fieldValue.map(extractProductName).filter(Boolean).join(', ');
  }
  if (typeof fieldValue === 'object') {
    if (fieldValue.value != null && fieldValue.value !== '') return String(fieldValue.value).trim();
    if (fieldValue.name != null && fieldValue.name !== '') return String(fieldValue.name).trim();
    if (fieldValue.displayName != null && fieldValue.displayName !== '') return String(fieldValue.displayName).trim();
  }
  return String(fieldValue).trim();
}

function mapIssue(issue, productFieldId) {
  const fields = (issue && issue.fields) || {};
  return {
    jiraKey: String(issue.key || '').trim(),
    productName: extractProductName(fields[productFieldId])
  };
}

function isClosedStatusCategory(statusCategory) {
  const key = statusCategory && statusCategory.key;
  return key === 'done';
}

function ensureOpenIssuesOnly(jql) {
  const trimmed = String(jql || '').trim();
  if (!trimmed) return `statusCategory != Done ORDER BY updated DESC`;
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('statuscategory') ||
    /\bstatus\s*(!=|not in|<)\b/.test(lower) ||
    lower.includes('resolution = unresolved') ||
    lower.includes('resolution is empty')
  ) {
    return trimmed;
  }
  if (/\border\s+by\b/i.test(trimmed)) {
    return trimmed.replace(/\border\s+by\b/i, 'AND statusCategory != Done ORDER BY');
  }
  return `${trimmed} AND statusCategory != Done`;
}

function findProductNameField(fields) {
  return (Array.isArray(fields) ? fields : []).find(isProductNameField) || null;
}

async function loadAllFields() {
  const config = getConfig();
  const root = apiRoot(config);
  const fields = await jiraFetch(`${root}/field`);
  if (Array.isArray(fields) && fields.length >= 50) {
    return fields;
  }

  if (!isDataCenterHost(config.baseUrl)) {
    try {
      const searched = await jiraFetch('/rest/api/3/field/search?query=Product&maxResults=50');
      const values = (searched && searched.values) || [];
      if (values.length) return values;
    } catch (_err) {
      // Continue to createmeta fallback.
    }
  }

  try {
    const meta = await jiraFetch(
      `${root}/issue/createmeta?projectKeys=${encodeURIComponent(config.projectKey)}&expand=projects.issuetypes.fields`
    );
    const collected = [];
    ((meta && meta.projects) || []).forEach(project => {
      (project.issuetypes || []).forEach(issueType => {
        Object.entries(issueType.fields || {}).forEach(([id, field]) => {
          collected.push({
            id,
            name: field.name,
            untranslatedName: field.name,
            custom: String(id).startsWith('customfield_')
          });
        });
      });
    });
    if (collected.length) return collected;
  } catch (_err) {
    // Fall through to whatever /field returned.
  }

  return Array.isArray(fields) ? fields : [];
}

async function resolveProductNameFieldId() {
  if (cachedProductNameFieldId) return cachedProductNameFieldId;
  const config = getConfig();
  if (config.productNameFieldId) {
    cachedProductNameFieldId = config.productNameFieldId;
    return cachedProductNameFieldId;
  }
  const fields = await loadAllFields();
  const match = findProductNameField(fields);
  if (!match || !match.id) {
    const err = new Error(
      `لم نجد حقل "${types.PRODUCT_NAME_FIELD_LABEL}" في Jira. تأكد من صلاحيات الحساب، أو أضف JIRA_PRODUCT_NAME_FIELD_ID=customfield_XXXXX في .env.`
    );
    err.code = 'FIELD_NOT_FOUND';
    err.status = 500;
    throw err;
  }
  cachedProductNameFieldId = match.id;
  return cachedProductNameFieldId;
}

async function listFieldMetadata() {
  const fields = await loadAllFields();
  const productField = findProductNameField(fields);
  return {
    productNameField: productField
      ? { id: productField.id, name: productField.name, custom: !!productField.custom }
      : null,
    totalFields: Array.isArray(fields) ? fields.length : 0
  };
}

async function discoverServiceDeskQueue(queueId, queueName) {
  const desks = await jiraFetch('/rest/servicedeskapi/servicedesk');
  const deskValues = (desks && desks.values) || [];
  for (const desk of deskValues) {
    const queues = await jiraFetch(`/rest/servicedeskapi/servicedesk/${desk.id}/queue`);
    const queueValues = (queues && queues.values) || [];
    const match = queueValues.find(queue =>
      String(queue.id) === String(queueId) ||
      String(queue.name || '').trim().toLowerCase() === String(queueName || '').trim().toLowerCase()
    );
    if (match) {
      return {
        serviceDeskId: String(desk.id),
        queueId: String(match.id),
        queueName: match.name || queueName,
        jql: match.jql || ''
      };
    }
  }
  return null;
}

async function resolveQueueJql(config) {
  if (cachedQueueJql) return cachedQueueJql;
  if (config.queueJql) {
    cachedQueueJql = config.queueJql;
    return cachedQueueJql;
  }

  if (isDataCenterHost(config.baseUrl) && !config.serviceDeskId) {
    cachedQueueJql = `project = ${config.projectKey} AND statusCategory != Done ORDER BY updated DESC`;
    return cachedQueueJql;
  }

  let serviceDeskId = config.serviceDeskId;
  let queueMeta = null;

  if (serviceDeskId && config.queueId) {
    try {
      queueMeta = await jiraFetch(`/rest/servicedeskapi/servicedesk/${serviceDeskId}/queue/${config.queueId}`);
    } catch (_err) {
      queueMeta = null;
    }
  }

  if (!queueMeta) {
    queueMeta = await discoverServiceDeskQueue(config.queueId, config.queueName);
    if (queueMeta && queueMeta.serviceDeskId) serviceDeskId = queueMeta.serviceDeskId;
  }

  if (queueMeta && queueMeta.jql) {
    cachedQueueJql = queueMeta.jql;
    return cachedQueueJql;
  }

  cachedQueueJql = `project = ${config.projectKey} AND statusCategory != Done ORDER BY updated DESC`;
  return cachedQueueJql;
}

async function searchIssuesByJqlV2(jql, productFieldId) {
  const issues = [];
  let startAt = 0;
  const pageSize = 100;
  const fieldList = ['key', productFieldId, 'status', 'statusCategory'];

  while (issues.length < types.MAX_ISSUES) {
    const params = new URLSearchParams({
      jql,
      startAt: String(startAt),
      maxResults: String(Math.min(pageSize, types.MAX_ISSUES - issues.length)),
      fields: fieldList.join(',')
    });
    const data = await jiraFetch(`/rest/api/2/search?${params.toString()}`);
    const batch = (data.issues || [])
      .filter(issue => !isClosedStatusCategory(issue.fields && issue.fields.statusCategory))
      .map(issue => mapIssue(issue, productFieldId))
      .filter(issue => issue.jiraKey);

    issues.push(...batch);
    if (startAt + pageSize >= (data.total || 0)) break;
    startAt += pageSize;
  }

  return issues.slice(0, types.MAX_ISSUES);
}

async function searchIssuesByJqlV3(jql, productFieldId) {
  const issues = [];
  let nextPageToken;
  const pageSize = 100;
  const fieldList = ['key', productFieldId, 'status', 'statusCategory'];

  while (issues.length < types.MAX_ISSUES) {
    const body = {
      jql,
      maxResults: Math.min(pageSize, types.MAX_ISSUES - issues.length),
      fields: fieldList
    };
    if (nextPageToken) body.nextPageToken = nextPageToken;

    const data = await jiraFetch('/rest/api/3/search/jql', { method: 'POST', body });
    const batch = (data.issues || [])
      .filter(issue => !isClosedStatusCategory(issue.fields && issue.fields.statusCategory))
      .map(issue => mapIssue(issue, productFieldId))
      .filter(issue => issue.jiraKey);

    issues.push(...batch);
    if (!data.nextPageToken || data.isLast) break;
    nextPageToken = data.nextPageToken;
  }

  return issues.slice(0, types.MAX_ISSUES);
}

async function searchIssuesByJql(jql, productFieldId) {
  const config = getConfig();
  if (isDataCenterHost(config.baseUrl)) {
    return searchIssuesByJqlV2(jql, productFieldId);
  }
  return searchIssuesByJqlV3(jql, productFieldId);
}

async function enrichIssuesWithProductName(issueKeys, productFieldId) {
  if (!issueKeys.length) return [];
  const chunks = [];
  for (let i = 0; i < issueKeys.length; i += 50) {
    chunks.push(issueKeys.slice(i, i + 50));
  }
  const rows = [];
  for (const chunk of chunks) {
    const jql = `key in (${chunk.map(key => `"${key}"`).join(', ')}) AND statusCategory != Done ORDER BY updated DESC`;
    rows.push(...await searchIssuesByJql(jql, productFieldId));
  }
  return rows;
}

async function listIssuesFromServiceDeskQueue(config, productFieldId) {
  const serviceDeskId = config.serviceDeskId;
  if (!serviceDeskId || !config.queueId) return null;

  const keys = [];
  let start = 0;
  const limit = 50;

  while (keys.length < types.MAX_ISSUES) {
    const data = await jiraFetch(
      `/rest/servicedeskapi/servicedesk/${serviceDeskId}/queue/${config.queueId}/issue?start=${start}&limit=${limit}`
    );
    const values = (data && data.values) || [];
    values.forEach(row => {
      const issue = row.issue || row;
      if (issue && issue.key) keys.push(String(issue.key));
    });
    if (data.isLastPage || values.length < limit) break;
    start += limit;
  }

  if (!keys.length) return [];
  return enrichIssuesWithProductName(keys.slice(0, types.MAX_ISSUES), productFieldId);
}

async function listQueueIssues(options = {}) {
  if (!options.force && cachedIssues.rows.length && Date.now() - cachedIssues.at < ISSUES_CACHE_MS) {
    return cachedIssues.rows.slice();
  }

  const config = getConfig();
  const productFieldId = await resolveProductNameFieldId();

  let serviceDeskId = config.serviceDeskId;
  if (!serviceDeskId && !isDataCenterHost(config.baseUrl)) {
    const discovered = await discoverServiceDeskQueue(config.queueId, config.queueName);
    if (discovered && discovered.serviceDeskId) {
      serviceDeskId = discovered.serviceDeskId;
      if (discovered.jql && !config.queueJql) cachedQueueJql = discovered.jql;
    }
  }

  if (serviceDeskId && config.queueId) {
    try {
      const fromQueue = await listIssuesFromServiceDeskQueue(
        { ...config, serviceDeskId },
        productFieldId
      );
      if (fromQueue && fromQueue.length) {
        return dedupeIssues(fromQueue);
      }
    } catch (_err) {
      // Fall back to JQL search below.
    }
  }

  const jql = ensureOpenIssuesOnly(await resolveQueueJql(config));
  const rows = dedupeIssues(await searchIssuesByJql(jql, productFieldId));
  cachedIssues = { at: Date.now(), rows };
  return rows.slice();
}

function dedupeIssues(issues) {
  const seen = new Set();
  const rows = [];
  (issues || []).forEach(issue => {
    if (!issue || !issue.jiraKey || seen.has(issue.jiraKey)) return;
    seen.add(issue.jiraKey);
    rows.push({
      jiraKey: issue.jiraKey,
      productName: issue.productName || ''
    });
  });
  return rows.sort((a, b) => {
    const numA = Number(String(a.jiraKey).split('-').pop()) || 0;
    const numB = Number(String(b.jiraKey).split('-').pop()) || 0;
    return numB - numA;
  });
}

async function getHealth() {
  const config = getConfig();
  const productFieldId = await resolveProductNameFieldId();
  const jql = ensureOpenIssuesOnly(await resolveQueueJql(config));
  return {
    ok: true,
    configured: isConfigured(),
    queueId: config.queueId,
    queueName: config.queueName,
    productNameFieldId: productFieldId,
    jql
  };
}

module.exports = {
  isConfigured,
  getConfig,
  resolveProductNameFieldId,
  listFieldMetadata,
  listQueueIssues,
  getHealth
};
