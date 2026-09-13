(function (root) {
  'use strict';

  const client = root.KhuttaJiraClient;
  let bridge = null;
  let issuesCache = [];
  let selection = { jiraKey: '', productName: '' };
  let loading = false;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    if (bridge && typeof bridge.escapeHtml === 'function') return bridge.escapeHtml(value);
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatIssueLabel(issue) {
    const key = issue && issue.jiraKey ? issue.jiraKey : '';
    const product = issue && issue.productName ? issue.productName : '—';
    return `${key} — ${product}`;
  }

  function setStatus(message, type) {
    const el = $('jiraStatus');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'jira-status' + (type ? ' is-' + type : '');
  }

  function updateTrigger() {
    const trigger = $('jiraTriggerText');
    if (!trigger) return;
    if (selection.jiraKey) {
      trigger.textContent = formatIssueLabel(selection);
      return;
    }
    trigger.textContent = 'ابحث برقم الطلب أو اسم المنتج';
  }

  function closePanel() {
    const multiselect = $('jiraMultiselect');
    if (multiselect) multiselect.classList.remove('open');
  }

  function applySelection(issue) {
    selection = {
      jiraKey: issue && issue.jiraKey ? String(issue.jiraKey) : '',
      productName: issue && issue.productName ? String(issue.productName) : ''
    };
    updateTrigger();
    closePanel();
    if (bridge && typeof bridge.applySelection === 'function') {
      bridge.applySelection({ ...selection });
    }
  }

  function restoreSelection(saved) {
    const next = saved && saved.jiraKey
      ? { jiraKey: String(saved.jiraKey), productName: String(saved.productName || '') }
      : { jiraKey: '', productName: '' };
    selection = next;
    updateTrigger();
  }

  function renderIssueList() {
    const list = $('jiraList');
    const search = $('jiraSearch');
    if (!list) return;

    const query = String((search && search.value) || '').trim().toLowerCase();
    const filtered = (issuesCache || []).filter(issue => {
      if (!query) return true;
      const key = String(issue.jiraKey || '').toLowerCase();
      const product = String(issue.productName || '').toLowerCase();
      return key.includes(query) || product.includes(query);
    });

    if (!filtered.length) {
      list.innerHTML = '<div class="multiselect-empty">لا توجد طلبات مطابقة</div>';
      return;
    }

    list.innerHTML = filtered.map(issue => {
      const active = selection.jiraKey && selection.jiraKey === issue.jiraKey ? ' is-active' : '';
      return `<button type="button" class="multiselect-item jira-item${active}" data-key="${escapeHtml(issue.jiraKey)}">${escapeHtml(formatIssueLabel(issue))}</button>`;
    }).join('');

    list.querySelectorAll('.jira-item').forEach(item => {
      item.addEventListener('click', () => {
        const key = item.getAttribute('data-key');
        const issue = issuesCache.find(row => row.jiraKey === key);
        if (issue) applySelection(issue);
      });
    });
  }

  function setRefreshBusy(isBusy) {
    const btn = $('jiraRefreshBtn');
    loading = !!isBusy;
    if (!btn) return;
    btn.disabled = !!isBusy;
    btn.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  }

  async function loadIssues({ force } = {}) {
    if (!client) {
      setStatus('تعذر تحميل عميل Jira.', 'error');
      return;
    }
    if (loading) return;
    setRefreshBusy(true);
    setStatus('جاري جلب الطلبات من Jira…', 'progress');
    try {
      const data = await client.listIssues({ force: !!force });
      issuesCache = Array.isArray(data.issues) ? data.issues : [];
      renderIssueList();
      setStatus(issuesCache.length ? `تم جلب ${issuesCache.length} طلبًا مفتوحًا.` : 'لا توجد طلبات مفتوحة في Queue.', issuesCache.length ? '' : 'error');
      if (force && selection.jiraKey) {
        const stillExists = issuesCache.some(issue => issue.jiraKey === selection.jiraKey);
        if (!stillExists) {
          selection = { jiraKey: '', productName: '' };
          updateTrigger();
        }
      }
    } catch (err) {
      issuesCache = [];
      renderIssueList();
      const rateLimited = (err && err.status === 429) ||
        (err && err.payload && err.payload.error === 'RATE_LIMIT');
      setStatus(
        rateLimited
          ? 'Jira رفض الطلب مؤقتًا بسبب كثرة الطلبات. انتظر دقيقة ثم اضغط تحديث.'
          : ((err && err.message) || 'تعذر جلب طلبات Jira.'),
        'error'
      );
    } finally {
      setRefreshBusy(false);
    }
  }

  function bindEvents() {
    const multiselect = $('jiraMultiselect');
    const trigger = $('jiraTrigger');
    const search = $('jiraSearch');
    const refreshBtn = $('jiraRefreshBtn');

    if (trigger && multiselect) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        multiselect.classList.toggle('open');
        if (multiselect.classList.contains('open')) {
          renderIssueList();
          if (search) {
            search.value = '';
            search.focus();
          }
        }
      });
    }

    if (search) {
      search.addEventListener('click', (e) => e.stopPropagation());
      search.addEventListener('input', renderIssueList);
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => loadIssues({ force: true }));
    }

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#jiraMultiselect')) closePanel();
    });
  }

  root.KhuttaJiraUI = {
    init(options) {
      bridge = options || null;
      bindEvents();
      if (bridge && bridge.getSavedSelection) {
        restoreSelection(bridge.getSavedSelection());
      }
      updateTrigger();
      loadIssues();
    },
    refresh() {
      return loadIssues({ force: true });
    },
    getSelection() {
      return { ...selection };
    },
    setSelection(saved) {
      restoreSelection(saved);
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
