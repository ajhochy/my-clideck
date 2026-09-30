// Workflow plugin — toolbar button + panel UI
// API provided by CliDeck frontend loader (app.js):
//   api.send(event, data)          → sends to backend onFrontendMessage handler
//   api.onMessage(event, fn)       → receives from backend sendToFrontend
//   api.addToolbarButton(opts)     → returns DOM button element
//   api.getActiveSessionId()       → active session id (string | null)
//   api.toast(message, opts)       → show a toast notification

let _api = null;
let panelEl = null;
let visible = false;
let pendingResumables = null;
let lastWorkflows = []; // cached for re-render without round-tripping the server
let knownProjects = []; // cached list from backend; populated when the form opens
let selectedProjectId = null; // form-local selection (overrides dashboard's active project)
let pendingAddProject = null; // resolver for the in-flight projects.add round-trip
let expandedId = null;
let branchValidateTimer = null;
const agentOutput = new Map(); // workflowId -> tail string (capped)
const pendingDeletes = new Map(); // workflowId → { timeoutId, rowEl }

function ensureProgressStyles() {
  if (document.getElementById('wf-progress-styles')) return;
  const style = document.createElement('style');
  style.id = 'wf-progress-styles';
  style.textContent = '@keyframes wf-progress-indet { 0% { transform: translateX(-100%); } 100% { transform: translateX(380%); } }';
  document.head.appendChild(style);
}
const AGENT_OUTPUT_CAP = 16384;

function appendAgentOutput(id, text) {
  let buf = (agentOutput.get(id) || '') + text;
  if (buf.length > AGENT_OUTPUT_CAP) buf = buf.slice(buf.length - AGENT_OUTPUT_CAP);
  agentOutput.set(id, buf);
  if (expandedId === id) {
    const pre = document.getElementById(`wf-agent-out-${id}`);
    if (pre) {
      pre.textContent = buf;
      pre.scrollTop = pre.scrollHeight;
    }
  }
}

const STAGE_ORDER = ['planning', 'issues', 'pipeline', 'manual-setup', 'smoketest', 'obsidian-record'];
const STAGE_LABELS = {
  planning: 'Planning',
  issues: 'Issues',
  pipeline: 'Pipeline',
  'manual-setup': 'Manual setup',
  smoketest: 'Smoke test',
  'obsidian-record': 'Record + notify',
};

