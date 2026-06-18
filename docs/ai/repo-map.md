# Repo Map — my-clideck

Personal fork of CliDeck. `origin` = upstream [rustykuntz/clideck](https://github.com/rustykuntz/clideck); `plugin` = this fork ([ajhochy/my-clideck](https://github.com/ajhochy/my-clideck)). Push fork work to `plugin`.

## Layout

```
/Users/ajhochhalter/Documents/my-clideck
├── server.js                 ← app entry (npm start); HTTP + WS server
├── sessions.js               ← agent session lifecycle (PTY spawn/resume/close)
├── handlers.js               ← request / WS message handlers
├── telemetry-receiver.js     ← OTel ingest → agent status
├── transcript*.js            ← transcript capture / parse / normalize
├── config.js paths.js runtime.js themes.js utils.js
├── codex-config.js codex-hooks.js mcp-client.js opencode-bridge.js
├── session-ask.js clideck-ask-cli.js   ← "ask another session"
├── plugin-loader.js          ← plugin discovery / install / init
├── bin/                      ← clideck CLI entry (bin/clideck.js)
├── public/{js,fx,img}/       ← browser UI (app.js, terminals.js, settings.js, ...)
├── plugins/
│   ├── autopilot/            ← (upstream) LLM output router
│   ├── trim-clip/ voice-input/  ← (upstream) utility plugins
│   └── workflow/             ← (FORK) issue→PR pipeline orchestration
│       ├── lib/{runner,state,ci-poller,branch,pr,rhythm}.js
│       ├── lib/stages/{planning,issues,pipeline,smoketest,manual-setup,obsidian-record}.js
│       ├── client.js index.js   ← UI + plugin entry
│       └── test/             ← 18 node --test files
├── skills/{awesome-lists,research-experiment,smoke-test,template}/
├── src/                      ← tailwind input.css
├── test/                     ← root tests (codex-config, telemetry-tokens)
├── tools/                    ← build/install/launch helpers
├── opencode-plugin/          ← OpenCode integration plugin
└── AGENTS.md CLAUDE.md README.md CONTRIBUTING.md LICENSE
```

## Entry points
- **App:** `npm start` → `node server.js` (run this fork with `--host 0.0.0.0 --port 4000`).
- **CLI:** `bin/clideck.js` (the `clideck` bin).
- **Plugins:** loaded by `plugin-loader.js` from `plugins/*/clideck-plugin.json`.
- **Build:** `npm run build:css` (tailwind); `npm run postinstall` installs git hooks.

## Hot files (auto-generated — snapshot)

Most frequently changed (from churn scan):
`public/js/app.js` (61) · `package.json` (60) · `package-lock.json` (57) · `public/js/terminals.js` (49) · `sessions.js` (42) · `handlers.js` (41) · `server.js` (33) · `public/index.html` (33) · `README.md` (32) · `public/tailwind.css` (25) · `telemetry-receiver.js` (24) · `public/js/settings.js` (24) · `public/js/creator.js` (23) · `config.js` (23) · `plugins/workflow/index.js` (19) · `transcript.js` (17) · `plugin-loader.js` (16) · `agent-presets.json` (14) · `plugins/workflow/lib/stages/pipeline.js` (13) · `plugins/workflow/lib/runner.js` (12)

Largest source files: `docs/superpowers/plans/2026-05-06-clideck-workflow-plugin.md` (72.8 KB) · `public/js/app.js` (60.4 KB) · `public/js/terminals.js` (56.4 KB) · `plugins/autopilot/index.js` (46.9 KB) · `handlers.js` (35.1 KB) · `public/index.html` (33.5 KB) · `plugins/workflow/client.js` (25.7 KB) · `public/js/settings.js` (23.0 KB)

Dependencies (npm): `@xterm/addon-fit`, `@xterm/xterm`, `node-pty`, `ws`; dev: `tailwindcss`

Env vars (from code scan): `APPDATA`, `CLIDECK_PORT`, `CLIDECK_SESSION_ID`, `CLIDECK_URL`, `COMSPEC`, `GEMINI_SESSION_ID`, `OTEL_RESOURCE_ATTRIBUTES`, `PORT`, `SHELL`

npm scripts: `start` (`node server.js`) · `build:css` (tailwind minify) · `prepublishOnly` (`build:css`) · `postinstall` (`node tools/install-git-hooks.js`)

Open issues: **none** — the board was cleared 2026-06-11 (the #26–#40 batch was mis-filed; it described bulletin-generator).

*Churn/size data is a snapshot; regenerate with `repo_maps_v2.py`.*
