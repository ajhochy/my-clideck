#!/usr/bin/env node
// Re-applies the CliDeck codex patch:
//   ~/.codex/config.toml  → [otel] endpoint + notify directive
//   ~/.codex/hooks.json   → UserPromptSubmit/Stop hooks
//
// Codex (or wrap-aware tools like Computer-Use) periodically nukes the notify
// directive and OTEL block. CliDeck normally repairs this on server startup,
// but when the server can't restart cleanly you can run this directly:
//
//   node tools/repatch-codex.js [port]
//
// Defaults to CLIDECK_PORT / PORT env, then 4002.

const { join, dirname, resolve } = require('path');
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('fs');
const os = require('os');

const { upsertCodexConfig, validateCodexConfigToml } = require('../codex-config');
const { installCodexHooks } = require('../codex-hooks');

const port = String(process.argv[2] || process.env.CLIDECK_PORT || process.env.PORT || 4002);
const home = os.homedir();
const repoRoot = resolve(__dirname, '..');

const configPath = join(home, '.codex', 'config.toml');
const content = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
const notifyHelperPath = join(repoRoot, 'bin', 'notify-helper.js');
const codexHookPath = join(repoRoot, 'bin', 'codex-hook.js');

const next = upsertCodexConfig(content, process.execPath, notifyHelperPath, port);
const valid = validateCodexConfigToml(next);
if (!valid.ok) {
  console.error('TOML invalid after patch:', valid.error);
  process.exit(1);
}

mkdirSync(dirname(configPath), { recursive: true });
writeFileSync(configPath, next);
installCodexHooks(home, process.execPath, codexHookPath, port);

console.log(`codex repatched → port ${port}`);
console.log(`  ${configPath}`);
console.log(`  ${join(home, '.codex', 'hooks.json')}`);
