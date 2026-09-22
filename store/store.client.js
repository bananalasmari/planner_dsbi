(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KhuttaStoreClient = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_BASE = '/api/store';
  const DEFAULT_API_ORIGIN = 'http://127.0.0.1:3456';
  const STATIC_PREVIEW_PORTS = new Set(['5500', '5501', '5502', '5173', '8080', '3000']);

  function isStaticPreviewHost() {
    if (typeof window === 'undefined' || !window.location) return false;
    if (window.location.protocol === 'file:') return true;
    const port = String(window.location.port || '');
    return STATIC_PREVIEW_PORTS.has(port);
  }

  function resolveApiOrigin() {
    if (typeof window !== 'undefined' && window.KHUTTA_API_ORIGIN) {
      return String(window.KHUTTA_API_ORIGIN).replace(/\/$/, '');
    }
    return DEFAULT_API_ORIGIN;
  }

  function resolveBase() {
    if (typeof window !== 'undefined' && window.KHUTTA_STORE_API) {
      return String(window.KHUTTA_STORE_API).replace(/\/$/, '');
    }
    // Live Server / static preview has no POST /api — talk to local Node server.
    if (isStaticPreviewHost()) {
      return resolveApiOrigin() + DEFAULT_BASE;
    }
    return DEFAULT_BASE;
  }

  async function request(path, options) {
    const base = resolveBase();
    const headers = { 'Content-Type': 'application/json' };
    if (options && options.token) {
      headers.Authorization = 'Bearer ' + options.token;
    }
    let res;
    try {
      res = await fetch(base + path, {
        method: (options && options.method) || 'GET',
        headers,
        body: options && options.body != null ? JSON.stringify(options.body) : undefined
      });
    } catch (_err) {
      const error = new Error(
        isStaticPreviewHost()
          ? 'ما قدرنا نوصل لسيرفر خُطّة على المنفذ 3456. شغّلي من الطرفية: npm start ثم جرّبي مرة ثانية.'
          : 'ما قدرنا نوصل لسيرفر خُطّة. تأكد إن التطبيق شغال أو إن النشر جاهز.'
      );
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
      let message = data.message || data.error || 'تعذر إكمال طلب التخزين.';
      if (res.status === 405) {
        message = 'الصفحة مفتوحة عبر معاينة ثابتة بدون API. شغّلي npm start وافتحي http://localhost:3456';
      }
      const error = new Error(message);
      error.status = res.status;
      error.code = data.error || 'store_error';
      error.payload = data;
      throw error;
    }
    return data;
  }

  return {
    health() {
      return request('/health');
    },
    register(payload) {
      return request('/register', { method: 'POST', body: payload });
    },
    login(payload) {
      return request('/login', { method: 'POST', body: payload });
    },
    me(token) {
      return request('/me', { token });
    },
    getPlans(token) {
      return request('/plans', { token });
    },
    putPlans(token, plans) {
      return request('/plans', { method: 'PUT', token, body: { plans: plans || [] } });
    }
  };
});
