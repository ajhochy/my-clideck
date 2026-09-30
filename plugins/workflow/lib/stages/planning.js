const path = require('node:path');
const { join } = path;
const fixmod = require('../fix-subworkflow');

function build(s, dir) {
  if (s.fixAttempts && s.fixAttempts.length > 0) {
    return fixmod.buildFixPrompt(s, dir);
  }
  const stageName = 'planning';
  const retryContext = (s.stageFailures?.[stageName]?.length)
    ? `\nPRIOR ATTEMPT FAILED — address these failures before continuing:\n${s.stageFailures[stageName].join('\n---\n')}\n`
    : '';
  const pluginRoot = path.resolve(__dirname, '..', '..');
  return `Planning lead for CliDeck Workflow ${s.title || s.id} (folder: ${dir}).
MODEL: switch to Opus before beginning — planning needs deeper reasoning.
CONTEXT FILE: ${join(dir, 'state.json')} — read it first; user description is in \`description\`.
${retryContext}
Execute these 6 phases in order; do not skip. After starting each phase, bump progress:
\`node ${pluginRoot}/bin/report-progress.js ${dir} planning <phase> 6 "<label>"\`
Labels: 1=explore, 2=clarify, 3=design, 4=write-plan, 5=write-state, 6=signal-completion.

PHASE 1 — Explore the codebase. Dispatch Haiku subagents (Explore or feature-dev:code-explorer) to map architecture/conventions, files relevant to "${s.description.slice(0, 200)}", and patterns the work must follow. Wait for all to return.

PHASE 2 — Ask clarifying questions one or two at a time until you understand success. User answers via terminal or workflow panel.

PHASE 3 — Design the architecture that aligns with the existing codebase. Do not ask the user about architecture.

PHASE 4 — Write the plan as atomic steps. Each step MUST contain: file paths (with line ranges where relevant), function/symbol names, expected behavior, dependencies, coherence rules. Each atomic step must be self-contained — no re-reading the codebase to execute it.

DO NOT include smoketest, end-to-end UI verification, headless-browser evidence capture, screenshot capture, "manual playthrough", or final-build verification as plan steps. The dedicated smoketest stage runs after the pipeline using codex with sandbox bypass and is responsible for ALL UI/integration verification. Per-step pipeline workers only do per-issue implement → unit-verify → commit. Examples to OMIT from the plan: "Smoketest evidence capture", "Verify final build + commit", "Capture playthrough video", "Run full integration test in browser". Each implementation step's own per-issue verification (unit tests, type checks, lint) is fine — that's not what this rule restricts.

PHASE 5 — Write \`state.json.plan = { steps: [...], coherenceRules: [...] }\` via node script or jq, not hand-edit.

PHASE 6 — Print \`WORKFLOW_STAGE_DONE: planning\`, then \`touch ${join(dir, 'done', 'planning.done')}\` and stop.

ON FAILURE: write a brief failure description to ${join(dir, 'done', 'planning.failed')} instead of the .done marker, then stop.
`;
}

module.exports = { preset: 'claude-code', build };
