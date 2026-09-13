(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KhuttaClickUpClient = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_BASE = '/api/clickup';

  function resolveBase() {
    if (typeof window !== 'undefined' && window.KHUTTA_CLICKUP_API) {
      return String(window.KHUTTA_CLICKUP_API).replace(/\/$/, '');
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
      const error = new Error('ما قدرنا نوصل لخادم خُطّة. شغّل التطبيق عبر npm start حتى يتم الإرسال بدون كشف التوكن.');
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
      const error = new Error(data.message || data.error || 'تعذر إكمال طلب ClickUp.');
      error.status = res.status;
      error.payload = data;
      throw error;
    }
    return data;
  }

  return {
    health() {
      return request('/health');
    },
    listProjects() {
      return request('/projects');
    },
    sendPlan(payload) {
      return request('/send', { method: 'POST', body: payload });
    }
  };
});
