const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

const TERMINAL_FAIL = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const TERMINAL_PASS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const PENDING = new Set(['IN_PROGRESS', 'PENDING', 'QUEUED', 'WAITING', 'REQUESTED']);

// `gh pr checks --json` dropped the `conclusion` field in favor of `bucket`
// (values: pass | fail | pending | skipping | cancel). We request `bucket`
// from gh, but `summarize` still accepts the legacy `conclusion` shape so
// older gh versions and existing tests keep working.
async function fetchChecks(prNumber, repo) {
  const { stdout } = await exec('gh', [
    'pr', 'checks', String(prNumber),
    '--repo', repo,
    '--json', 'bucket,state,name,link,workflow',
  ]);
  return JSON.parse(stdout);
}

function classify(check) {
  // 1. New gh schema: `bucket` is authoritative.
  if (check.bucket) {
    const b = String(check.bucket).toLowerCase();
    if (b === 'pass') return 'pass';
    if (b === 'fail') return 'fail';
    if (b === 'cancel') return 'fail';
    if (b === 'skipping') return 'pass';
    if (b === 'pending') return 'pending';
  }
  // 2. Legacy gh schema: derive from conclusion/state.
  const raw = (check.conclusion || check.state || '').toUpperCase();
  if (TERMINAL_FAIL.has(raw)) return 'fail';
  if (TERMINAL_PASS.has(raw)) return 'pass';
  if (PENDING.has(raw) || raw === '') return 'pending';
  return 'pending';
}

function summarize(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return { state: 'no-checks' };
  const verdicts = checks.map(classify);
  if (verdicts.some((v) => v === 'pending')) return { state: 'pending' };
  const failed = checks.filter((_, i) => verdicts[i] === 'fail');
  if (failed.length) return { state: 'failed', failed };
  return { state: 'passed' };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// noChecksGraceMs: how long we tolerate `no-checks` before concluding the
// PR has no CI configured (or none triggered) and treating it as a pass.
// GitHub Actions can take 20–30s to enqueue a workflow, so we wait at least
// that long before declaring "no CI on this repo, move on".
async function pollPrChecks({
  prNumber,
  repo,
  intervalMs = 10000,
  timeoutMs = 30 * 60 * 1000,
  noChecksGraceMs = 60 * 1000,
  onPoll = () => {},
}) {
  const start = Date.now();
  let firstNoChecksAt = null;
  while (Date.now() - start < timeoutMs) {
    let summary;
    try {
      const checks = await fetchChecks(prNumber, repo);
      summary = summarize(checks);
    } catch (err) {
      summary = { state: 'no-checks', error: err.message };
    }
    onPoll(summary);
    if (summary.state === 'passed' || summary.state === 'failed') return summary;
    if (summary.state === 'no-checks') {
      if (firstNoChecksAt == null) firstNoChecksAt = Date.now();
      if (Date.now() - firstNoChecksAt >= noChecksGraceMs) {
        return { ...summary, reason: 'no-checks-after-grace' };
      }
    } else {
      // pending again — reset the no-checks grace clock.
      firstNoChecksAt = null;
    }
    await sleep(intervalMs);
  }
  return { state: 'timeout' };
}

module.exports = { pollPrChecks, fetchChecks, summarize };
