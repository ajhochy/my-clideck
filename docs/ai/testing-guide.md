# Testing Guide — my-clideck

## How to test
Tests use the built-in Node test runner (`node:test` + `node:assert/strict`) — no test framework dependency.

```bash
# Root tests (codex-config, telemetry-tokens)
node --test test/

# Workflow plugin tests (18 files)
node --test plugins/workflow/test/

# Everything
node --test test/ plugins/workflow/test/

# CSS build (must succeed before publish)
npm run build:css
```

A pre-commit hook (`.githooks/pre-commit`) runs `tools/bump-plugin-versions.js` to auto-bump plugin manifest versions when plugin code is staged — required so `plugin-loader.js` doesn't serve stale code from `~/.clideck/plugins/<id>/`.

## Coverage notes
- **Well covered:** the `workflow` plugin — runner state machine, CI poller, branch/PR plumbing, all pipeline stages (issues, planning, pipeline, smoketest), state/progress, logger, summary, install-skills, smoketest-lock, workflow-folder. ~18 test files.
- **Root:** `codex-config` and `telemetry-tokens` only.
- **Not covered by automated tests:** the core server (`server.js`, `sessions.js`, `handlers.js`), PTY/WebSocket I/O, the browser UI in `public/`, and live agent telemetry — these are validated by running the app and exercising sessions manually.
