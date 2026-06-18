# Architecture — my-clideck

## Overview
CliDeck is a local-first web app for running and monitoring multiple AI coding agents (Claude Code, Codex, Gemini CLI, OpenCode, Shell) from one browser tab. A Node.js server (`server.js`) spawns each agent in a real PTY (`node-pty`), streams terminal I/O to the browser over WebSockets (`ws` + xterm.js), and watches lightweight OpenTelemetry status signals to know which agent is working, idle, or waiting. Everything runs locally; no agent data leaves the machine. `my-clideck` is a personal fork — same core, plus a custom `workflow` plugin and assorted tweaks.

## Components

### Core server (upstream)
- `server.js` — HTTP + WebSocket server; the app entry point (`npm start`). Default port 4002 upstream; this fork is run at `0.0.0.0:4000`.
- `sessions.js` — session lifecycle: spawn/resume/close PTY-backed agent sessions, track status.
- `handlers.js` — request/WS message handlers (largest core module, ~36 KB).
- `telemetry-receiver.js` — ingests OpenTelemetry events from agents to drive working/idle/waiting status.
- `transcript*.js` (`transcript.js`, `transcript-parser.js`, `transcript-normalizer.js`, `transcript-candidate.js`) — capture and normalize agent transcripts for history/resume.
- `config.js`, `paths.js`, `runtime.js`, `themes.js`, `utils.js` — configuration, path resolution, runtime detection, 15 themes, helpers.
- `codex-config.js`, `codex-hooks.js`, `mcp-client.js`, `opencode-bridge.js` — per-agent integration glue.
- `session-ask.js`, `clideck-ask-cli.js` — the "ask another session" feature (inject a prompt into a sibling session, wait, return its response).
- `public/` — browser UI (`js/app.js`, `js/terminals.js`, `js/settings.js`, `js/creator.js`, `index.html`, `tailwind.css`, sounds in `fx/`).

### Plugin system
- `plugin-loader.js` — discovers and loads plugins from `plugins/`, installs them into the runtime plugin dir, calls each plugin's `init()`. Manifests are `clideck-plugin.json`; versions are auto-bumped by the pre-commit hook (`tools/bump-plugin-versions.js`) so the loader never serves stale code.
- `plugins/autopilot/` — (upstream) routes output between agents automatically using an LLM router (~50 tokens/decision), with output fingerprinting + handoff history to prevent loops.
- `plugins/trim-clip/`, `plugins/voice-input/` — (upstream) utility plugins.
- `plugins/workflow/` — **the fork's signature addition.** A GitHub issue → PR orchestration pipeline. See below.

### workflow plugin (fork-specific)
`plugins/workflow/` runs ordered pipeline stages that launch agent sessions, watch for completion via marker files, poll CI, and advance state:
- `lib/runner.js` — the state machine: advances stages when marker files appear; spawns/closes sessions via the CliDeck plugin API.
- `lib/state.js` — pipeline state model + JSON persistence (`state.json`).
- `lib/ci-poller.js` — Node-side GitHub CI polling; treats `no-checks` as success after a grace window.
- `lib/branch.js`, `lib/pr.js` — branch and PR plumbing (targets the `plugin` remote).
- `lib/stages/` — `planning.js`, `issues.js`, `pipeline.js`, `smoketest.js`, `manual-setup.js`, `obsidian-record.js` (the dated-entry logger being retired in favor of `docs/ai/`).
- `lib/rhythm.js` — fires `mcp__rhythm__rhythm_notify` on pipeline events.
- `client.js`, `index.js` — browser-side UI and plugin entry/registration.

### Skills
- `skills/` (root) and `plugins/workflow/skills/` — bundled agent skills (e.g. issue-pipeline, smoke-test, research-experiment, awesome-lists, template).

## Data flow (agent session)
Browser → WS → `server.js`/`handlers.js` → `sessions.js` spawns `node-pty` agent → agent emits OTel → `telemetry-receiver.js` updates status → pushed back to browser. Transcripts persisted via `transcript*.js` for resume/search.
