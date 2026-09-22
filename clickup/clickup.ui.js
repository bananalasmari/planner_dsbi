(function (root) {
  'use strict';

  const client = root.KhuttaClickUpClient;
  let bridge = null;
  let projectsCache = null;
  let sending = false;
  let submitDefaultLabel = '';

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
    const closeBtn = $('clickupClose');
    const toolbarSend = $('clickupSendBtn');
    const ready = !!(bridge && bridge.isReady && bridge.isReady());
    if (overlay) overlay.classList.toggle('is-busy', !!isBusy);
    if (submit) {
      if (isBusy) {
        if (!submitDefaultLabel) submitDefaultLabel = submit.textContent;
        submit.disabled = true;
        submit.textContent = 'جاري الإرسال…';
        submit.setAttribute('aria-busy', 'true');
      } else {
        submit.disabled = false;
        submit.removeAttribute('aria-busy');
        if (submitDefaultLabel) submit.textContent = submitDefaultLabel;
        submitDefaultLabel = '';
      }
    }
    if (select) select.disabled = !!isBusy;
    if (closeBtn) closeBtn.disabled = !!isBusy;
    if (toolbarSend) toolbarSend.disabled = !!isBusy || !ready;
  }

  function syncToolbar() {
    const sendBtn = $('clickupSendBtn');
    const openBtn = $('clickupOpenBtn');
    if (!sendBtn) return;
    const ready = !!(bridge && bridge.isReady && bridge.isReady());
    const link = binding();
    sendBtn.hidden = !ready;
    sendBtn.disabled = !ready;
    sendBtn.textContent = link && link.taskId ? 'حدّث في ClickUp' : 'أرسل إلى ClickUp';
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
    select.innerHTML = ['<option value="">— اختر المشروع —</option>']
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
    if (submit) submit.textContent = updating ? 'حدّث الخطة' : 'أرسل الخطة';
    if (title) title.textContent = updating ? 'حدّث خطتك في ClickUp' : 'أرسل خطتك لـ ClickUp';
  }

  function showFormState() {
    const form = $('clickupFormState');
    const success = $('clickupSuccessState');
    const modal = document.querySelector('#clickupOverlay .clickup-modal');
    if (form) form.hidden = false;
    if (success) success.hidden = true;
    if (modal) modal.classList.remove('is-success');
  }

  function showSuccessState(result) {
    const form = $('clickupFormState');
    const success = $('clickupSuccessState');
    const open = $('clickupOpenCreated');
    const title = $('clickupSuccessTitle');
    const modalTitle = $('clickupModalTitle');
    const modal = document.querySelector('#clickupOverlay .clickup-modal');
    if (form) form.hidden = true;
    if (success) success.hidden = false;
    if (modal) modal.classList.add('is-success');
    if (modalTitle) {
      // modalTitle.textContent = result && result.updated ? 'تم التحديث ✓' : 'تم بنجاح ✓';
    }
    if (title) {
      if (result && result.timedOut) {
        title.textContent = 'يبدو إن الخطة وصلت ClickUp';
      } else {
        title.textContent = result && result.updated
          ? 'تمام — حدّثنا خطتك في ClickUp'
          : 'تمام — خطتك صارت في ClickUp';
      }
    }
    const note = $('clickupSuccessNote');
    if (note) {
      if (result && result.timedOut) {
        note.hidden = false;
        note.textContent = 'الرد من الخادم تأخر، بس الإرسال غالبًا اكتمل. افتح ClickUp وتأكد قبل ما تعيد الإرسال.';
      } else {
        note.hidden = !(result && result.attachment);
        note.textContent = result && result.attachment
          ? 'ورفقنا PDF الخطة مع المهمة، تقدر تشوفه من هناك.'
          : 'خطتك جاهزة في ClickUp — تقدر تكمل المتابعة من هناك.';
        if (!(result && result.attachment)) note.hidden = false;
      }
    }
    if (open) {
      if (result && (result.url || result.taskId)) {
        open.href = result.url || ('https://app.clickup.com/t/' + result.taskId);
        open.hidden = false;
      } else if (result && result.timedOut) {
        open.href = 'https://app.clickup.com';
        open.hidden = false;
      } else {
        open.hidden = true;
        open.removeAttribute('href');
      }
    }
    const overlay = $('clickupOverlay');
    const submit = $('clickupSubmitBtn');
    if (overlay) overlay.classList.remove('is-busy');
    if (submit) submit.disabled = true;
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
        const onNetlify = typeof location !== 'undefined' && !/localhost|127\.0\.0\.1/.test(location.hostname);
        throw new Error(onNetlify
          ? 'لم يتم ضبط CLICKUP_API_TOKEN على Netlify. أضفه في Environment variables ثم أعد نشر الموقع.'
          : 'لم يتم ضبط CLICKUP_API_TOKEN على الخادم. أضفه في ملف .env ثم أعد تشغيل السيرفر.');
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
      if (select && !sending) select.disabled = false;
    }
  }

  function openModal() {
    if (sending) return;
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
          ? `آخر إرسال كان تحت «${link.parentTaskName}». نفس المشروع يحدّث اللي أرسلته، ومشروع ثاني يعني إرسال جديد.`
          : 'تقدر تختار مشروع ClickUp في كل مرة: نفس المشروع يحدّث المهمة، ومشروع ثاني يعني إرسال جديد.';
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
      setStatus('اختر المشروع أول، بعدين أرسل.', 'error');
      return;
    }
    const updating = willUpdateExisting(parentTaskId);
    const plan = bridge.collectPlan();
    if (!plan || !(plan.tasks && plan.tasks.length) && !plan.planName) {
      setStatus('ولّد الخطة أول، بعدين أرسلها.', 'error');
      return;
    }
    sending = true;
    setBusy(true);
    setStatus('نرسل خطتك لـ ClickUp…', 'progress');
    let succeeded = false;
    try {
      // Build PDF in parallel, but attach after tasks succeed — large PDF bodies were
      // triggering gateway "Inactivity Timeout" before the function could respond.
      const pdfPromise = bridge.buildPdf
        ? bridge.buildPdf().catch(() => null)
        : Promise.resolve(null);

      const result = await client.sendPlan({
        plan,
        parentTaskId,
        existing: updating ? link : null
      });
      if (bridge.saveBinding) bridge.saveBinding(result);
      result.updated = updating;
      syncToolbar();
      showSuccessState(result);
      setStatus('');
      succeeded = true;

      const pdf = await pdfPromise;
      if (pdf && result.taskId && client.attachPdf) {
        const note = $('clickupSuccessNote');
        if (note) {
          note.hidden = false;
          note.textContent = 'نرفق PDF الخطة…';
        }
        try {
          const attached = await client.attachPdf({ taskId: result.taskId, pdf });
          if (note) {
            note.textContent = attached && attached.attachment
              ? 'ورفقنا PDF الخطة مع المهمة، تقدر تشوفه من هناك.'
              : 'خطتك جاهزة في ClickUp — تقدر تكمل المتابعة من هناك.';
          }
        } catch (_err) {
          if (note) {
            note.textContent = 'الخطة وصلت ClickUp، لكن إرفاق PDF تأخر أو فشل. تقدر تنزّل PDF من الزر فوق.';
          }
        }
      }
    } catch (err) {
      if (err && (err.code === 'TIMEOUT' || err.likelySent)) {
        showSuccessState({ timedOut: true, updated: updating });
        setStatus('');
        succeeded = true;
      } else {
        setStatus(err.message || 'ما قدرنا نرسل الخطة لـ ClickUp.', 'error');
      }
    } finally {
      sending = false;
      setBusy(false);
      if (succeeded) {
        const submit = $('clickupSubmitBtn');
        if (submit) submit.disabled = true;
      }
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
