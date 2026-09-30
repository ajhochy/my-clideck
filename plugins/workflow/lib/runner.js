const { watch, unlinkSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const state = require('./state');
const fixmod = require('./fix-subworkflow');
const { createLogger } = require('./logger');
const { pollPrChecks } = require('./ci-poller');

const SEQUENCE = ['planning', 'issues', 'pipeline', 'manual-setup', 'smoketest', 'obsidian-record'];
const MAX_CI_RETRIES_PER_ISSUE = 3;

function nextStage(current) {
  const i = SEQUENCE.indexOf(current);
  if (i < 0 || i === SEQUENCE.length - 1) return 'done';
  return SEQUENCE[i + 1];
}

function createRunner({ dir, api, stages, onAdvance = () => {}, lockFor = null, maxFixAttempts = 2, _pollPrChecks = null, _closeIssue = null }) {
  let watcher = null;
  let currentSession = null;
  let currentLock = null;

  const wfLog = createLogger({ dir, stage: 'runner' });
  const sessionStreams = new Map();

  // Close a GitHub issue by number. Skips local T-prefixed synthetic IDs.
  // Fire-and-forget: never throws or blocks the runner.
  function closeIssue(repo, issueNumber) {
    // Skip local synthetic IDs (strings like "T1") and no-repo local mode.
    if (!repo || typeof issueNumber !== 'number') return;
    if (_closeIssue) { _closeIssue(repo, issueNumber); return; }
    try {
      require('node:child_process').execFile(
        'gh', ['issue', 'close', String(issueNumber), '--repo', repo],
        { timeout: 10000 }, () => {},
      );
    } catch {}
  }

  // Keep stageProgress.pipeline in sync with state.issues so the dashboard row
  // doesn't get stuck on "issue 13 pushed, awaiting CI" after an issue advances.
  // Called whenever the runner — not the per-step agent — moves the pipeline forward.
  function updatePipelineProgress(label) {
    try {
      state.update(dir, (c) => {
        const issues = Array.isArray(c.issues) ? c.issues : [];
        const total = issues.length;
        const doneCount = issues.filter((i) => i.status === 'done').length;
        if (!c.stageProgress || typeof c.stageProgress !== 'object') c.stageProgress = {};
        c.stageProgress.pipeline = {
          current: doneCount,
          total: total || 1,
          label: String(label || ''),
          updatedAt: new Date().toISOString(),
        };
      });
    } catch {}
  }

  async function spawnCurrentStage() {
    const s = state.read(dir);
    if (s.currentStage === 'done' || s.currentStage === 'failed') return;
    const stage = stages[s.currentStage];
    if (!stage) return;

    // Short-circuit: if manual-setup has no items to walk through, skip the stage
    // entirely so we don't spin up a Gemini session for nothing.
    if (s.currentStage === 'manual-setup' && !(Array.isArray(s.manualSetup) && s.manualSetup.length)) {
      try { wfLog.event('stage_skipped_empty', { stage: 'manual-setup' }); } catch {}
      require('node:fs').writeFileSync(join(dir, 'done', 'manual-setup.done'), '');
      return;
    }

    // Merge stashed confirmedAt timestamps from a prior fix-loop pass back
    // into the freshly-rewritten manualSetup so the user isn't re-walked
    // through tasks they already finished.
    if (s.currentStage === 'manual-setup' && s._priorConfirmed && Array.isArray(s.manualSetup)) {
      state.update(dir, (cur) => {
        const priors = cur._priorConfirmed || {};
        for (const item of cur.manualSetup) {
          if (item && item.title && priors[item.title] && !item.confirmedAt) {
            item.confirmedAt = priors[item.title];
          }
        }
        delete cur._priorConfirmed;
      });
    }

    try { wfLog.event('stage_spawn_attempt', { stage: s.currentStage, fixAttempts: s.fixAttempts?.length || 0 }); } catch {}

    // Keep the dashboard row in sync the moment we begin a new pipeline step
    // (the per-step agent only updates progress *after* it pushes, which can
    // be many minutes later).
    if (s.currentStage === 'pipeline') {
      const next = (s.issues || []).find((i) => i.status !== 'done');
      if (next) updatePipelineProgress(`issue ${next.number} in progress`);
    }

    if (lockFor) {
      const lockPromise = lockFor(s.currentStage, s.id);
      if (lockPromise) currentLock = await lockPromise;
    }
    const prompt = stage.build(s, dir);
    const sid = api.createSession({
      name: `${s.currentStage} · ${s.title || s.id}`,
      presetId: stage.preset || 'claude-code',
      projectId: s.projectId,
      extraArgs: stage.extraArgs || [],
      autoFocus: false,
    });
    currentSession = sid;

    try { wfLog.prompt(`stage:${s.currentStage}`, prompt); } catch {}
    try { wfLog.event('stage_session_created', { stage: s.currentStage, sessionId: sid, presetId: stage.preset || 'claude-code' }); } catch {}

    try {
      const stageLog = createLogger({ dir, stage: s.currentStage });
      const stream = stageLog.openSessionStream(sid, s.currentStage);
      sessionStreams.set(sid, stream);
      // TODO: wire api session output → stream.onData when api exposes a hook
    } catch {}

    if (sid && prompt) {
      // Agents need a few seconds to boot before they accept input.
      // Send the prompt, then submit. Claude Code uses bracketed-paste mode
      // for multi-line input; if we send Enter too quickly after the paste,
      // the terminal can leave it in "collapsed paste" state waiting for
      // another keypress instead of submitting. Wait long enough for the paste
      // bracket to close, then send Enter twice (the second is a safety net
      // for the case where the first arrived during paste expansion).
      setTimeout(() => { try { api.inputToSession(sid, prompt); } catch {} }, 4000);
      setTimeout(() => { try { api.inputToSession(sid, '\r'); } catch {} }, 5500);
      setTimeout(() => { try { api.inputToSession(sid, '\r'); } catch {} }, 6200);
    }
  }

  async function handleStepDone() {
    // Clear marker first so we don't re-trigger on the next watch event.
    try { unlinkSync(join(dir, 'done', 'step.done')); } catch {}

    // Close the per-step agent session — its work is done. The next pipeline invocation gets a fresh session.
    const sid = currentSession;
    if (currentSession) { try { api.closeSession(currentSession); } catch {} }
    try { sessionStreams.get(sid)?.close({ stage: 'pipeline-step' }); sessionStreams.delete(sid); } catch {}
    currentSession = null;
    if (currentLock) { currentLock.release(); currentLock = null; }

    const s0 = state.read(dir);
    const pushed = (s0.issues || []).find((i) => i.status === 'pushed');
    if (!pushed) {
      // Nothing pushed → nothing to verify. Re-spawn pipeline; build() will branch to finalize if all done.
      spawnCurrentStage();
      return;
    }

    const repo = s0.githubRepo;
    const prNum = s0.pr?.number;
    if (!repo || !prNum) {
      // No PR yet (very first commit may have just landed without one) or no repo — mark step done optimistically.
      state.update(dir, (c) => {
        const i = c.issues.find((x) => x.number === pushed.number);
        if (i) { i.status = 'done'; }
      });
      closeIssue(repo, pushed.number);
      spawnCurrentStage();
      return;
    }

    try { wfLog.event('ci_poll_start', { issue: pushed.number, pr: prNum, repo }); } catch {}
    const poll = _pollPrChecks || pollPrChecks;
    const result = await poll({
      prNumber: prNum,
      repo,
      onPoll: (snap) => { try { wfLog.event('ci_poll', { issue: pushed.number, snap }); } catch {} },
    });
    try { wfLog.event('ci_poll_done', { issue: pushed.number, result: result.state }); } catch {}

    if (result.state === 'passed' || result.state === 'no-checks') {
      state.update(dir, (c) => {
        const i = c.issues.find((x) => x.number === pushed.number);
        if (i) {
          i.status = 'done';
          delete i.lastCiFailure;
        }
      });
      closeIssue(repo, pushed.number);
      const passedReason = result.state === 'no-checks' ? 'no CI configured' : 'CI passed';
      updatePipelineProgress(`issue ${pushed.number} ${passedReason}`);
      spawnCurrentStage();
      return;
    }

    if (result.state === 'failed') {
      const updated = state.update(dir, (c) => {
        const i = c.issues.find((x) => x.number === pushed.number);
        if (!i) return;
        i.ciAttempts = (i.ciAttempts || 0) + 1;
        if (i.ciAttempts >= MAX_CI_RETRIES_PER_ISSUE) {
          i.status = 'failed';
        } else {
          i.status = 'fix-needed';
          i.lastCiFailure = { failed: result.failed?.map((f) => ({ name: f.name, link: f.link })) || [], at: new Date().toISOString() };
        }
      });
      const issue = updated.issues.find((x) => x.number === pushed.number);
      if (issue?.status === 'failed') {
        require('node:fs').writeFileSync(join(dir, 'done', 'pipeline.failed'), `Issue ${issue.number} (${issue.title || ''}) exceeded CI retry budget (${MAX_CI_RETRIES_PER_ISSUE}).`);
        return;
      }
      spawnCurrentStage();
      return;
    }

    // Timeout — treat as failure.
    require('node:fs').writeFileSync(join(dir, 'done', 'pipeline.failed'), `CI poll timed out for PR ${prNum} on issue ${pushed.number}.`);
  }

  function handleMarker(filename) {
    if (!filename) return;
    // Ignore deletion events — only act when the file actually exists.
    if (!existsSync(join(dir, 'done', filename))) return;

    if (filename.endsWith('.failed')) {
      const stage = filename.slice(0, -'.failed'.length);
      // Per-step agent self-reported failure → treat as pipeline failure.
      if (stage === 'step') {
        const failureFile = join(dir, 'done', filename);
        let failureText = '';
        try { failureText = require('node:fs').readFileSync(failureFile, 'utf8'); } catch {}
        try { unlinkSync(failureFile); } catch {}
        require('node:fs').writeFileSync(join(dir, 'done', 'pipeline.failed'), failureText || 'per-step agent reported failure');
        return;
      }
      if (stage === 'smoketest') return; // smoketest uses fix loop-back
      const failureFile = join(dir, 'done', filename);
      let failureText = '';
      try { failureText = require('node:fs').readFileSync(failureFile, 'utf8'); } catch {}
      const cur = state.read(dir);
      const prev = cur.stageFailures?.[stage] || [];
      if (prev.length >= 1) {
        try { wfLog.event('stage_failed', { stage, failureText, retryDecision: 'give-up' }); } catch {}
        try { wfLog.error(new Error(failureText)); } catch {}
        const sid = currentSession;
        const failed = state.update(dir, (c) => { c.currentStage = 'failed'; });
        try { sessionStreams.get(sid)?.close({ stage }); sessionStreams.delete(sid); } catch {}
        onAdvance(failed);
        return;
      }
      try { wfLog.event('stage_failed', { stage, failureText, retryDecision: 'retry' }); } catch {}
      try { wfLog.error(new Error(failureText)); } catch {}
      state.update(dir, (c) => {
        c.stageFailures = c.stageFailures || {};
        c.stageFailures[stage] = [...(c.stageFailures[stage] || []), failureText];
      });
      try { unlinkSync(failureFile); } catch {}
      const sid = currentSession;
      if (currentSession) api.closeSession(currentSession);
      try { sessionStreams.get(sid)?.close({ stage }); sessionStreams.delete(sid); } catch {}
      currentSession = null;
      if (currentLock) { currentLock.release(); currentLock = null; }
      spawnCurrentStage();
      return;
    }

    if (!filename.endsWith('.done')) return;
    const stageDone = filename.slice(0, -'.done'.length);

    // Per-step pipeline marker — agent did one issue and exited; runner now polls CI.
    if (stageDone === 'step') {
      handleStepDone();
      return;
    }

    // Smoketest is special — branch on result.
    if (stageDone === 'smoketest') {
      const s = state.read(dir);
      const sid = currentSession;
      if (currentSession) api.closeSession(currentSession);
      currentSession = null;
      if (currentLock) { currentLock.release(); currentLock = null; }

      if (s.smoketestResult?.status === 'failed') {
        const willRetry = fixmod.shouldRetry(s, maxFixAttempts);
        try { wfLog.event('smoketest_failed', { willRetry }); } catch {}
        if (willRetry) {
          try { sessionStreams.get(sid)?.close({ stage: stageDone }); sessionStreams.delete(sid); } catch {}
          // Clear all markers
          for (const m of ['planning', 'issues', 'pipeline', 'manual-setup', 'smoketest', 'obsidian-record']) {
            try { unlinkSync(join(dir, 'done', `${m}.done`)); } catch {}
          }
          fixmod.startFixAttempt(dir, state);
          const updated = state.read(dir);
          onAdvance(updated);
          spawnCurrentStage();
          return;
        }
        try { sessionStreams.get(sid)?.close({ stage: stageDone }); sessionStreams.delete(sid); } catch {}
        const failed = state.update(dir, (cur) => { cur.currentStage = 'failed'; });
        onAdvance(failed);
        return;
      }
      try { sessionStreams.get(sid)?.close({ stage: stageDone }); sessionStreams.delete(sid); } catch {}
      // Smoketest passed — advance to the obsidian-record stage to write a
      // permanent note + send a notification. That stage's done handler will
      // fall through to the default flow and land on 'done'.
      const advanced = state.update(dir, (cur) => { cur.currentStage = 'obsidian-record'; });
      try { wfLog.event('stage_done', { from: stageDone, to: advanced.currentStage }); } catch {}
      onAdvance(advanced);
      spawnCurrentStage();
      return;
    }

    // Default flow for non-smoketest stages.
    const before = state.read(dir).currentStage;
    const updated = state.update(dir, (cur) => {
      if (cur.currentStage !== stageDone) return;
      cur.currentStage = nextStage(cur.currentStage);
    });
    if (updated.currentStage === before) return;
    const sid = currentSession;
    if (currentSession) api.closeSession(currentSession);
    currentSession = null;
    if (currentLock) { currentLock.release(); currentLock = null; }
    try { sessionStreams.get(sid)?.close({ stage: stageDone }); sessionStreams.delete(sid); } catch {}
    try { wfLog.event('stage_done', { from: stageDone, to: updated.currentStage }); } catch {}
    onAdvance(updated);
    if (updated.currentStage !== 'done' && updated.currentStage !== 'failed') {
      spawnCurrentStage();
    }
  }

  function start() {
    watcher = watch(join(dir, 'done'), { persistent: false }, (_evt, fn) => handleMarker(fn));
    // On resume: if a step is already pushed (PR opened, CI in flight), don't
    // spawn a new per-step agent — that would redo completed work. Jump
    // straight to CI polling, same path the runner takes after a fresh push.
    const s = state.read(dir);
    if (s.currentStage === 'pipeline' && (s.issues || []).some((i) => i.status === 'pushed')) {
      try { wfLog.event('resume_ci_poll', { from: 'start' }); } catch {}
      handleStepDone();
      return;
    }
    spawnCurrentStage();
  }

  function stop() {
    if (watcher) watcher.close();
    watcher = null;
    if (currentLock) { currentLock.release(); currentLock = null; }
  }

  return { start, stop };
}

module.exports = { createRunner, nextStage, SEQUENCE };
