const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const STAGES = ['planning', 'issues', 'pipeline', 'smoketest', 'obsidian-record', 'fix', 'done', 'failed'];

function createState({ id, title, description, projectId, githubRepo = null, branch = null, branchSource = 'auto' }) {
  const now = new Date().toISOString();
  return {
    id, title, description, projectId, githubRepo, branch, branchSource,
    currentStage: 'planning',
    plan: null,
    issues: [],
    manualSetup: [],
    rhythmTask: null,
    pr: null,
    smoketestResult: null,
    fixAttempts: [],
    stageFailures: {},
    stageProgress: {},
    createdAt: now,
    updatedAt: now,
  };
}

function statePath(dir) { return join(dir, 'state.json'); }

function read(dir) {
  return JSON.parse(readFileSync(statePath(dir), 'utf8'));
}

function write(dir, s) {
  writeFileSync(statePath(dir), JSON.stringify(s, null, 2));
}

function update(dir, mutator) {
  const s = read(dir);
  mutator(s);
  s.updatedAt = new Date(Date.now() + 1).toISOString();
  write(dir, s);
  return s;
}

function exists(dir) { return existsSync(statePath(dir)); }

module.exports = { STAGES, createState, read, write, update, exists };
