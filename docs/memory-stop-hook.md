# memory-stop-hook

**Standalone personal-automation hook — no CliDeck runtime coupling.**
The canonical source lives in `my-clideck/tools/memory-stop-hook.js` only because `my-clideck` is the user's personal-scripts repo. The hook does not import or depend on anything CliDeck-specific; it can be installed and run on any machine that has Node ≥18 and Claude Code CLI.

---

## What it does

Every time a Claude Code session ends, this Stop hook fires. If the session did "substantial work" (at least one file edit, write, or notebook edit; or a Bash call containing `git commit`, `git push`, `launchctl`, `npm publish`, or a version-bump pattern), the hook spawns a detached background `claude --model claude-haiku-4-5-20251001` process that reads the session transcript, inspects the existing `Dev Projects/<repo>.md` Obsidian note to match the established entry format, and appends a `### YYYY-MM-DD - <one-line summary>` entry. Pure read-only sessions (only `Read`, `Grep`, `Glob`, `WebFetch`, etc.) are skipped silently. The hook always exits 0 — it never breaks session teardown.

---

## Why `~/Library/Application Support/` and not `~/Documents/`

macOS Full Disk Access (FDA) restrictions can block background processes from reading or writing inside `~/Documents`. The `~/Library/Application Support/` path is not subject to the same FDA gate, making it reliable for hook binaries that execute outside the interactive user context.

---

## Substantial-work heuristic

A session is "substantial" if its transcript contains **any** of:

| Condition | Details |
|-----------|---------|
| `Edit` tool call | Any file edit |
| `Write` tool call | Any new file write |
| `NotebookEdit` tool call | Any Jupyter notebook edit |
| `Bash` call matching `git commit` | Commits |
| `Bash` call matching `git push` | Pushes |
| `Bash` call matching `launchctl` | Service management |
| `Bash` call matching `npm publish` | Package publish |
| `Bash` call matching version bump | e.g. `bump version`, `version bump` (case-insensitive) |

**To extend the heuristic:** edit the `WRITE_TOOLS` set or `BASH_MUTATIONS` array near the top of `tools/memory-stop-hook.js`, then re-deploy (see Install / update below).

---

## Hook registration

### Claude Code
Registered in `~/.claude/settings.json` as an additional entry in the `Stop` array, alongside the existing CliDeck telemetry hook:

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "\"/usr/local/bin/node\" \"/Users/ajhochhalter/Library/Application Support/claude-memory/memory-stop-hook.js\""
    }
  ]
}
```

**To disable:** remove only this entry from the `Stop` array. Leave the CliDeck telemetry entry untouched.

### Claude Cowork
Cowork runs sessions inside a Linux sandbox that does **not** mount `~/.claude/settings.json` from the host. This is a known limitation ([GitHub #40495](https://github.com/anthropics/claude-code/issues/40495)). Stop hooks configured in `~/.claude/settings.json` are silently ignored in Cowork sessions — there is no separate Cowork settings file to register in. This hook therefore applies to Claude Code CLI sessions only.

---

## Error log

Unexpected errors (Obsidian MCP down, Haiku timeout, malformed transcript, etc.) are written to:

```
~/Library/Logs/claude-memory/hook.err
```

The hook **always exits 0** regardless of errors — it never prevents session teardown. The log directory is created automatically on first error.

---

## How `Dev Projects/<name>.md` notes are created

`mcp__obsidian__obsidian_post_file` auto-creates the note if it does not exist. On the first substantial session for a given repo, Obsidian will create `Dev Projects/<repo-name>.md` and write the first entry. No manual setup required.

---

## Install / update procedure

1. Edit the canonical source: `my-clideck/tools/memory-stop-hook.js`
2. Deploy to the install location:
   ```sh
   cp "/Users/ajhochhalter/Documents/my-clideck/tools/memory-stop-hook.js" \
      "/Users/ajhochhalter/Library/Application Support/claude-memory/memory-stop-hook.js"
   ```
3. No restart of Claude Code is required — hooks are read fresh each session.

---

## Files

| Path | Role |
|------|------|
| `my-clideck/tools/memory-stop-hook.js` | Canonical source — edit here |
| `~/Library/Application Support/claude-memory/memory-stop-hook.js` | Deployed install — what Claude Code actually runs |
| `~/.claude/settings.json` | Hook registration (Stop array) |
| `~/Library/Logs/claude-memory/hook.err` | Error log (created on first error) |
