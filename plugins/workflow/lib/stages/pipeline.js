const { join } = require('node:path');
const path = require('node:path');
const { isValidBranch } = require('../branch');

function pickNextIssue(issues) {
  if (!Array.isArray(issues)) return null;
  const ordered = [...issues].sort((a, b) => (a.order || 0) - (b.order || 0));
  return ordered.find((i) => i.status !== 'done') || null;
}

function build(s, dir) {
  if (!isValidBranch(s.branch)) {
    throw new Error(
      `pipeline: state.branch is not a valid git ref name (got ${JSON.stringify(s.branch)}). ` +
      `Edit ${join(dir, 'state.json')} and set "branch" to a slug like "feat/snake-game" before resuming.`,
    );
  }
  const summaryJsPath = path.resolve(__dirname, '..', 'summary.js');
  const pluginRoot = path.resolve(__dirname, '..', '..');
  const stageName = 'pipeline';
  const retryContext = (s.stageFailures?.[stageName]?.length)
    ? `\nPRIOR ATTEMPT FAILED — address these failures before continuing:\n${s.stageFailures[stageName].join('\n---\n')}\n`
    : '';
  const next = pickNextIssue(s.issues);
  if (next) return buildStepPrompt({ s, dir, issue: next, retryContext, pluginRoot });
  return buildFinalizePrompt({ s, dir, retryContext, summaryJsPath });
}

function buildStepPrompt({ s, dir, issue, retryContext, pluginRoot }) {
  const ciFailureCtx = (issue.status === 'fix-needed' && issue.lastCiFailure)
    ? `\nCI FAILED on the previous push. Failed: ${JSON.stringify(issue.lastCiFailure.failed?.map((f) => f.name) || [])}. Read failure logs (\`gh run view <run-id> --log-failed --repo ${s.githubRepo}\` or the link in state.issues[*].lastCiFailure), fix the cause, re-verify, then commit + push the fix.\n`
    : '';

  const doneCount = (s.issues || []).filter((i) => i.status === 'done').length;
  const total = (s.issues || []).length;
  return `Per-step pipeline worker for CliDeck Workflow ${s.id}.
Execute EXACTLY ONE plan step then exit. The runner spawns you again for the next step — do not loop.

CONTEXT FILE: ${join(dir, 'state.json')}
THIS STEP: state.issues entry with order=${issue.order}, number=${issue.number}, title="${issue.title || ''}". Read its \`body\` — that is your spec.

BRANCH (use this EXACT string for every git operation; do NOT derive from state.title or anywhere else):
    ${s.branch}
The runner has already validated this against \`git check-ref-format --branch\`. Quote it in shell commands but do NOT modify, slugify, or substitute it.
${retryContext}${ciFailureCtx}
Follow the \`issue-pipeline\` skill's per-issue worker protocol (Step 4a) for the standard implement → verify → commit flow. Invoke it with the Skill tool. Apply these CliDeck overrides:

- Worktree: \`git worktree add ../wt-${s.id}-${issue.number} ${s.branch}\` if not already present (or reuse an existing checkout already on \`${s.branch}\`); cd in.
- Repo is \`${s.githubRepo}\`. Branch is \`${s.branch}\` (NOT the workflow title). Issue is #${issue.number}.
- Push to the \`plugin\` remote: \`git push plugin ${s.branch}\` (NOT origin).
- Commit subject: \`feat(${issue.number}): ${(issue.title || '').replace(/`/g, "'")}\`. Body MUST include a "Verified by:" line listing the exact verification commands you ran.
- For static-web projects without a test runner, verify with \`python3 -m http.server\` + headless Chrome via DevTools Protocol and save console errors + failed requests + screenshot under \`pipeline-evidence/issue-${issue.number}/\`.
- DO NOT close the issue and DO NOT watch CI — the runner polls and closes on green.
- If state.pr is unset, open a draft PR before exiting: \`gh pr create --repo ${s.githubRepo} --draft --title "${(s.title || s.id).replace(/"/g, '\\"')}" --body "Workflow ${s.title || s.id} — in progress"\`. Save \`{number, url}\` to state.pr.

After push, finalize this step:
- Set state.issues[this].status = 'pushed'; append commit sha to state.issues[this].commits.
- \`node ${pluginRoot}/bin/report-progress.js ${dir} pipeline ${doneCount} ${total} "issue ${issue.number} pushed, awaiting CI"\` (count \`done\`, not \`pushed\`).
- \`touch ${join(dir, 'done', 'step.done')}\` and EXIT.

ON FAILURE: write brief failure to ${join(dir, 'done', 'step.failed')} instead of step.done.
`;
}

function buildFinalizePrompt({ s, dir, retryContext, summaryJsPath }) {
  return `Pipeline finalizer for CliDeck Workflow ${s.title || s.id}. All ${(s.issues || []).length} steps are CI-green.
CONTEXT FILE: ${join(dir, 'state.json')}
${retryContext}
1 — Gather manual setup. Scan the diff (${s.branch} vs origin default) + issue bodies for human-required setup (API keys, env vars, Actions secrets, webhooks, DNS, etc.). Preserve any existing \`confirmedAt\` values when re-writing. Write state.manualSetup:
[ { "title": "Generate Stripe API key", "steps": ["...", "..."] }, ... ]

2 — Rhythm task. If state.rhythmAvailable, call the rhythm MCP tool \`rhythm_create_task\` (i.e. \`mcp__rhythm__rhythm_create_task\`) with \`title\` = "Manual setup for Workflow ${s.id}: ${s.title || ''}" and \`notes\` = a markdown checklist built from state.manualSetup (one \`- [ ] ...\` line per item, with sub-bullets for steps). Save \`{id, url}\` (whatever the tool returns) to state.rhythmTask. Else leave state.rhythmTask null.

3 — Summary.
- \`mkdir -p .clideck-workflow/summaries\`
- Write \`.clideck-workflow/summaries/${s.id}-summary.md\` (Description, Issues with PR commit shas, Manual setup needed).
- Mirror: \`node -e "const {writeSummary}=require('${summaryJsPath}'); const fs=require('fs'); writeSummary('${dir}', fs.readFileSync('.clideck-workflow/summaries/${s.id}-summary.md','utf8'))"\`
- \`gh pr edit <state.pr.number> --repo ${s.githubRepo} --body-file .clideck-workflow/summaries/${s.id}-summary.md\`

4 — Print \`WORKFLOW_STAGE_DONE: pipeline\`, then \`touch ${join(dir, 'done', 'pipeline.done')}\`.

ON FAILURE: write brief failure to ${join(dir, 'done', 'pipeline.failed')} instead.
`;
}

// Per-step pipeline workers do mechanical implement → verify → commit cycles.
// Sonnet handles this faster and cheaper than Opus; the planning + issues stages
// (which still default to whatever the user has configured) handle the harder
// design-and-decompose work.
module.exports = { preset: 'claude-code', extraArgs: ['--model', 'sonnet'], build, pickNextIssue };
