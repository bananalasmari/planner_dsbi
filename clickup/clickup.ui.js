(function (root) {
  'use strict';

  const client = root.KhuttaClickUpClient;
  let bridge = null;
  let projectsCache = null;
  let sending = false;

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

  function binding() {
    return bridge && typeof bridge.getBinding === 'function' ? bridge.getBinding() : null;
  }

  function setStatus(message, type) {
    const el = $('clickupStatus');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'clickup-status' + (type ? ' is-' + type : '');
  }

  function setBusy(isBusy) {
    const overlay = $('clickupOverlay');
    const submit = $('clickupSubmitBtn');
    const select = $('clickupParentSelect');
    if (overlay) overlay.classList.toggle('is-busy', !!isBusy);
    if (submit) submit.disabled = !!isBusy;
    if (select) select.disabled = !!isBusy;
  }

  function syncToolbar() {
    const sendBtn = $('clickupSendBtn');
    const openBtn = $('clickupOpenBtn');
    if (!sendBtn) return;
    const ready = !!(bridge && bridge.isReady && bridge.isReady());
    const link = binding();
    sendBtn.hidden = !ready;
    sendBtn.disabled = !ready;
    sendBtn.textContent = link && link.taskId ? 'تحديث خطة ClickUp' : 'إرسال إلى ClickUp';
    if (openBtn) {
      if (link && (link.url || link.taskId)) {
        openBtn.hidden = false;
        openBtn.href = link.url || ('https://app.clickup.com/t/' + link.taskId);
      } else {
        openBtn.hidden = true;
        openBtn.removeAttribute('href');
      }
    }
  }

  function renderProjects(projects, selectedId) {
    const select = $('clickupParentSelect');
    if (!select) return;
    const rows = Array.isArray(projects) ? projects : [];
    if (!rows.length) {
      select.innerHTML = '<option value="">لا توجد مهام رئيسية في ClickUp</option>';
      return;
    }
    const current = selectedId || (binding() && binding().parentTaskId) || '';
    select.innerHTML = ['<option value="">اختر المشروع</option>']
      .concat(rows.map(project => {
        const selected = String(project.id) === String(current) ? ' selected' : '';
        return `<option value="${escapeHtml(project.id)}"${selected}>${escapeHtml(project.name)}</option>`;
      }))
      .join('');
  }

  function selectedParentId() {
    const select = $('clickupParentSelect');
    return (select && select.value) || '';
  }

  function willUpdateExisting(parentTaskId) {
    const link = binding();
    return !!(link && link.taskId && parentTaskId && String(link.parentTaskId) === String(parentTaskId));
  }

  function syncSubmitLabel() {
    const submit = $('clickupSubmitBtn');
    const title = $('clickupModalTitle');
    const parentTaskId = selectedParentId();
    const updating = willUpdateExisting(parentTaskId);
    if (submit) submit.textContent = updating ? 'تحديث الخطة' : 'إرسال الخطة';
    if (title) title.textContent = updating ? 'تحديث خطة ClickUp' : 'إرسال إلى ClickUp';
  }

  function showFormState() {
    const form = $('clickupFormState');
    const success = $('clickupSuccessState');
    if (form) form.hidden = false;
    if (success) success.hidden = true;
  }

  function showSuccessState(result) {
    const form = $('clickupFormState');
    const success = $('clickupSuccessState');
    const open = $('clickupOpenCreated');
    const title = $('clickupSuccessTitle');
    if (form) form.hidden = true;
    if (success) success.hidden = false;
    if (title) {
      title.textContent = result && result.updated
        ? 'تم تحديث خطة ClickUp بنجاح'
        : 'تم إرسال الخطة إلى ClickUp بنجاح';
    }
    const note = $('clickupSuccessNote');
    if (note) {
      note.hidden = !(result && result.attachment);
      note.textContent = result && result.attachment ? 'وتم إرفاق ملف PDF الخطة في المهمة.' : '';
    }
    if (open && result && (result.url || result.taskId)) {
      open.href = result.url || ('https://app.clickup.com/t/' + result.taskId);
    }
  }

  async function loadProjects() {
    const select = $('clickupParentSelect');
    if (select) {
      select.innerHTML = '<option value="">جاري تحميل المشاريع…</option>';
      select.disabled = true;
    }
    setStatus('');
    try {
      const health = await client.health();
      if (!health.configured) {
        throw new Error('لم يتم ضبط CLICKUP_API_TOKEN على الخادم. أضفه في ملف .env ثم أعد تشغيل السيرفر.');
      }
      const data = await client.listProjects();
      projectsCache = data.projects || [];
      renderProjects(projectsCache);
      if (!projectsCache.length) {
        setStatus('ما لقينا مهام رئيسية في ClickUp. تأكد إن المشاريع موجودة كـ Tasks.', 'error');
      }
    } catch (err) {
      projectsCache = [];
      if (select) select.innerHTML = '<option value="">تعذر تحميل المشاريع</option>';
      setStatus(err.message || 'تعذر تحميل مشاريع ClickUp.', 'error');
    } finally {
      if (select) select.disabled = false;
    }
  }

  function openModal() {
    if (!bridge || !bridge.isReady || !bridge.isReady()) return;
    const overlay = $('clickupOverlay');
    if (!overlay) return;
    const link = binding();
    const parentField = $('clickupParentField');
    const linkedNote = $('clickupLinkedNote');
    showFormState();
    setStatus('');
    if (parentField) parentField.hidden = false;
    if (linkedNote) {
      if (link && link.taskId) {
        linkedNote.hidden = false;
        linkedNote.textContent = link.parentTaskName
          ? `آخر إرسال كان لمشروع: ${link.parentTaskName}. تقدرين تختارين نفس المشروع للتحديث، أو مشروع ثاني لإرسال جديد.`
          : 'تقدرين تختارين مشروع ClickUp في كل مرة: نفس المشروع يحدّث المهمة، ومشروع ثاني ينشئ إرسال جديد.';
      } else {
        linkedNote.hidden = true;
      }
    }
    syncSubmitLabel();
    overlay.classList.add('open');
    loadProjects().then(syncSubmitLabel);
  }

  function closeModal() {
    const overlay = $('clickupOverlay');
    if (overlay) overlay.classList.remove('open');
    sending = false;
    setBusy(false);
  }

  async function submitPlan() {
    if (sending) return;
    const link = binding();
    const parentTaskId = selectedParentId();
    if (!parentTaskId) {
      setStatus('اختر مشروع ClickUp قبل الإرسال.', 'error');
      return;
    }
    const updating = willUpdateExisting(parentTaskId);
    const plan = bridge.collectPlan();
    if (!plan || !(plan.tasks && plan.tasks.length) && !plan.planName) {
      setStatus('ولّد الخطة أولًا ثم أرسلها إلى ClickUp.', 'error');
      return;
    }
    sending = true;
    setBusy(true);
    setStatus('جاري تجهيز ملف PDF للخطة…', 'progress');
    try {
      if (!bridge.buildPdf) {
        throw new Error('ما قدرنا نجهّز ملف PDF من الخطة الحالية.');
      }
      const pdf = await bridge.buildPdf();
      setStatus('جاري إرسال الخطة إلى ClickUp…', 'progress');
      const result = await client.sendPlan({
        plan,
        parentTaskId,
        existing: updating ? link : null,
        pdf
      });
      if (bridge.saveBinding) bridge.saveBinding(result);
      result.updated = updating;
      syncToolbar();
      showSuccessState(result);
      setStatus('');
    } catch (err) {
      setStatus(err.message || 'تعذر إرسال الخطة إلى ClickUp.', 'error');
    } finally {
      sending = false;
      setBusy(false);
    }
  }

  function bindEvents() {
    const sendBtn = $('clickupSendBtn');
    const closeBtn = $('clickupClose');
    const overlay = $('clickupOverlay');
    const submit = $('clickupSubmitBtn');
    const done = $('clickupDoneBtn');
    if (sendBtn) sendBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (done) done.addEventListener('click', closeModal);
    if (submit) submit.addEventListener('click', submitPlan);
    const select = $('clickupParentSelect');
    if (select) select.addEventListener('change', syncSubmitLabel);
    if (overlay) {
      overlay.addEventListener('click', event => {
        if (event.target.id === 'clickupOverlay') closeModal();
      });
    }
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && overlay && overlay.classList.contains('open')) closeModal();
    });
  }

  root.KhuttaClickUpUI = {
    init(nextBridge) {
      bridge = nextBridge || {};
      bindEvents();
      syncToolbar();
    },
    sync: syncToolbar,
    open: openModal,
    close: closeModal
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
