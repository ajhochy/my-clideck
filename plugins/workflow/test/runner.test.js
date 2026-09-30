const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const state = require('../lib/state');
const { initFolder } = require('../lib/workflow-folder');
const { createRunner } = require('../lib/runner');

function tick(ms = 50) { return new Promise((r) => setTimeout(r, ms)); }

test('runner advances state when a marker file appears', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wfrt-'));
  try {
    const id = 'wf-1';
    const dir = initFolder(root, id);
    state.write(dir, state.createState({ id, title: 't', description: 'd', projectId: 'p', branch: 'feat/x' }));

    const advances = [];
    const fakeApi = { createSession: () => 'sess-1', closeSession: () => {}, log: () => {} };
    const runner = createRunner({ dir, api: fakeApi, stages: {
      planning: { build: () => 'PLAN_PROMPT' },
      issues: { build: () => 'ISSUES_PROMPT' },
    }, onAdvance: (s) => advances.push(s.currentStage) });

    runner.start();
    await tick();
    writeFileSync(join(dir, 'done', 'planning.done'), '');
    await tick(150);
    runner.stop();
    assert.ok(advances.includes('issues'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runner ignores stale marker (one for a stage already past)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wfst-'));
  try {
    const id = 'wf-stale';
    const dir = initFolder(root, id);
    const s = state.createState({ id, title: 't', description: 'd', projectId: 'p', branch: 'feat/x' });
    s.currentStage = 'pipeline'; // already past planning
    state.write(dir, s);

    const advances = [];
    const spawns = [];
    const fakeApi = {
      createSession: () => { spawns.push(1); return 'sess'; },
      closeSession: () => {},
      log: () => {},
    };
    const runner = createRunner({
      dir, api: fakeApi,
      stages: { pipeline: { build: () => 'P' } },
      onAdvance: (s2) => advances.push(s2.currentStage),
    });
    runner.start();
    await tick();
    // Drop a STALE marker for planning (already past)
    writeFileSync(join(dir, 'done', 'planning.done'), '');
    await tick(150);
    runner.stop();
    assert.equal(advances.length, 0, 'no advances on stale marker');
    assert.equal(spawns.length, 1, 'only the initial spawn');
    assert.equal(state.read(dir).currentStage, 'pipeline');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runner waits for lockFor when entering a locked stage and releases on advance', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wflk-'));
  try {
    const id = 'wf-lock';
    const dir = initFolder(root, id);
    const s = state.createState({ id, title: 't', description: 'd', projectId: 'p', branch: 'feat/x' });
    s.currentStage = 'smoketest';
    state.write(dir, s);

    let releaseCount = 0;
    let lockCalls = 0;
    const fakeApi = {
      createSession: () => 'sess', closeSession: () => {}, log: () => {},
    };
    const runner = createRunner({
      dir, api: fakeApi,
      stages: { smoketest: { build: () => 'S' } },
      onAdvance: () => {},
      lockFor: (stageName, sid) => {
        if (stageName !== 'smoketest') return null;
        lockCalls++;
        return Promise.resolve({ release() { releaseCount++; } });
      },
    });
    runner.start();
    await tick(50);
    assert.equal(lockCalls, 1, 'lockFor invoked for smoketest');
    writeFileSync(join(dir, 'done', 'smoketest.done'), '');
    await tick(150);
    runner.stop();
    assert.equal(releaseCount, 1, 'lock released when smoketest completes');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runner triggers fix sub-workflow on smoketest failure when retries available', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wflb-'));
  try {
    const id = 'wf-loop';
    const dir = initFolder(root, id);
    const s = state.createState({ id, title: 't', description: 'd', projectId: 'p', branch: 'feat/x' });
    s.currentStage = 'smoketest';
    s.smoketestResult = { status: 'failed', failures: [{ item: 'x', actual: 'y' }] };
    state.write(dir, s);
    // pre-create existing markers as if the previous stages completed
    writeFileSync(join(dir, 'done', 'planning.done'), '');
    writeFileSync(join(dir, 'done', 'issues.done'), '');
    writeFileSync(join(dir, 'done', 'pipeline.done'), '');

    const advances = [];
    const fakeApi = {
      createSession: () => 'sess', closeSession: () => {}, log: () => {},
    };
    const runner = createRunner({
      dir, api: fakeApi,
      stages: { planning: { build: () => 'P' }, smoketest: { build: () => 'S' } },
      onAdvance: (u) => advances.push(u.currentStage),
      maxFixAttempts: 2,
    });
    runner.start();
    await tick(50);
    writeFileSync(join(dir, 'done', 'smoketest.done'), '');
    await tick(150);
    runner.stop();

    const final = state.read(dir);
    assert.equal(final.fixAttempts.length, 1, 'one fix attempt recorded');
    assert.equal(final.currentStage, 'planning', 'stage rolled back to planning');
    assert.equal(final.smoketestResult, null, 'smoketestResult cleared');
    // existing markers should have been removed
    assert.ok(!require('node:fs').existsSync(join(dir, 'done', 'pipeline.done')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runner re-spawns stage once on .failed marker, then gives up on second failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wfsh-'));
  try {
    const id = 'wf-h';
    const dir = initFolder(root, id);
    state.write(dir, state.createState({ id, title: 't', description: 'd', projectId: 'p', branch: 'feat/x' }));
    const spawns = [];
    const fakeApi = {
      createSession: () => { spawns.push(Date.now()); return 's'; },
      closeSession: () => {}, log: () => {},
    };
    const runner = createRunner({ dir, api: fakeApi, stages: {
      planning: { build: () => 'p' }, issues: { build: () => 'i' },
    }, onAdvance: () => {} });
    runner.start();
    await tick();
    writeFileSync(join(dir, 'done', 'planning.failed'), 'first failure');
    await tick(150);
    assert.equal(spawns.length, 2, 'initial + 1 retry');
    writeFileSync(join(dir, 'done', 'planning.failed'), 'second failure');
    await tick(150);
    runner.stop();
    assert.equal(state.read(dir).currentStage, 'failed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runner closes GitHub issue after CI passes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wfci-'));
  try {
    const id = 'wf-ci';
    const dir = initFolder(root, id);
    const s = state.createState({ id, title: 't', description: 'd', projectId: 'p', branch: 'feat/x' });
    s.currentStage = 'pipeline';
    s.githubRepo = 'owner/repo';
    s.pr = { number: 42, url: 'https://github.com/owner/repo/pull/42' };
    s.issues = [{ number: 7, title: 'Do thing', order: 1, status: 'pushed', dependencies: [], body: '' }];
    state.write(dir, s);

    const closedIssues = [];
    const fakeApi = { createSession: () => 'sess', closeSession: () => {}, log: () => {}, inputToSession: () => {} };
    const runner = createRunner({
      dir,
      api: fakeApi,
      stages: {
        pipeline: { build: () => 'P', extraArgs: [] },
        'manual-setup': { build: () => 'M' },
        smoketest: { build: () => 'S' },
        'obsidian-record': { build: () => 'O' },
      },
      onAdvance: () => {},
      _pollPrChecks: async () => ({ state: 'passed' }),
      _closeIssue: (repo, num) => closedIssues.push({ repo, num }),
    });

    runner.start();
    await tick(50);
    writeFileSync(join(dir, 'done', 'step.done'), '');
    await tick(200);
    runner.stop();

    assert.equal(closedIssues.length, 1, 'one issue closed');
    assert.equal(closedIssues[0].repo, 'owner/repo');
    assert.equal(closedIssues[0].num, 7);
    assert.equal(state.read(dir).issues[0].status, 'done');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runner closes GitHub issue when no PR yet (optimistic path)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wfnp-'));
  try {
    const id = 'wf-nopr';
    const dir = initFolder(root, id);
    const s = state.createState({ id, title: 't', description: 'd', projectId: 'p', branch: 'feat/x' });
    s.currentStage = 'pipeline';
    s.githubRepo = 'owner/repo';
    s.pr = null; // no PR yet
    s.issues = [{ number: 3, title: 'First', order: 1, status: 'pushed', dependencies: [], body: '' }];
    state.write(dir, s);

    const closedIssues = [];
    const fakeApi = { createSession: () => 'sess', closeSession: () => {}, log: () => {}, inputToSession: () => {} };
    const runner = createRunner({
      dir,
      api: fakeApi,
      stages: {
        pipeline: { build: () => 'P', extraArgs: [] },
        'manual-setup': { build: () => 'M' },
        smoketest: { build: () => 'S' },
        'obsidian-record': { build: () => 'O' },
      },
      onAdvance: () => {},
      _closeIssue: (repo, num) => closedIssues.push({ repo, num }),
    });

    runner.start();
    await tick(50);
    writeFileSync(join(dir, 'done', 'step.done'), '');
    await tick(200);
    runner.stop();

    assert.equal(closedIssues.length, 1, 'issue closed even without a PR');
    assert.equal(closedIssues[0].repo, 'owner/repo');
    assert.equal(closedIssues[0].num, 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runner skips close for local synthetic issue IDs (T-prefix)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wfsy-'));
  try {
    const id = 'wf-syn';
    const dir = initFolder(root, id);
    const s = state.createState({ id, title: 't', description: 'd', projectId: 'p', branch: 'feat/x' });
    s.currentStage = 'pipeline';
    s.githubRepo = null; // local mode
    s.issues = [{ number: 'T1', title: 'Local', order: 1, status: 'pushed', dependencies: [], body: '' }];
    state.write(dir, s);

    const closedIssues = [];
    const fakeApi = { createSession: () => 'sess', closeSession: () => {}, log: () => {}, inputToSession: () => {} };
    const runner = createRunner({
      dir,
      api: fakeApi,
      stages: {
        pipeline: { build: () => 'P', extraArgs: [] },
        'manual-setup': { build: () => 'M' },
        smoketest: { build: () => 'S' },
        'obsidian-record': { build: () => 'O' },
      },
      onAdvance: () => {},
      _closeIssue: (repo, num) => closedIssues.push({ repo, num }),
    });

    runner.start();
    await tick(50);
    writeFileSync(join(dir, 'done', 'step.done'), '');
    await tick(200);
    runner.stop();

    assert.equal(closedIssues.length, 0, 'no close for local synthetic IDs');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runner marks failed when max fix attempts exceeded', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wfmx-'));
  try {
    const id = 'wf-max';
    const dir = initFolder(root, id);
    const s = state.createState({ id, title: 't', description: 'd', projectId: 'p', branch: 'feat/x' });
    s.currentStage = 'smoketest';
    s.smoketestResult = { status: 'failed', failures: [{ item: 'x' }] };
    s.fixAttempts = [{}, {}];
    state.write(dir, s);

    const fakeApi = { createSession: () => 'sess', closeSession: () => {}, log: () => {} };
    const runner = createRunner({
      dir, api: fakeApi,
      stages: { smoketest: { build: () => 'S' } },
      onAdvance: () => {},
      maxFixAttempts: 2,
    });
    runner.start();
    await tick(50);
    writeFileSync(join(dir, 'done', 'smoketest.done'), '');
    await tick(150);
    runner.stop();
    assert.equal(state.read(dir).currentStage, 'failed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
