# Current Plan — my-clideck

## Active plan
Keep the fork-specific `workflow` plugin reliable and self-driving. The plugin walks GitHub issues → branches → PRs with Node-side CI polling and per-step worker agents, and notifies via Rhythm on completion. Recent effort has been a reliability sweep (silent-failure fixes) plus migrating session logging onto the canonical `docs/ai/` model.

## Next steps
1. Land the in-flight working-tree changes across `plugins/workflow/` (runner, ci-poller, branch, stages) and `plugin-loader.js`.
2. Retire the old Obsidian `obsidian_post_file` logging path (`obsidian-record` stage + `tools/memory-stop-hook.js`); log to `docs/ai/runs/` and `docs/ai/decisions/` going forward.
3. Keep `package.json` version + plugin manifest versions in sync via the pre-commit bump hook.
4. Periodically rebase/merge desired upstream (`origin`) changes; push all fork work to `plugin`.

## Notes
No open GitHub issues — the board was cleared 2026-06-11 after a mis-filed batch (#26–#40) belonging to bulletin-generator was closed.
