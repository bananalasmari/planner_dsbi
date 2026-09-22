(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KhuttaJiraClient = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_BASE = '/api/jira';
  const DEFAULT_API_ORIGIN = 'http://127.0.0.1:3456';
  const STATIC_PREVIEW_PORTS = new Set(['5500', '5501', '5502', '5173', '8080', '3000']);

  function isStaticPreviewHost() {
    if (typeof window === 'undefined' || !window.location) return false;
    if (window.location.protocol === 'file:') return true;
    return STATIC_PREVIEW_PORTS.has(String(window.location.port || ''));
  }

  function resolveBase() {
    if (typeof window !== 'undefined' && window.KHUTTA_JIRA_API) {
      return String(window.KHUTTA_JIRA_API).replace(/\/$/, '');
    }
    if (isStaticPreviewHost()) {
      const origin = (typeof window !== 'undefined' && window.KHUTTA_API_ORIGIN)
        ? String(window.KHUTTA_API_ORIGIN).replace(/\/$/, '')
        : DEFAULT_API_ORIGIN;
      return origin + DEFAULT_BASE;
    }
    return DEFAULT_BASE;
  }

  async function request(path, options) {
    const base = resolveBase();
    let res;
    try {
      res = await fetch(base + path, {
        method: (options && options.method) || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: options && options.body != null ? JSON.stringify(options.body) : undefined
      });
    } catch (_err) {
      const error = new Error('ما قدرنا نوصل لخادم خُطّة. شغّل التطبيق عبر npm start حتى يتم جلب طلبات Jira بدون كشف التوكن.');
      error.code = 'NETWORK';
      throw error;
    }
    let data = {};
    try {
      data = await res.json();
    } catch (_err) {
      data = {};
    }
    if (!res.ok) {
      const error = new Error(data.message || data.error || 'تعذر إكمال طلب Jira.');
      error.status = res.status;
      error.code = data.error || '';
      error.payload = data;
      throw error;
    }
    return data;
  }

  return {
    health() {
      return request('/health');
    },
    listIssues(options) {
      const force = options && options.force;
      return request(force ? '/issues?refresh=1' : '/issues');
    }
  };
});
