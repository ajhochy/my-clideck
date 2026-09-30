const path = require('node:path');
const { join } = path;

function build(s, dir) {
  const stageName = 'issues';
  const retryContext = (s.stageFailures?.[stageName]?.length)
    ? `\nPRIOR ATTEMPT FAILED — address these failures before continuing:\n${s.stageFailures[stageName].join('\n---\n')}\n`
    : '';
  const pluginRoot = path.resolve(__dirname, '..', '..');
  return `Issue-creation agent for CliDeck Workflow ${s.title || s.id}.
CONTEXT FILE: ${join(dir, 'state.json')} — source is the \`plan\` field's atomic steps.
${retryContext}
After starting each step, bump progress:
\`node ${pluginRoot}/bin/report-progress.js ${dir} issues <step> 5 "<label>"\`
Labels: 1=detect-repo, 2=create-issues, 3=order, 4=write-state, 5=signal.

STEP 1 — Detect repository. Run \`gh repo view --json nameWithOwner\` (or \`git remote get-url origin\`). If GitHub is detected, set state.githubRepo = "<owner>/<name>"; otherwise leave null and proceed in local-TODO mode.

STEP 2 — Create issues (or local TODOs).
Before creating, FILTER OUT any plan.steps whose purpose is end-to-end smoketesting, UI-evidence capture, screenshot capture, headless-browser playthrough, or final-build verification. Those are the smoketest stage's job (codex, post-pipeline) — they are not pipeline issues. Heuristics to drop a step: title contains "smoketest", "evidence", "playthrough", "screenshot capture", or it's the literal "Verify build + commit" wrap-up step. Per-step unit-level verification is fine and stays.
GitHub mode: create one milestone titled "${s.title || 'Workflow'}". For each remaining atomic step in plan.steps, create a GitHub issue under it via \`gh issue create --milestone …\` — title = step title, body = step body verbatim (file paths, function names, expected behavior, dependencies, coherence-rule refs). Capture the issue numbers.
Local mode: build synthetic IDs (T1, T2, …) with identical bodies.

STEP 3 — Suggest implementation order from atomic-step dependencies (no-dep first, downstream after). Record dependency edges so Stage 3 can verify.

STEP 4 — Write state.issues:
[ { "number": 34 | "T1", "title": "...", "order": 1, "dependencies": [], "body": "..." }, ... ]

STEP 5 — Print \`WORKFLOW_STAGE_DONE: issues\`, then \`touch ${join(dir, 'done', 'issues.done')}\`.

ON FAILURE: write a brief failure description to ${join(dir, 'done', 'issues.failed')} instead of the .done marker.
`;
}

module.exports = { preset: 'claude-code', build };
