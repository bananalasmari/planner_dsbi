(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KhuttaClickUpClient = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_BASE = '/api/clickup';
  const DEFAULT_API_ORIGIN = 'http://127.0.0.1:3456';
  const STATIC_PREVIEW_PORTS = new Set(['5500', '5501', '5502', '5173', '8080', '3000']);

  function isStaticPreviewHost() {
    if (typeof window === 'undefined' || !window.location) return false;
    if (window.location.protocol === 'file:') return true;
    return STATIC_PREVIEW_PORTS.has(String(window.location.port || ''));
  }

  function resolveBase() {
    if (typeof window !== 'undefined' && window.KHUTTA_CLICKUP_API) {
      return String(window.KHUTTA_CLICKUP_API).replace(/\/$/, '');
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
      const error = new Error('ما قدرنا نوصل لخادم خُطّة. شغّل التطبيق عبر npm start حتى يتم الإرسال بدون كشف التوكن.');
      error.code = 'NETWORK';
      throw error;
    }
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_err) {
      data = { raw: text };
    }
    if (!res.ok) {
      const rawMessage = data.message || data.errorMessage || data.error || '';
      const blob = `${rawMessage}\n${text || ''}`;
      const timedOut = data.errorType === 'Sandbox.Timedout'
        || res.status === 504
        || res.status === 502
        || res.status === 408
        || /timed?\s*out/i.test(blob)
        || /inactivity\s*timeout/i.test(blob)
        || /too much time has passed without sending any data/i.test(blob);
      if (timedOut) {
        const error = new Error(
          'الإرسال أخذ وقت أطول من المتوقع. غالبًا وصلت الخطة لـ ClickUp — تأكد هناك قبل ما تعيد الإرسال عشان ما تتكرر.'
        );
        error.code = 'TIMEOUT';
        error.status = res.status;
        error.payload = data;
        error.likelySent = true;
        throw error;
      }
      const error = new Error(rawMessage || 'تعذر إكمال طلب ClickUp.');
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
    },
    attachPdf(payload) {
      return request('/attach', { method: 'POST', body: payload });
    }
  };
});
