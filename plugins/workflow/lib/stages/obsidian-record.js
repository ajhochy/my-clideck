const { join } = require('node:path');

// Post-smoketest record-keeper. Only runs when smoketest passed (the runner
// skips straight to 'done' on smoketest failure). Writes a permanent entry to
// the user's Obsidian vault summarising what was accomplished, then signals
// the next stage transition. Distinct from the workflow plugin's own
// finalize() Rhythm notification — that one fires on every done/failed; this
// one captures the longer-form record for the user's memory.
function build(s, dir) {
  const stageName = 'obsidian-record';
  const retryContext = (s.stageFailures?.[stageName]?.length)
    ? `\nPRIOR ATTEMPT FAILED — address these failures before continuing:\n${s.stageFailures[stageName].join('\n---\n')}\n`
    : '';
  const title = s.title || s.id;
  const issuesDone = Array.isArray(s.issues) ? s.issues.filter((i) => i.status === 'done').length : 0;
  const issuesTotal = Array.isArray(s.issues) ? s.issues.length : 0;
  const fixCount = Array.isArray(s.fixAttempts) ? s.fixAttempts.length : 0;
  const prInfo = s.pr?.url
    ? s.pr.url
    : (s.pr?.number && s.githubRepo ? `https://github.com/${s.githubRepo}/pull/${s.pr.number}` : '(no PR)');
  // Vault convention is `Dev Projects/<repo-name>.md` (the user already keeps
  // per-project notes there for every repo they work in). Derive the repo
  // short-name from state.githubRepo; fall back to title-slug if there's no
  // GitHub remote at all (local-TODO mode).
  const repoShortName = s.githubRepo ? s.githubRepo.split('/').pop() : null;
  const fileSlug = (repoShortName || title || s.id).replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
  const obsidianPath = `Dev Projects/${fileSlug}.md`;
  return `Workflow record-keeper for CliDeck Workflow ${s.id}.
CONTEXT FILE: ${join(dir, 'state.json')} — read it for full detail.
${retryContext}
The pipeline finished and the smoketest passed. Your one job is to write a permanent record entry to the user's Obsidian vault and then signal completion. No code work, no PR work, no extra inspection — keep it tight.

STEP 1 — Compose a markdown entry. Use this exact shape:

### ${new Date().toISOString().slice(0, 10)} — ${title.replace(/[\r\n]/g, ' ')}
- **Repo:** ${s.githubRepo || '(none)'}
- **Branch:** \`${s.branch || '(none)'}\`
- **PR:** ${prInfo}
- **Issues:** ${issuesDone}/${issuesTotal} completed
- **Fix attempts:** ${fixCount}${fixCount ? ' (smoketest failed and was re-planned)' : ''}
- **Smoketest:** passed
- **What was accomplished:** (2–4 sentences in your own words, derived from state.description and state.plan — not a literal copy)
- **Notable decisions or trade-offs:** (1–2 sentences if any are evident in state.plan or state.fixAttempts; otherwise omit this bullet)

STEP 2 — Append it to the Obsidian vault via the obsidian MCP tool. Target file:
  \`${obsidianPath}\`
This is the user's per-project Dev Project note (their existing convention — every repo has one here). Use \`mcp__obsidian__obsidian_post_file\` (NOT put — that would overwrite the whole file). If the file doesn't exist yet, post creates it. Do not include any frontmatter; just append the markdown entry. Do NOT write to \`Workflows/\` — that path is wrong.

STEP 3 — Send a Rhythm notification via \`mcp__rhythm__rhythm_notify\` with:
  title: "Workflow complete: ${title.replace(/"/g, '\\"').slice(0, 60)}"
  body: a one-sentence summary including the PR URL.

STEP 4 — Print \`WORKFLOW_STAGE_DONE: obsidian-record\`, then \`touch ${join(dir, 'done', 'obsidian-record.done')}\` and EXIT.

ON FAILURE (e.g. Obsidian MCP unreachable): write a brief failure note to ${join(dir, 'done', 'obsidian-record.failed')} instead. Do not retry forever — one attempt is enough.
`;
}

// Record-keeping is mechanical: read state.json, fill a template, call two
// MCP tools, drop a marker. Haiku is plenty for that and an order of magnitude
// cheaper than Sonnet for something that runs on every successful workflow.
module.exports = { preset: 'claude-code', extraArgs: ['--model', 'haiku'], build };