// Derive a stageProgress entry for the current stage from state when the runner
// hasn't written one. Manual setup is tracked as `confirmedAt` timestamps on
// each item in `manualSetup`, not via report-progress.js, so we compute the
// fraction here instead of waiting on the runner to mirror it.
function deriveStageProgress(w) {
  if (w?.currentStage === 'manual-setup' && Array.isArray(w.manualSetup) && w.manualSetup.length) {
    const total = w.manualSetup.length;
    const done = w.manualSetup.filter((i) => i && i.confirmedAt).length;
    const remaining = total - done;
    const label = remaining === 0 ? 'all confirmed' : `${remaining} step${remaining === 1 ? '' : 's'} pending`;
    return { current: done, total, label };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Panel DOM bootstrap
// ---------------------------------------------------------------------------

function ensurePanel() {
  if (panelEl) return panelEl;
  panelEl = document.createElement('div');
  panelEl.className = 'workflow-panel';
  panelEl.style.cssText = [
    'position:absolute',
    'top:48px',
    'right:12px',
    'width:380px',
    'max-height:80vh',
    'overflow:auto',
    'background:#1f2937',
    'color:#e5e7eb',
    'border:1px solid #374151',
    'border-radius:8px',
    'padding:12px',
    'display:none',
    'z-index:1000',
    'font-family:ui-sans-serif,system-ui,sans-serif',
    'font-size:14px',
    'box-sizing:border-box',
  ].join(';');
  document.body.appendChild(panelEl);
  return panelEl;
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

function render(list) {
  const p = ensurePanel();
  p.innerHTML = '';

  // Header row
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';

  const title = document.createElement('strong');
  title.textContent = 'Workflows';
  header.appendChild(title);

  const newBtn = document.createElement('button');
  newBtn.textContent = '+ New';
  newBtn.style.cssText = 'background:#374151;border:none;color:#e5e7eb;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:13px;';
  newBtn.onmouseenter = () => { newBtn.style.background = '#4b5563'; };
  newBtn.onmouseleave = () => { newBtn.style.background = '#374151'; };
  newBtn.onclick = () => renderForm();
  header.appendChild(newBtn);

  p.appendChild(header);

  // Resumables banner
  if (pendingResumables && pendingResumables.length) {
    const banner = document.createElement('div');
    banner.style.cssText = 'background:#1f3a5f;border:1px solid #3b82f6;padding:8px;margin-bottom:8px;border-radius:6px;';
    banner.innerHTML = '<strong>In-flight workflows</strong><div style="font-size:12px;opacity:0.8;margin-bottom:6px;">From a previous session.</div>';
    for (const w of pendingResumables) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-top:4px;';
      row.innerHTML = `<span>${w.title} <span style="opacity:0.7;font-size:11px">(stage: ${w.currentStage})</span></span>`;
      const btn = document.createElement('button');
      btn.textContent = 'Resume';
      btn.onclick = () => { _api.send('resume', { id: w.id }); pendingResumables = pendingResumables.filter((x) => x.id !== w.id); _api.send('list'); };
      row.appendChild(btn);
      banner.appendChild(row);
    }
    p.appendChild(banner);
  }

  // Empty state
  if (!list || !list.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'opacity:0.7;padding:16px 0;text-align:center;';
    empty.textContent = 'No workflows yet.';
    p.appendChild(empty);
    return;
  }

  // Workflow rows
  for (const w of list) {
    const isExpanded = w.id === expandedId;
    const row = document.createElement('div');
    row.style.cssText = 'border:1px solid #374151;border-radius:6px;padding:8px;margin-bottom:6px;cursor:pointer;';
    row.onclick = (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA') return;
      expandedId = isExpanded ? null : w.id;
      _api.send('list');
    };

    const titleDiv = document.createElement('div');
    titleDiv.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:6px;';
    const strong = document.createElement('strong');
    strong.textContent = w.title || w.id || '(untitled)';
    strong.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    titleDiv.appendChild(strong);

    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.title = 'Delete workflow';
    delBtn.style.cssText = 'background:transparent;border:none;color:#f87171;cursor:pointer;font-size:14px;padding:0 6px;line-height:1;opacity:0.6;';
    delBtn.onmouseenter = () => { delBtn.style.opacity = '1'; };
    delBtn.onmouseleave = () => { delBtn.style.opacity = '0.6'; };
    delBtn.onclick = (e) => {
      e.stopPropagation();
      const label = w.title || w.id;
      if (!window.confirm(`Delete workflow "${label}"? This stops the active session and removes the workflow folder.`)) return;
      row.style.opacity = '0.5';
      row.style.pointerEvents = 'none';
      delBtn.textContent = '…';
      const timeoutId = setTimeout(() => {
        pendingDeletes.delete(w.id);
        row.style.opacity = '';
        row.style.pointerEvents = '';
        delBtn.textContent = '✕';
        if (_api.toast) _api.toast(`Delete had no response. Restart CliDeck to load the latest workflow plugin.`, { type: 'warn', duration: 6000 });
      }, 5000);
      pendingDeletes.set(w.id, { timeoutId, rowEl: row });
      _api.send('delete', { id: w.id });
    };
    titleDiv.appendChild(delBtn);

    const chevron = document.createElement('span');
    chevron.textContent = isExpanded ? '▲' : '▼';
    chevron.style.cssText = 'font-size:10px;opacity:0.6;';
    titleDiv.appendChild(chevron);
    row.appendChild(titleDiv);

    const metaDiv = document.createElement('div');
    metaDiv.style.cssText = 'font-size:12px;opacity:0.8;margin-top:2px;';
    metaDiv.textContent = `${w.projectId || '—'} · ${w.branch || '(no branch)'}`;
    row.appendChild(metaDiv);

    const stageDiv = document.createElement('div');
    stageDiv.style.cssText = 'font-size:12px;margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
    const stageText = document.createElement('span');
    stageText.textContent = `Stage: ${w.currentStage || 'unknown'}`;
    stageDiv.appendChild(stageText);
    // Fix-loop indicator: when smoketest has failed and the runner is re-running
    // earlier stages with the failures as fix-targets, surface that — otherwise
    // the user just sees "Stage: planning" again with no hint that the deck
    // was reshuffled by a smoketest miss.
    const fixCount = Array.isArray(w.fixAttempts) ? w.fixAttempts.length : 0;
    if (fixCount > 0 && w.currentStage !== 'done' && w.currentStage !== 'failed') {
      const badge = document.createElement('span');
      badge.title = 'Smoketest failed previously — runner is replanning to fix it.';
      badge.style.cssText = 'font-size:10px;padding:1px 6px;border-radius:8px;background:#7c2d12;color:#fed7aa;border:1px solid #b45309;font-weight:600;letter-spacing:0.02em;';
      badge.textContent = `↻ fix attempt ${fixCount}`;
      stageDiv.appendChild(badge);
    }
    row.appendChild(stageDiv);

    // Progress bar (always visible until done/failed).
    if (w.currentStage !== 'done' && w.currentStage !== 'failed') {
      ensureProgressStyles();
      const prog = (w.stageProgress && w.stageProgress[w.currentStage]) || deriveStageProgress(w);
      const wrap = document.createElement('div');
      if (prog && prog.total > 0) {
        const labelLine = document.createElement('div');
        labelLine.style.cssText = 'font-size:11px;opacity:0.8;margin-top:4px;';
        labelLine.textContent = `${prog.current}/${prog.total} · ${prog.label || ''}`;
        wrap.appendChild(labelLine);
        const outer = document.createElement('div');
        outer.style.cssText = 'background:#374151;border-radius:3px;overflow:hidden;margin-top:2px;height:6px;';
        const inner = document.createElement('div');
        const pct = Math.min(100, (prog.current / prog.total) * 100);
        inner.style.cssText = `width:${pct}%;height:100%;background:#4f46e5;transition:width 250ms ease;`;
        outer.appendChild(inner);
        wrap.appendChild(outer);
      } else {
        const outer = document.createElement('div');
        outer.style.cssText = 'background:#374151;border-radius:3px;overflow:hidden;margin-top:6px;height:6px;';
        const inner = document.createElement('div');
        inner.style.cssText = 'width:30%;height:100%;background-image:repeating-linear-gradient(45deg,#4f46e5,#4f46e5 6px,#312e81 6px,#312e81 12px);animation:wf-progress-indet 1.2s linear infinite;';
        outer.appendChild(inner);
        wrap.appendChild(outer);
      }
      row.appendChild(wrap);
    }

    if (isExpanded) {
      const detail = document.createElement('div');
      detail.style.cssText = 'margin-top:8px;border-top:1px solid #374151;padding-top:8px;';

      // Fix-attempt context: show timestamps + failure count for each prior pass.
      if (fixCount > 0) {
        const fixBox = document.createElement('div');
        fixBox.style.cssText = 'margin-bottom:8px;padding:6px 8px;border:1px solid #b45309;background:#451a03;border-radius:4px;font-size:11px;';
        const heading = document.createElement('div');
        heading.style.cssText = 'color:#fed7aa;font-weight:600;margin-bottom:4px;';
        heading.textContent = `Fix loop · ${fixCount} prior attempt${fixCount === 1 ? '' : 's'} from failed smoketest`;
        fixBox.appendChild(heading);
        for (const a of (w.fixAttempts || [])) {
          const line = document.createElement('div');
          line.style.cssText = 'opacity:0.8;';
          const when = a.startedAt ? new Date(a.startedAt).toLocaleString() : '(unknown time)';
          const failuresN = Array.isArray(a.failures) ? a.failures.length : 0;
          line.textContent = `• ${when} — ${failuresN} failure${failuresN === 1 ? '' : 's'} addressed`;
          fixBox.appendChild(line);
        }
        detail.appendChild(fixBox);
      }

      // Stage checklist
      const stageList = document.createElement('div');
      stageList.style.cssText = 'margin-bottom:8px;';
      const currentIdx = STAGE_ORDER.indexOf(w.currentStage);
      for (let i = 0; i < STAGE_ORDER.length; i++) {
        const sName = STAGE_ORDER[i];
        const sLine = document.createElement('div');
        sLine.style.cssText = 'font-size:12px;margin-bottom:2px;';
        const isPast = currentIdx > i || w.currentStage === 'done';
        const isCurrent = currentIdx === i && w.currentStage !== 'done' && w.currentStage !== 'failed';
        const dot = isPast ? '●' : '○';
        const label = STAGE_LABELS[sName] || sName;
        sLine.innerHTML = `<span style="opacity:${isPast ? '1' : '0.4'}">${dot}</span> `;
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        if (isCurrent) labelSpan.style.fontWeight = 'bold';
        sLine.appendChild(labelSpan);
        stageList.appendChild(sLine);
      }
      detail.appendChild(stageList);

      // Open session button
      const openBtn = document.createElement('button');
      openBtn.textContent = 'Open active session';
      openBtn.style.cssText = 'background:#374151;border:none;color:#e5e7eb;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:12px;margin-bottom:6px;';
      openBtn.onclick = (e) => { e.stopPropagation(); _api.send('openSession', { id: w.id }); };
      detail.appendChild(openBtn);

      // Planning chat box
      if (w.currentStage === 'planning') {
        const chatWrap = document.createElement('div');
        chatWrap.style.cssText = 'margin-top:6px;';

        // Live agent output (read-only)
        const outLabel = document.createElement('div');
        outLabel.style.cssText = 'font-size:11px;opacity:0.7;margin-bottom:4px;';
        outLabel.textContent = 'Planning agent output:';
        chatWrap.appendChild(outLabel);
        const outPre = document.createElement('pre');
        outPre.id = `wf-agent-out-${w.id}`;
        outPre.style.cssText = 'background:#0b1220;color:#cbd5e1;border:1px solid #374151;border-radius:4px;padding:6px;font-size:11px;font-family:ui-monospace,Menlo,monospace;height:140px;overflow:auto;white-space:pre-wrap;margin:0 0 6px 0;';
        outPre.textContent = agentOutput.get(w.id) || '';
        outPre.onclick = (e) => e.stopPropagation();
        chatWrap.appendChild(outPre);
        // Scroll to bottom on initial render
        setTimeout(() => { outPre.scrollTop = outPre.scrollHeight; }, 0);

        const chatLabel = document.createElement('div');
        chatLabel.style.cssText = 'font-size:11px;opacity:0.7;margin-bottom:4px;';
        chatLabel.textContent = 'Send message to planning agent:';
        chatWrap.appendChild(chatLabel);
        const textarea = document.createElement('textarea');
        textarea.style.cssText = 'width:100%;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:5px;font-size:12px;box-sizing:border-box;resize:vertical;height:56px;font-family:inherit;';
        textarea.placeholder = 'Type a message…';
        textarea.onclick = (e) => e.stopPropagation();
        chatWrap.appendChild(textarea);
        const sendBtn = document.createElement('button');
        sendBtn.textContent = 'Send';
        sendBtn.style.cssText = 'background:#4f46e5;border:none;color:#fff;padding:3px 10px;border-radius:4px;cursor:pointer;font-size:12px;margin-top:4px;';
        sendBtn.onclick = (e) => {
          e.stopPropagation();
          const text = textarea.value.trim();
          if (!text) return;
          _api.send('chat', { id: w.id, text });
          textarea.value = '';
        };
        chatWrap.appendChild(sendBtn);
        detail.appendChild(chatWrap);
      }

      // Failure: error context + retry button
      if (w.currentStage === 'failed') {
        const failWrap = document.createElement('div');
        failWrap.style.cssText = 'margin-top:6px;';
        if (w.stageFailures && Object.keys(w.stageFailures).length) {
          const errPre = document.createElement('pre');
          errPre.style.cssText = 'font-size:11px;color:#f87171;background:#1f0a0a;padding:6px;border-radius:4px;overflow:auto;max-height:80px;white-space:pre-wrap;';
          const failEntries = Object.entries(w.stageFailures);
          const lastFail = failEntries[failEntries.length - 1];
          errPre.textContent = `${lastFail[0]}: ${JSON.stringify(lastFail[1]).slice(0, 200)}`;
          failWrap.appendChild(errPre);
        }
        const retryBtn = document.createElement('button');
        retryBtn.textContent = 'Retry (open session)';
        retryBtn.style.cssText = 'background:#7f1d1d;border:none;color:#fca5a5;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:12px;margin-top:4px;';
        retryBtn.onclick = (e) => { e.stopPropagation(); _api.send('openSession', { id: w.id }); };
        failWrap.appendChild(retryBtn);
        detail.appendChild(failWrap);
      }

      row.appendChild(detail);
    }

    p.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Form view
// ---------------------------------------------------------------------------

function renderForm() {
  const p = ensurePanel();
  p.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
  const title = document.createElement('strong');
  title.textContent = 'New Workflow';
  header.appendChild(title);

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'background:#374151;border:none;color:#e5e7eb;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:13px;';
  cancelBtn.onmouseenter = () => { cancelBtn.style.background = '#4b5563'; };
  cancelBtn.onmouseleave = () => { cancelBtn.style.background = '#374151'; };
  cancelBtn.onclick = () => {
    requestList();
  };
  header.appendChild(cancelBtn);
  p.appendChild(header);

  const inputStyle = 'width:100%;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:6px;font-size:13px;box-sizing:border-box;margin-bottom:8px;font-family:inherit;';
  const labelStyle = 'display:block;margin-bottom:4px;font-size:12px;opacity:0.8;';

  // Project selector — drives the spawned-agent cwd. Without this, the
  // dashboard's active-project leaks into the workflow and the wrong repo
  // gets touched.
  const projLabel = document.createElement('label');
  projLabel.style.cssText = labelStyle;
  projLabel.textContent = 'Project';
  p.appendChild(projLabel);

  const projSelect = document.createElement('select');
  projSelect.id = 'wf-project';
  projSelect.style.cssText = inputStyle;
  p.appendChild(projSelect);

  // Inline add-new-repo controls — hidden until the "+ Add new repo…" option is chosen.
  const addRow = document.createElement('div');
  addRow.id = 'wf-add-project';
  addRow.style.cssText = 'display:none;gap:6px;margin-bottom:8px;';
  const addPath = document.createElement('input');
  addPath.type = 'text';
  addPath.placeholder = '/Users/ajhochhalter/Documents/MyRepo';
  addPath.style.cssText = inputStyle + 'flex:1;margin-bottom:0;';
  const addName = document.createElement('input');
  addName.type = 'text';
  addName.placeholder = 'Display name (optional)';
  addName.style.cssText = inputStyle + 'flex:1;margin-bottom:0;';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = 'Add';
  addBtn.style.cssText = 'background:#4f46e5;border:none;color:#fff;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:13px;flex-shrink:0;';
  addRow.appendChild(addPath);
  addRow.appendChild(addName);
  addRow.appendChild(addBtn);
  p.appendChild(addRow);

  const ADD_NEW_VALUE = '__add_new__';
  function rebuildProjOptions() {
    projSelect.innerHTML = '';
    if (!knownProjects.length) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '(no projects yet — add one below)';
      empty.disabled = true;
      empty.selected = true;
      projSelect.appendChild(empty);
    } else {
      for (const proj of knownProjects) {
        const opt = document.createElement('option');
        opt.value = proj.id;
        opt.textContent = `${proj.name} — ${proj.path}`;
        projSelect.appendChild(opt);
      }
    }
    const addOpt = document.createElement('option');
    addOpt.value = ADD_NEW_VALUE;
    addOpt.textContent = '+ Add new repo…';
    projSelect.appendChild(addOpt);
    // Restore selection if still valid; else fall back to the dashboard's active project; else first available
    const fallbackActive = (typeof _api.getActiveProjectId === 'function' && _api.getActiveProjectId()) || null;
    const target = (selectedProjectId && knownProjects.some((p) => p.id === selectedProjectId))
      ? selectedProjectId
      : (knownProjects.some((p) => p.id === fallbackActive) ? fallbackActive : (knownProjects[0]?.id || ''));
    if (target) {
      projSelect.value = target;
      selectedProjectId = target;
    }
    addRow.style.display = projSelect.value === ADD_NEW_VALUE ? 'flex' : 'none';
  }

  projSelect.onchange = () => {
    if (projSelect.value === ADD_NEW_VALUE) {
      addRow.style.display = 'flex';
      addPath.focus();
    } else {
      addRow.style.display = 'none';
      selectedProjectId = projSelect.value;
    }
  };

  addBtn.onclick = () => {
    const projPath = addPath.value.trim();
    const projName = addName.value.trim();
    const warn = document.getElementById('wf-warn');
    if (!projPath) {
      if (warn) warn.textContent = 'Path is required to add a project.';
      return;
    }
    addBtn.disabled = true;
    addBtn.textContent = '…';
    pendingAddProject = (result) => {
      addBtn.disabled = false;
      addBtn.textContent = 'Add';
      if (!result.success) {
        if (warn) warn.textContent = `Add failed: ${result.error}`;
        return;
      }
      // Insert (or pick up existing) and select it.
      if (!knownProjects.some((p) => p.id === result.project.id)) knownProjects.push(result.project);
      selectedProjectId = result.project.id;
      addPath.value = '';
      addName.value = '';
      rebuildProjOptions();
    };
    _api.send('projects.add', { name: projName, path: projPath });
  };

  // Kick off the initial project-list fetch.
  rebuildProjOptions();
  _api.send('projects.list');

  // Description field
  const descLabel = document.createElement('label');
  descLabel.style.cssText = labelStyle;
  descLabel.textContent = 'Description';
  p.appendChild(descLabel);

  const descArea = document.createElement('textarea');
  descArea.id = 'wf-desc';
  descArea.style.cssText = inputStyle + 'height:120px;resize:vertical;';
  p.appendChild(descArea);

  // Title field (optional)
  const titleLabel = document.createElement('label');
  titleLabel.style.cssText = labelStyle;
  titleLabel.textContent = 'Title (optional)';
  p.appendChild(titleLabel);

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.id = 'wf-title';
  titleInput.style.cssText = inputStyle;
  p.appendChild(titleInput);

  // Branch field
  const branchLabel = document.createElement('label');
  branchLabel.style.cssText = labelStyle;
  branchLabel.textContent = 'Branch';
  p.appendChild(branchLabel);

  const branchInput = document.createElement('input');
  branchInput.type = 'text';
  branchInput.id = 'wf-branch';
  branchInput.placeholder = 'auto';
  branchInput.style.cssText = inputStyle;
  p.appendChild(branchInput);

  // Live branch collision validation
  branchInput.oninput = () => {
    clearTimeout(branchValidateTimer);
    const val = branchInput.value.trim();
    const warnEl2 = document.getElementById('wf-warn');
    if (!val || val === 'auto') {
      if (warnEl2) warnEl2.textContent = '';
      return;
    }
    branchValidateTimer = setTimeout(() => {
      const projectId = (typeof _api.getActiveProjectId === 'function' && _api.getActiveProjectId()) || 'unknown';
      _api.send('validate-branch', { projectId, branch: val });
    }, 250);
  };

  // Warning text
  const warnEl = document.createElement('div');
  warnEl.id = 'wf-warn';
  warnEl.style.cssText = 'color:#fbbf24;font-size:12px;margin-bottom:8px;min-height:16px;';
  p.appendChild(warnEl);

  // Start button
  const startBtn = document.createElement('button');
  startBtn.textContent = 'Start';
  startBtn.style.cssText = 'background:#4f46e5;border:none;color:#fff;padding:6px 16px;border-radius:4px;cursor:pointer;font-size:13px;width:100%;';
  startBtn.onmouseenter = () => { startBtn.style.background = '#4338ca'; };
  startBtn.onmouseleave = () => { startBtn.style.background = '#4f46e5'; };
  startBtn.onclick = () => {
    const description = descArea.value.trim();
    const wfTitle = titleInput.value.trim();
    const branch = branchInput.value.trim();
    warnEl.textContent = '';

    if (!description) {
      warnEl.textContent = 'Description is required.';
      return;
    }

    // Prefer the explicit dropdown selection; fall back to dashboard active project; finally fail loudly.
    const dropdownVal = projSelect.value;
    const fallback = (typeof _api.getActiveProjectId === 'function' && _api.getActiveProjectId()) || null;
    const projectId = (dropdownVal && dropdownVal !== ADD_NEW_VALUE && dropdownVal) || fallback || 'unknown';
    if (projectId === 'unknown') {
      warnEl.textContent = 'Pick a project (or add a new one) so the agent works in the right repo.';
      return;
    }

    _api.send('create', { description, title: wfTitle, branch, projectId });
    startBtn.disabled = true;
    startBtn.style.opacity = '0.6';
    startBtn.textContent = 'Starting…';
  };
  p.appendChild(startBtn);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requestList() {
  _api.send('list');
}

function toggle() {
  visible = !visible;
  ensurePanel().style.display = visible ? 'block' : 'none';
  if (visible) requestList();
}

// ---------------------------------------------------------------------------
// Init (called by CliDeck frontend loader)
// ---------------------------------------------------------------------------

export function init(api) {
  _api = api;

  // Receive workflow list from backend
  api.onMessage('list', (msg) => {
    const workflows = Array.isArray(msg?.workflows) ? msg.workflows : [];
    // Drop resume banner entries for workflows the backend now reports as
    // running — the runner is already engaged, no resume needed. Guard against
    // pendingResumables being null (its initial state); reading .length on
    // null throws TypeError, which would kill the list handler and leave the
    // panel un-rendered — symptom: workflow toolbar/menu silently disappears.
    const runningIds = new Set(workflows.filter((w) => w.running).map((w) => w.id));
    if (runningIds.size && pendingResumables && pendingResumables.length) {
      pendingResumables = pendingResumables.filter((r) => !runningIds.has(r.id));
    }
    lastWorkflows = workflows;
    render(workflows);
  });

  api.onMessage('delete-result', ({ id, success, error }) => {
    const pending = pendingDeletes.get(id);
    if (pending) { clearTimeout(pending.timeoutId); pendingDeletes.delete(id); }
    if (success) {
      if (_api.toast) _api.toast('Workflow deleted.', { type: 'info', duration: 2500 });
    } else {
      if (pending?.rowEl) {
        pending.rowEl.style.opacity = '';
        pending.rowEl.style.pointerEvents = '';
        const btn = pending.rowEl.querySelector('button');
        if (btn && btn.textContent === '…') btn.textContent = '✕';
      }
      if (_api.toast) _api.toast(`Delete failed: ${error || 'unknown error'}`, { type: 'error', duration: 5000 });
    }
  });

  // Workflow created successfully — go back to list
  api.onMessage('created', () => {
    requestList();
  });

  // Live agent output relay (planning stage chat)
  api.onMessage('agent-output', ({ id, text }) => {
    if (!id || !text) return;
    appendAgentOutput(id, text);
  });

  // Resume prompt from backend — show in-flight workflows banner
  api.onMessage('resume-prompt', ({ workflows }) => {
    if (!workflows || !workflows.length) return;
    visible = true;
    ensurePanel().style.display = 'block';
    pendingResumables = workflows;
    // Render directly with the most recent list we have — do NOT round-trip a
    // fresh `list` request, because the server piggybacks resume-prompt on its
    // list response, which would put us back here in an infinite loop.
    render(lastWorkflows);
  });

  // Focus a session when the backend asks
  api.onMessage('focusSession', ({ sessionId }) => {
    if (sessionId && typeof api.focusSession === 'function') api.focusSession(sessionId);
  });

  // Live branch-collision validation response from backend
  // Refresh the project dropdown when backend returns the list.
  api.onMessage('projects.list', ({ projects }) => {
    knownProjects = Array.isArray(projects) ? projects : [];
    // If the form is open, re-render the dropdown in place. We look up by id
    // to avoid a full renderForm() which would reset the description/branch fields.
    const sel = document.getElementById('wf-project');
    if (sel) {
      const event = new Event('refresh-projects');
      sel.dispatchEvent(event);
      // Simplest: trigger a fresh renderForm only if no description is typed yet.
      // Otherwise, manually rebuild the options.
      const optsToKeep = [...sel.options].map((o) => o.value);
      sel.innerHTML = '';
      const ADD_NEW_VALUE = '__add_new__';
      for (const proj of knownProjects) {
        const opt = document.createElement('option');
        opt.value = proj.id;
        opt.textContent = `${proj.name} — ${proj.path}`;
        sel.appendChild(opt);
      }
      const addOpt = document.createElement('option');
      addOpt.value = ADD_NEW_VALUE;
      addOpt.textContent = '+ Add new repo…';
      sel.appendChild(addOpt);
      // Restore last selection if still valid
      if (selectedProjectId && knownProjects.some((p) => p.id === selectedProjectId)) {
        sel.value = selectedProjectId;
      } else if (knownProjects[0]) {
        sel.value = knownProjects[0].id;
        selectedProjectId = sel.value;
      }
    }
  });

  api.onMessage('projects.add.result', (result) => {
    if (typeof pendingAddProject === 'function') {
      try { pendingAddProject(result); } finally { pendingAddProject = null; }
    }
  });

  api.onMessage('branch-validation', ({ branch: b, inUse }) => {
    const inputEl = document.getElementById('wf-branch');
    const warnEl = document.getElementById('wf-warn');
    if (!inputEl || !warnEl) return;
    if (inputEl.value.trim() !== b) return; // stale response — ignore
    if (inUse) {
      warnEl.textContent = `Branch "${b}" is already in use by another in-flight workflow on this project.`;
      warnEl.style.color = '#fbbf24'; // amber
    } else {
      warnEl.textContent = '';
    }
  });

  // Warning from backend (e.g. branch conflict, validation)
  api.onMessage('warn', (msg) => {
    const warnEl = document.getElementById('wf-warn');
    const text = msg.message || msg.warn || String(msg);
    if (warnEl) {
      warnEl.textContent = text;
      // Re-enable start button if it was disabled
      const startBtn = document.querySelector('#wf-start, button[disabled]');
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.style.opacity = '';
        startBtn.textContent = 'Start';
      }
    } else {
      api.toast(text, { type: 'warn' });
    }
  });

  // Toolbar button
  api.addToolbarButton({
    title: 'Workflows',
    icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="7" cy="6" r="1" fill="currentColor"/><circle cx="7" cy="12" r="1" fill="currentColor"/><circle cx="7" cy="18" r="1" fill="currentColor"/></svg>',
    onClick: toggle,
  });
}
