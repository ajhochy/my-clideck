# Running the local CliDeck server

This fork runs as a persistent launchd agent on port **4002**, not via `npm start` in a terminal. The job is registered as `com.ajhochhalter.my-clideck-4002` and has `KeepAlive` enabled, so killing the node process directly will only cause launchd to respawn it within seconds.

## Restarting to pick up code/plugin changes

After editing a plugin (e.g. `plugins/workflow/`) or any server code, restart the launchd job — do **not** `kill` the PID:

```bash
launchctl kickstart -k gui/$(id -u)/com.ajhochhalter.my-clideck-4002
```

`-k` stops the running instance first, then starts a fresh one. Verify:

```bash
lsof -ti:4002 | xargs ps -o pid,etime,command -p
```

You should see a freshly-started `node server.js --port 4002 --host 0.0.0.0` (low `ELAPSED`).

> Note: `lsof -ti:4002` may also list a Chrome Helper PID — that's a browser tab holding an open connection, not a second listener. Ignore it.

## If the launchd job is gone

The job was registered with `launchctl submit` (no plist file on disk). If `launchctl list | grep clideck` returns nothing, re-submit it or just run `npm start` from the repo root as a fallback:

```bash
cd /Users/ajhochhalter/Documents/my-clideck
npm start                    # defaults to 127.0.0.1:4002
```

Port/host overrides: `--port`, `--host`, or env `CLIDECK_PORT` / `PORT`.

## Re-registering the launchd agent (after reboot or `launchctl bootout`)

The launchd job is created with `launchctl submit`, which stores its program path *in memory* — so it does NOT survive a system reboot. To re-register after a clean reboot:

```bash
launchctl submit -l com.ajhochhalter.my-clideck-4002 -- \
  /bin/zsh "$HOME/Library/Application Support/clideck/launch-server.zsh"
```

The canonical script lives in the repo at [`tools/launch-server.zsh`](tools/launch-server.zsh) — copy it into `~/Library/Application Support/clideck/` whenever you change it:

```bash
mkdir -p "$HOME/Library/Application Support/clideck"
cp tools/launch-server.zsh "$HOME/Library/Application Support/clideck/launch-server.zsh"
chmod +x "$HOME/Library/Application Support/clideck/launch-server.zsh"
```

**Why not run the script directly out of `~/Documents/my-clideck/tools/`?** macOS Full Disk Access protects `~/Documents` from background daemons. launchd-spawned processes can't even read the script — they exit 127 ("command not found") with nothing in stderr. Symptom: `launchctl print …` shows `state = spawn scheduled`, `last exit code = 127`, and the server keeps respawning into oblivion. `~/Library/Application Support/` is not FDA-protected and works fine.

The script sets PATH explicitly (rather than sourcing `~/.zshrc`, which has a syntax error on this machine) so spawned sessions inherit the directories CliDeck-spawned tools actually need: `~/.local/bin` (for `claude`), `/usr/local/bin` (for `gemini`), `/opt/homebrew/bin`, etc. Without that, preset resume commands using bare names — e.g. `claude --resume {{sessionId}}`, `gemini` — fail silently because the binary isn't found, and the resumed session pty closes immediately. Symptom: you click Resume on a saved Claude Code session card and nothing visible happens; the session just disappears from the resumable list. Same root cause for stages that use a bare-named preset command (the workflow plugin's `manual-setup` stage uses `gemini`, which would never start).

Server stdout goes to `~/Library/Logs/my-clideck/server.log`; stderr to `server.err`. Useful when the server crashes silently after a deploy.

## Workflow plugin Resume button silently fails

Symptom: clicking **Resume** in the Workflow panel does nothing — no toast, no console error, no backend log entry. Synthetic WS messages (`tools/resume-workflow.js`) also have no effect.

Cause: the plugin loader skips `init()` for any plugin with `install: "npm"` whose `pluginInstalled[<id>]` flag is missing in `~/.clideck/config.json`. Without `init()`, no `onFrontendMessage` handlers are registered and every message addressed to that plugin is silently dropped. The dashboard still renders cached state from previous sessions, so the workflow row looks healthy.

Confirm by checking `~/Library/Logs/my-clideck/server.log` for the line `[plugin] Workflow vX.Y.Z (not installed)`. If you see that, the plugin is dormant.

Fix:

```bash
# 1. ensure node_modules exists in the installed copy
cd ~/.clideck/plugins/workflow && npm install

# 2. flip the installed flag in config
node -e 'const fs=require("fs"); const p="'"$HOME"'/.clideck/config.json"; const c=JSON.parse(fs.readFileSync(p,"utf8")); c.pluginInstalled = c.pluginInstalled || {}; c.pluginInstalled.workflow = true; fs.writeFileSync(p, JSON.stringify(c, null, 2));'

# 3. restart so plugin-loader reads the new flag
launchctl kickstart -k gui/$(id -u)/com.ajhochhalter.my-clideck-4002
```

Confirm the next server start logs `[plugin:workflow] Workflow plugin initialized` (no `(not installed)` suffix).

## Repatching codex

Codex (and wrap-aware tools like Computer-Use) periodically strips CliDeck's `notify` directive and `[otel]` block from `~/.codex/config.toml`, breaking telemetry on the dashboard. CliDeck normally re-applies the patch on server startup, but when telemetry stops flowing without a restart you can repatch directly:

```bash
node tools/repatch-codex.js          # defaults to port 4002
node tools/repatch-codex.js 4003     # override port
```

This rewrites `~/.codex/config.toml` (otel endpoint + notify) and `~/.codex/hooks.json` (UserPromptSubmit / Stop hooks) using absolute paths to `bin/notify-helper.js` and `bin/codex-hook.js` in this repo.

## Why not just `npm start`?

`npm start` only works while that terminal stays open. The launchd agent is what keeps the dashboard available across reboots and shell exits, which is the whole point of running it as a personal service.
