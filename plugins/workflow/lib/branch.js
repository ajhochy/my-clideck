function slugFromTitle(title) {
  const cleaned = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  if (!cleaned) return 'feat/workflow';
  return `feat/${cleaned}`;
}

// Coerce arbitrary user input (free text, descriptions accidentally pasted as
// a branch name, etc.) into a git-ref-format-safe branch name. Returns null if
// the input cannot be sanitized into anything usable — caller should fall back.
function sanitizeBranch(input) {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;
  // Replace anything outside the safe alphabet with '-'.
  s = s.replace(/[^a-zA-Z0-9/_.-]/g, '-');
  // Collapse runs of '-' and '/'.
  s = s.replace(/-+/g, '-').replace(/\/+/g, '/');
  // Strip git-illegal sequences that survived (".." and "@{").
  s = s.replace(/\.\.+/g, '.').replace(/@\{/g, '-');
  // Trim leading/trailing junk that git rejects.
  s = s.replace(/^[-./]+/, '').replace(/[-./]+$/, '');
  // Strip ".lock" segment endings.
  s = s.replace(/\.lock(?=$|\/)/g, '');
  // Cap segment & total length so we don't produce 200-char branches.
  s = s.split('/').map((seg) => seg.slice(0, 60)).filter(Boolean).join('/');
  s = s.slice(0, 100);
  if (!s) return null;
  if (!isValidBranch(s)) return null;
  return s;
}

// Returns true iff the name conforms to git's check-ref-format rules
// for the subset we care about (local branch names).
function isValidBranch(name) {
  if (typeof name !== 'string' || !name) return false;
  if (name === '@' || name === 'HEAD') return false;
  if (/[\s~^:?*\[\\\x00-\x1f\x7f]/.test(name)) return false;
  if (name.includes('..') || name.includes('@{')) return false;
  if (name.startsWith('/') || name.startsWith('-') || name.startsWith('.')) return false;
  if (name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return false;
  if (name.includes('//')) return false;
  if (name.split('/').some((seg) => seg.startsWith('.') || seg.endsWith('.lock') || seg === '')) return false;
  return true;
}

function isCollision(name, inFlight) {
  return inFlight.has(name);
}

module.exports = { slugFromTitle, sanitizeBranch, isValidBranch, isCollision };
