const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, pollPrChecks } = require('../lib/ci-poller');

test('summarize: empty checks → no-checks', () => {
  assert.deepEqual(summarize([]), { state: 'no-checks' });
});

test('summarize: any pending check → pending', () => {
  const checks = [
    { state: 'IN_PROGRESS', name: 'a' },
    { state: 'COMPLETED', conclusion: 'SUCCESS', name: 'b' },
  ];
  assert.equal(summarize(checks).state, 'pending');
});

test('summarize: all success → passed', () => {
  const checks = [
    { state: 'COMPLETED', conclusion: 'SUCCESS', name: 'a' },
    { state: 'COMPLETED', conclusion: 'SKIPPED', name: 'b' },
  ];
  assert.equal(summarize(checks).state, 'passed');
});

test('summarize: any failure → failed with the failed checks', () => {
  const checks = [
    { state: 'COMPLETED', conclusion: 'SUCCESS', name: 'a' },
    { state: 'COMPLETED', conclusion: 'FAILURE', name: 'b', link: 'http://x' },
  ];
  const r = summarize(checks);
  assert.equal(r.state, 'failed');
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].name, 'b');
});

// Modern gh schema (`bucket` field, no `conclusion`).
test('summarize: bucket=pass for all → passed', () => {
  const checks = [
    { bucket: 'pass', state: 'SUCCESS', name: 'a' },
    { bucket: 'skipping', state: 'SKIPPED', name: 'b' },
  ];
  assert.equal(summarize(checks).state, 'passed');
});

test('summarize: any bucket=pending → pending', () => {
  const checks = [
    { bucket: 'pending', state: 'IN_PROGRESS', name: 'a' },
    { bucket: 'pass', state: 'SUCCESS', name: 'b' },
  ];
  assert.equal(summarize(checks).state, 'pending');
});

test('summarize: bucket=fail surfaces failed entries', () => {
  const checks = [
    { bucket: 'pass', state: 'SUCCESS', name: 'a' },
    { bucket: 'fail', state: 'FAILURE', name: 'b', link: 'http://x' },
    { bucket: 'cancel', state: 'CANCELLED', name: 'c' },
  ];
  const r = summarize(checks);
  assert.equal(r.state, 'failed');
  assert.equal(r.failed.length, 2);
  assert.deepEqual(r.failed.map((c) => c.name).sort(), ['b', 'c']);
});

test('summarize: bucket takes precedence over legacy conclusion', () => {
  const checks = [
    // bucket says pass even though conclusion is missing
    { bucket: 'pass', state: 'COMPLETED', name: 'a' },
  ];
  assert.equal(summarize(checks).state, 'passed');
});

test('pollPrChecks: returns no-checks after grace period when CI never enqueues', async () => {
  // Bogus repo → gh exits non-zero → caught as { state: 'no-checks', error }.
  // intervalMs/grace tiny so the test is fast.
  const start = Date.now();
  const result = await pollPrChecks({
    prNumber: 999999,
    repo: 'this-org-does-not-exist-clideck-test/nope',
    intervalMs: 50,
    timeoutMs: 5000,
    noChecksGraceMs: 200,
  });
  const elapsed = Date.now() - start;
  assert.equal(result.state, 'no-checks');
  assert.equal(result.reason, 'no-checks-after-grace');
  // Should return shortly after grace elapses, not run the full 5s timeout.
  assert.ok(elapsed < 2000, `expected fast return, got ${elapsed}ms`);
});
