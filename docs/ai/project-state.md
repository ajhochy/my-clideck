---
type: project
---

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

## Consolidation 2026-09-29
Non-destructive git consolidation. Nothing was deleted; the cleanup script below is for the user to review and run.
- **Mega branch:** `mega/2026-09-29-consolidation` (push remote is `plugin` = ajhochy/my-clideck; `origin` = upstream rustykuntz/clideck, never pushed to). PR: https://github.com/ajhochy/my-clideck/pull/41. Tracking issue: https://github.com/ajhochy/my-clideck/issues/42.
- **Folded:** `wip/my-clideck-2026-09-29` (bd27b13) = WIP snapshot of the main checkout (the "Uncommitted working-tree changes" listed above are now committed on mega).
- **Dropped (all preserved in bundle `~/Documents/.consolidation-backups/my-clideck-2026-09-29.bundle`):**
  - Already merged into `plugin/main` (ancestor): `claude/elated-mahavira-15a20f` (dcae68d), `claude/elated-ritchie-cdd98e` (03f48e9), `claude/peaceful-bassi-fc312a` (5d5576c), `claude/peaceful-moore-18d0c2` (086c5c7), `claude/romantic-yonath-9f83b6` (2cd05b3), `feat/cli-deck-3` (355c564), `feat/codex-config-stable` (5ab7e6a), `feat/delete-fix` (72b569e), `feat/lean-pipeline` (5104372), `feat/lean-pipeline-pr` (0d0e8c4), `feat/workflow-plugin` (aec51ba), `ui-progress-update` (5684f57); remote `plugin/feat/cli-deck-3`, `plugin/feat/codex-config-stable`, `plugin/feat/delete-fix`, `plugin/feat/workflow-names` (b66a121).
  - `plugin/ui-progress-update` (eda3b83): one commit already on main by patch-id (`git cherry` all `-`, empty 3-dot diff).
  - `feat/workflow-names` local tip (4848e6a): only a WIP commit adding scratch `project-kb.md`, which `.gitignore` lists deliberately (never commit ignored files). Plain-file copy: `~/Documents/.consolidation-backups/my-clideck--clideck-workflow-plugin--project-kb.md.2026-09-29`.
  - `stash-backup/0-2026-09-29` (de50f4b, stash `wf-2026-05-07-auccob: pre-pipeline stash`): superseded; `git merge-tree` of it into `plugin/main` yields the identical tree (the handlers.js change already landed, newer form).
- **In-flight worktrees:** none live (no cwd processes). Linked worktrees `~/Documents/clideck-workflow-plugin` and `.claude/worktrees/{elated-ritchie-cdd98e,peaceful-bassi-fc312a}` are slated for removal by the cleanup script. `~/.clideck/config.json` still lists `clideck-workflow-plugin` as a project path; remove it in CliDeck after cleanup.
- **Stale lock:** `.git/index.lock` (empty, dated 2026-06-19, no owning process) blocked commits in the main checkout; moved (not deleted) to `~/Documents/.consolidation-backups/my-clideck-stale-index.lock-2026-06-19`.
- **Cleanup script (not executed):** `~/Documents/.consolidation-backups/cleanup/my-clideck-2026-09-29-cleanup.sh` (manifest alongside as `my-clideck-2026-09-29-manifest.json`).
