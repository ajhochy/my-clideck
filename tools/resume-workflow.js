#!/usr/bin/env node
// Resume a CliDeck workflow by id, bypassing the dashboard.
// Useful when the Resume button in the UI doesn't fire (stale cached client.js,
// dead WS, etc.) — sends the same `plugin.workflow.resume` frame the dashboard
// would have sent, hits the backend, and engages the runner.
//
// Usage:
//   node tools/resume-workflow.js <workflow-id> [port]
//
// `workflow-id` is the folder name under ~/.clideck/plugins/workflow/workflows/.
// Port defaults to 4002.

const { existsSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const os = require('node:os');

const id = process.argv[2];
const port = process.argv[3] || process.env.CLIDECK_PORT || process.env.PORT || '4002';

if (!id) {
  const root = join(os.homedir(), '.clideck', 'plugins', 'workflow', 'workflows');
  console.error('usage: node tools/resume-workflow.js <workflow-id> [port]\n');
  if (existsSync(root)) {
    console.error('available workflows:');
    for (const entry of readdirSync(root)) console.error(`  ${entry}`);
  }
  process.exit(2);
}

const WebSocket = require('ws');
const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `http://localhost:${port}` });

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'plugin.workflow.resume', id }));
  setTimeout(() => { ws.close(); process.exit(0); }, 800);
});
ws.on('error', (e) => { console.error('connect error:', e.message); process.exit(1); });
