# Project State — my-clideck

## Current focus
Personal downstream fork of [rustykuntz/clideck](https://github.com/rustykuntz/clideck). Active work centers on the home-grown **`workflow` plugin** (`plugins/workflow/`) — the issue-pipeline / autopilot orchestration layer that drives GitHub issues to PRs with Node-side CI polling, plus the Obsidian/memory logging integrations.

## Active branch / PR
- Branch: `main`
- Uncommitted working-tree changes (not committed by this consolidation): edits across `plugins/workflow/` (`client.js`, `index.js`, `lib/branch.js`, `lib/ci-poller.js`, `lib/rhythm.js`, `lib/runner.js`, `lib/stages/{issues,pipeline,planning}.js`, `lib/state.js`, several `test/*`), `plugin-loader.js`, `public/js/settings.js`; untracked `plugins/workflow/lib/stages/obsidian-record.js`, `tools/{launch-server.zsh,memory-stop-hook.js,repatch-codex.js,resume-workflow.js}`, `docs/{local-server.md,memory-stop-hook.md}`.

## In progress
- Workflow plugin reliability sweep (1.2.x → 1.3.x): plugin-gate removal, launchd PATH/FDA fix, presetId-wipe fix, per-step worker model swap, bracketed-paste race fix, no-checks grace window.
- `obsidian-record` pipeline stage + deterministic Stop-hook logging — being superseded by the canonical `docs/ai/` logging model (this consolidation).

## Risks / known issues
- Two remotes with opposite roles: `plugin` (ajhochy/my-clideck) is this fork's home; `origin` (rustykuntz/clideck) is upstream. Push fork work to `plugin`, never `origin`.
- Runs at `0.0.0.0:4000` and is accessed remotely; any restart must preserve `--host 0.0.0.0` on port 4000.
- `package.json` still carries upstream identity (`name: clideck`, author Or Kuntzman) — intentional; this is a fork, not a rename.

## Test status
`node --test` across root `test/` and `plugins/workflow/test/` (18 workflow test files). Last recorded run before consolidation: workflow suite green (77/77 at the time of the runner issue-close fix).

## Next step
Land the workflow reliability changes in the working tree, then adopt `docs/ai/` logging going forward (retire the old Obsidian `obsidian_post_file` log path).

**Run history:** one file per run under `docs/ai/runs/` (surfaced as `ai-runs/`). This snapshot is overwritten in place.
