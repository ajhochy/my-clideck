#!/usr/bin/env node
/**
 * memory-stop-hook.js — Claude Code Stop hook: writes an Obsidian session entry
 * when a session does substantial work (≥1 file edit or noteworthy Bash call).
 *
 * STANDALONE: no CliDeck runtime dependency. This file lives in my-clideck/tools/
 * only because that is the user's personal-scripts repo — a convenient canonical
 * home. The hook does NOT import or depend on anything CliDeck-specific.
 *
 * Install path: ~/Library/Application Support/claude-memory/memory-stop-hook.js
 *   (see docs/memory-stop-hook.md for install / update procedure)
 *
 * Registered in: ~/.claude/settings.json (Stop array)
 * Error log:     ~/Library/Logs/claude-memory/hook.err
 */

'use strict';

const { execFileSync, spawn } = require('child_process');
const { readFileSync, mkdirSync, appendFileSync } = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const LOG_DIR  = path.join(os.homedir(), 'Library', 'Logs', 'claude-memory');
const LOG_FILE = path.join(LOG_DIR, 'hook.err');
const CLAUDE   = '/Users/ajhochhalter/.local/bin/claude';

// ---------------------------------------------------------------------------
// Error logging — never throws, never propagates
// ---------------------------------------------------------------------------
function logErr(msg) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Substantial-work heuristic
//
// Returns true if the transcript contains at least one:
//   • tool_use with name Edit | Write | NotebookEdit
//   • Bash call whose command matches a meaningful mutation pattern
//
// Pure read-only sessions (Read / Grep / Glob / WebFetch etc.) return false.
// ---------------------------------------------------------------------------
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const BASH_MUTATIONS = [
  /git\s+commit/,
  /git\s+push/,
  /launchctl/,
  /npm\s+publish/,
  /version.*bump|bump.*version/i,
];

function isSubstantial(transcriptPath) {
  try {
    const lines = readFileSync(transcriptPath, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type !== 'assistant') continue;
      const content = obj.message?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (c?.type !== 'tool_use') continue;
        if (WRITE_TOOLS.has(c.name)) return true;
        if (c.name === 'Bash') {
          const cmd = c.input?.command ?? '';
          if (BASH_MUTATIONS.some(p => p.test(cmd))) return true;
        }
      }
    }
    return false;
  } catch (e) {
    logErr(`isSubstantial: ${e.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Build a condensed, token-efficient transcript summary for Haiku
// ---------------------------------------------------------------------------
function buildSummary(transcriptPath) {
  try {
    const lines = readFileSync(transcriptPath, 'utf8').split('\n');
    const events = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }

      if (obj.type === 'user') {
        const content = obj.message?.content;
        const texts = Array.isArray(content)
          ? content.filter(c => c?.type === 'text').map(c => c.text)
          : typeof content === 'string' ? [content] : [];
        for (const t of texts) {
          const snippet = t.slice(0, 250).replace(/\n+/g, ' ');
          if (snippet.trim()) events.push(`USER: ${snippet}`);
        }
        continue;
      }

      if (obj.type === 'assistant') {
        const content = obj.message?.content;
        if (!Array.isArray(content)) continue;
        for (const c of content) {
          if (c?.type === 'text') {
            const snippet = c.text.slice(0, 250).replace(/\n+/g, ' ');
            if (snippet.trim()) events.push(`ASSISTANT: ${snippet}`);
          } else if (c?.type === 'tool_use') {
            if (c.name === 'Bash') {
              events.push(`TOOL Bash: ${(c.input?.command ?? '').slice(0, 150)}`);
            } else if (WRITE_TOOLS.has(c.name)) {
              const target = c.input?.file_path ?? c.input?.notebook_path ?? '';
              events.push(`TOOL ${c.name}: ${target.slice(0, 120)}`);
            }
          }
        }
      }
    }
    // Keep last 80 events to stay within token budget
    return events.slice(-80).join('\n');
  } catch (e) {
    logErr(`buildSummary: ${e.message}`);
    return '(transcript unavailable)';
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Parse stdin JSON from Claude Code hook contract
  let input;
  try {
    const raw = readFileSync('/dev/stdin', 'utf8');
    input = JSON.parse(raw);
  } catch (e) {
    logErr(`stdin parse: ${e.message}`);
    process.exit(0);
  }

  const transcriptPath = input.transcript_path;
  const sessionCwd     = input.cwd;

  if (!transcriptPath || !sessionCwd) {
    logErr(`missing transcript_path or cwd in hook input`);
    process.exit(0);
  }

  // Resolve git repo from session cwd — exit silently if not a git repo
  let repoRoot, repoName;
  try {
    repoRoot = execFileSync(
      'git', ['-C', sessionCwd, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    repoName = path.basename(repoRoot);
  } catch {
    process.exit(0);
  }

  // Skip pure read-only sessions
  if (!isSubstantial(transcriptPath)) {
    process.exit(0);
  }

  // Build a condensed summary to pass inline to Haiku
  const summary = buildSummary(transcriptPath);
  const today   = new Date().toISOString().slice(0, 10);

  const prompt = `\
You are writing a concise session log entry for an Obsidian project note.

Repo: ${repoName}
Date: ${today}
Session cwd: ${sessionCwd}

Condensed transcript of what happened:
<transcript>
${summary}
</transcript>

Steps (execute silently, no preamble):
1. Call mcp__obsidian__obsidian_get_file with filename "Dev Projects/${repoName}.md" to read any existing entries (may 404 — that is fine, just skip). If entries exist, match their established format exactly.
2. Compose a new log entry in this format:
### ${today} - [one-line summary of what was accomplished]
- [what was changed or built]
- [key decisions made and why]
- [anything blocked or left open — omit bullet if nothing blocked]

Keep each bullet under 15 words. Be specific and factual. Do not invent information not present in the transcript.
3. Call mcp__obsidian__obsidian_post_file with:
   filename: "Dev Projects/${repoName}.md"
   content: (the new entry text only — post appends to the file)

Do not output anything else. Just execute the three steps.`;

  // Spawn detached so the hook returns immediately; Haiku writes async
  try {
    const child = spawn(
      CLAUDE,
      ['--model', 'claude-haiku-4-5-20251001', '--add-dir', repoRoot, '-p', prompt],
      { detached: true, stdio: 'ignore', cwd: repoRoot }
    );
    child.unref();
  } catch (e) {
    logErr(`spawn error: ${e.message}`);
  }

  process.exit(0);
}

main().catch(e => {
  logErr(`uncaught: ${e.message}\n${e.stack ?? ''}`);
  process.exit(0);
});
