const test = require('node:test');
const assert = require('node:assert/strict');
const branch = require('../lib/branch');

test('slugFromTitle generates feat/<kebab>', () => {
  assert.equal(branch.slugFromTitle('Add Login Throttling'), 'feat/add-login-throttling');
  assert.equal(branch.slugFromTitle('Fix: bug in checkout!'), 'feat/fix-bug-in-checkout');
});

test('slugFromTitle truncates and falls back', () => {
  assert.equal(branch.slugFromTitle(''), 'feat/workflow');
  assert.match(branch.slugFromTitle('a'.repeat(200)), /^feat\/a{1,60}$/);
});

test('isCollision returns true when branch is in inFlight set', () => {
  assert.equal(branch.isCollision('feat/x', new Set(['feat/x'])), true);
  assert.equal(branch.isCollision('feat/y', new Set(['feat/x'])), false);
});

test('isValidBranch accepts conforming names', () => {
  assert.equal(branch.isValidBranch('feat/snake-game'), true);
  assert.equal(branch.isValidBranch('fix/bug_123'), true);
  assert.equal(branch.isValidBranch('release/1.2.0'), true);
});

test('isValidBranch rejects names that violate git ref-format', () => {
  assert.equal(branch.isValidBranch(''), false);
  assert.equal(branch.isValidBranch('iOS native port of the GBC Snake game'), false);
  assert.equal(branch.isValidBranch('feat/has space'), false);
  assert.equal(branch.isValidBranch('feat/double..dot'), false);
  assert.equal(branch.isValidBranch('-leading-dash'), false);
  assert.equal(branch.isValidBranch('.leading-dot'), false);
  assert.equal(branch.isValidBranch('trailing/'), false);
  assert.equal(branch.isValidBranch('trailing.'), false);
  assert.equal(branch.isValidBranch('foo.lock'), false);
  assert.equal(branch.isValidBranch('feat//double-slash'), false);
  assert.equal(branch.isValidBranch('@'), false);
  assert.equal(branch.isValidBranch('has~tilde'), false);
  assert.equal(branch.isValidBranch('has\\back'), false);
});

test('sanitizeBranch coerces free-form input into a safe ref name', () => {
  assert.equal(branch.sanitizeBranch('iOS native port of the GBC Snake game'), 'iOS-native-port-of-the-GBC-Snake-game');
  assert.equal(branch.sanitizeBranch('feat: snake!'), 'feat-snake');
  assert.equal(branch.sanitizeBranch('  /weird///path..stuff..  '), 'weird/path.stuff');
});

test('sanitizeBranch returns null when nothing salvageable', () => {
  assert.equal(branch.sanitizeBranch(''), null);
  assert.equal(branch.sanitizeBranch('   '), null);
  assert.equal(branch.sanitizeBranch(null), null);
});

test('sanitizeBranch output is always isValidBranch-true', () => {
  for (const input of ['iOS native port', 'fix: bug!', 'feat/foo', 'a/b/c', '..weird..']) {
    const out = branch.sanitizeBranch(input);
    if (out !== null) assert.equal(branch.isValidBranch(out), true, `expected ${out} to be valid`);
  }
});
