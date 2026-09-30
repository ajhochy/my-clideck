// Rhythm App MCP client wrapper. Uses api.callMcp (plugin-loader.js) which
// merges MCP server config from ~/.claude.json and ~/.claude/settings.json.

async function probe(api) {
  try {
    const res = await api.callMcp('rhythm', 'list-tools', {});
    return Array.isArray(res?.tools);
  } catch { return false; }
}

async function createSetupTask(api, { title, items }) {
  const notes = items.map((it, i) => `- [ ] **${i + 1}. ${it.title}**\n${it.steps.map((s) => `   - ${s}`).join('\n')}`).join('\n\n');
  return api.callMcp('rhythm', 'rhythm_create_task', { title, notes });
}

// Build a compact completion summary and drop it into Rhythm as a task. We
// reuse rhythm_create_task (not rhythm_send_message — that one needs an
// existing thread id and isn't a fit for a self-contained "FYI done" ping).
// The user can archive/check it; the title is prefixed so they're easy to
// filter out of their work queue.
async function notifyCompletion(api, s) {
  const title = s.currentStage === 'failed'
    ? `❌ Workflow failed: ${s.title || s.id}`
    : `✅ Workflow complete: ${s.title || s.id}`;
  const lines = [];
  if (s.pr?.url) lines.push(`**PR:** ${s.pr.url}`);
  else if (s.pr?.number && s.githubRepo) lines.push(`**PR:** https://github.com/${s.githubRepo}/pull/${s.pr.number}`);
  if (s.githubRepo) lines.push(`**Repo:** ${s.githubRepo}`);
  if (s.branch) lines.push(`**Branch:** \`${s.branch}\``);
  const issues = Array.isArray(s.issues) ? s.issues : [];
  if (issues.length) {
    const done = issues.filter((i) => i.status === 'done').length;
    lines.push(`**Issues:** ${done}/${issues.length} completed`);
  }
  const fixCount = Array.isArray(s.fixAttempts) ? s.fixAttempts.length : 0;
  if (fixCount > 0) lines.push(`**Fix attempts:** ${fixCount} (smoketest failed and was re-planned)`);
  const sm = s.smoketestResult;
  if (sm?.status) lines.push(`**Smoketest:** ${sm.status}${(sm.failures || []).length ? ` (${sm.failures.length} failure${sm.failures.length === 1 ? '' : 's'})` : ''}`);
  const ms = Array.isArray(s.manualSetup) ? s.manualSetup : [];
  if (ms.length) {
    const confirmed = ms.filter((m) => m.confirmedAt).length;
    lines.push(`**Manual setup:** ${confirmed}/${ms.length} confirmed`);
  }
  if (s.description) {
    const firstLine = String(s.description).split('\n').find((l) => l.trim()) || '';
    if (firstLine) lines.push(`\n_${firstLine.slice(0, 200)}${firstLine.length > 200 ? '…' : ''}_`);
  }
  const notes = lines.join('\n');
  return api.callMcp('rhythm', 'rhythm_create_task', { title, notes });
}

module.exports = { probe, createSetupTask, notifyCompletion };
