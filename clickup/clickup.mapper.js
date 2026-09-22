(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./clickup.types'));
  } else {
    root.KhuttaClickUpMapper = factory(root.KhuttaClickUpTypes || {});
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (types) {
  'use strict';

  const KIND = (types && types.NODE_KIND) || {
    PLAN: 'plan',
    SPRINT: 'sprint',
    SCOPE: 'scope',
    PHASE: 'phase',
    MILESTONE: 'milestone'
  };

  function slug(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\u0600-\u06ff-]/g, '')
      .slice(0, 80) || 'item';
  }

  function isIsoDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
  }

  function pickDate(value, fallback) {
    const next = String(value || '').trim();
    if (isIsoDate(next)) return next;
    const fb = String(fallback || '').trim();
    return isIsoDate(fb) ? fb : '';
  }

  function minDate(dates) {
    const valid = dates.filter(isIsoDate).sort();
    return valid[0] || '';
  }

  function maxDate(dates) {
    const valid = dates.filter(isIsoDate).sort();
    return valid[valid.length - 1] || '';
  }

  function line(label, value) {
    if (value == null || value === '') return '';
    return `- **${label}:** ${value}`;
  }

  function listBlock(title, items) {
    const rows = (items || []).map(item => String(item || '').trim()).filter(Boolean);
    if (!rows.length) return '';
    return `### ${title}\n${rows.map(row => `- ${row}`).join('\n')}`;
  }

  function formatMembers(members) {
    if (!Array.isArray(members) || !members.length) return '';
    return members.map(name => String(name || '').trim()).filter(Boolean).join(', ');
  }

  function buildDescription(plan) {
    const source = plan && typeof plan === 'object' ? plan : {};
    const headerLines = [
      '',
      line('اسم الخطة', source.planName),
      line('اسم المنتج', source.productName || source.projectName),
      line('Scope', source.scopeName || source.projectName || source.productName),
      line('رقم الطلب', source.ticketId),
      line('عدد المميزات', source.includeFeatures && source.featureCount != null ? String(source.featureCount) : ''),
      line('Sprint', Array.isArray(source.sprintLabels) && source.sprintLabels.length
        ? source.sprintLabels.join(', ')
        : source.sprintLabel),
      line('Notes', source.notes || source.dependencies)
    ].filter(Boolean);

    const taskLines = (source.tasks || [])
      .filter(task => task && task.kind !== 'phase')
      .map(task => {
        const dates = [task.startDate, task.dueDate].filter(isIsoDate).join(' → ');
        const feats = source.includeFeatures && task.features ? ` · ${task.features} features` : '';
        return `${task.name}${dates ? ` (${dates})` : ''}${feats}`;
      });

    const phaseLines = [
      ...((source.phases || []).map(phase => phase.name)),
      ...((source.tasks || []).filter(task => task && task.kind === 'phase').map(task => task.name))
    ].filter(Boolean);

    const milestoneLines = (source.milestones || []).map(item => item.name || item).filter(Boolean);

    const detailBlocks = [
      listBlock('Milestones', milestoneLines),
      listBlock('Sprints', Array.isArray(source.sprintLabels) && source.sprintLabels.length
        ? source.sprintLabels
        : (source.sprintLabel ? [source.sprintLabel] : [])),
      listBlock('Phases', phaseLines),
      listBlock('Dependencies', source.dependencies ? [source.dependencies] : []),
      listBlock('Tasks', taskLines)
    ].filter(Boolean);

    return [...headerLines, ...(detailBlocks.length ? ['', ...detailBlocks] : [])].join('\n').trim();
  }

  function toTaskNode(task, plan, index) {
    const name = String((task && task.name) || '').trim();
    const kind = (task && task.kind) || KIND.SCOPE;
    const key = (task && task.key) || `${kind}:${slug(name)}:${index}`;
    const startDate = pickDate(task && task.startDate, plan.startDate);
    const dueDate = pickDate(task && task.dueDate, plan.dueDate);
    const bits = [];
    if (plan.includeFeatures && task && task.features) bits.push(`Features: ${task.features}`);
    if (startDate || dueDate) bits.push(`Dates: ${startDate || 'TBD'} → ${dueDate || 'TBD'}`);
    const featureCount = task && Number(task.features) > 0
      ? Number(task.features)
      : null;
    return {
      key,
      name,
      kind,
      description: bits.join('\n'),
      startDate,
      dueDate,
      customFields: { features: featureCount },
      children: []
    };
  }

  function uniquePhaseNodes(plan) {
    const fromTasks = (plan.tasks || []).filter(task => task && task.kind === 'phase');
    const seen = new Set(fromTasks.map(task => slug(task.name)));
    const extras = (plan.phases || []).filter(phase => {
      const key = slug(phase.name || phase.text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(phase => ({
      key: `phase:${phase.id || slug(phase.name)}`,
      name: phase.name,
      kind: KIND.PHASE,
      startDate: phase.startDate,
      dueDate: phase.dueDate
    }));
    return [...fromTasks, ...extras];
  }

  /**
   * Converts a خُطّة snapshot into a ClickUp task tree.
   * Closest practical nesting:
   *   Parent project task (chosen in UI)
   *   └── Plan task (ticket + product)
   *       ├── Scope tasks
   *       └── Release phases
   * Sprint number stays in the description, not as its own task.
   */
  function planTaskName(plan) {
    const ticket = String((plan && plan.ticketId) || '').trim();
    const product = String((plan && (plan.productName || plan.projectName || plan.scopeName)) || '').trim();
    if (ticket && product) return `${ticket} ${product}`;
    if (ticket) return ticket;
    if (product) return product;
    return (plan && plan.planName) || 'Implementation Plan';
  }

  function toClickUpTree(plan) {
    const source = plan && typeof plan === 'object' ? plan : {};
    const scopeTasks = (source.tasks || []).filter(task => task && task.kind !== 'phase');
    const phaseTasks = uniquePhaseNodes(source);
    const scopeNodes = scopeTasks.map((task, i) => toTaskNode(task, source, i));
    const phaseNodes = phaseTasks.map((task, i) => toTaskNode(task, source, i));

    const children = [...scopeNodes, ...phaseNodes];

    const planFeatures = source.featureCount != null && Number(source.featureCount) >= 0
      ? Number(source.featureCount)
      : null;
    const sprintMatch = String(source.sprintLabel || '').match(/(\d+)/);
    const sprintNumber = sprintMatch ? Number(sprintMatch[1]) : null;
    return {
      key: 'plan',
      name: planTaskName(source),
      kind: KIND.PLAN,
      description: buildDescription(source),
      startDate: pickDate(source.startDate, ''),
      dueDate: pickDate(source.dueDate, ''),
      customFields: { features: planFeatures, sprints: sprintNumber },
      children
    };
  }

  function flattenTree(node, parentName) {
    const prefix = parentName && node.kind !== KIND.PLAN ? `${parentName} · ${node.name}` : node.name;
    const flat = [{ ...node, name: prefix, children: [] }];
    (node.children || []).forEach(child => {
      flat.push(...flattenTree(child, node.name));
    });
    return flat;
  }

  function dateToMillis(isoDate) {
    if (!isIsoDate(isoDate)) return null;
    const [y, m, d] = isoDate.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }

  function toTaskBody(node, parentId) {
    const body = {
      name: node.name,
      markdown_content: node.description || ''
    };
    if (parentId) body.parent = parentId;
    const start = dateToMillis(node.startDate);
    const due = dateToMillis(node.dueDate);
    if (start != null) {
      body.start_date = start;
      body.start_date_time = false;
    }
    if (due != null) {
      body.due_date = due;
      body.due_date_time = false;
    }
    return body;
  }

  return {
    slug,
    isIsoDate,
    pickDate,
    buildDescription,
    planTaskName,
    toClickUpTree,
    flattenTree,
    dateToMillis,
    toTaskBody
  };
});
