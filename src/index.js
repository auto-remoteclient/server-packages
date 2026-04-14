#!/usr/bin/env node

const { WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { scanProjects } = require('./scanner');
const { runTask } = require('./task-runner');
const terminal = require('./terminal');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '.agent-config.json');

function loadOrCreateConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  }
  const config = {
    agentId: uuidv4(),
    pairingCode: Math.random().toString(36).substring(2, 8).toUpperCase()
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return config;
}

const config = loadOrCreateConfig();
const BACKEND_URL = process.env.BACKEND_URL || 'ws://localhost:3001';

console.log('=================================');
console.log('  Remote Dev Agent');
console.log('=================================');
console.log(`Agent ID:      ${config.agentId}`);
console.log(`Pairing Code:  ${config.pairingCode}`);
console.log(`Backend:       ${BACKEND_URL}`);
console.log('=================================\n');

let ws = null;
let currentTask = null;

function connect() {
  ws = new WebSocket(BACKEND_URL);

  ws.on('open', () => {
    console.log('[ws] Connected to backend');
    send({
      type: 'agent:register',
      agentId: config.agentId,
      pairingCode: config.pairingCode
    });
  });

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'list_projects':
        const projects = await scanProjects();
        send({ type: 'projects_list', projects });
        break;

      case 'run_task':
        if (currentTask) {
          send({ type: 'task_error', error: 'A task is already running' });
          return;
        }
        currentTask = msg;
        send({ type: 'task_started', projectPath: msg.projectPath });
        try {
          const result = await runTask(msg.projectPath, msg.prompt, (log) => {
            send({ type: 'task_log', log });
          });
          send({ type: 'task_result', result });
        } catch (err) {
          send({ type: 'task_result', result: { status: 'error', error: err.message } });
        }
        currentTask = null;
        break;

      // --- Terminal messages ---
      case 'terminal_start':
        terminal.stopPolling();
        terminal.startPolling((output) => {
          send(output);
        });
        if (msg.projectPath) {
          setTimeout(() => terminal.cdIntoProject(msg.projectPath), 500);
        }
        break;

      case 'terminal_stop':
        terminal.stopPolling();
        break;

      case 'terminal_input':
        terminal.sendInteractiveInput(msg.data);
        break;

      case 'terminal_raw_keys':
        terminal.sendRawKeys(msg.keys);
        break;

      case 'terminal_resize':
        if (msg.cols && msg.rows) {
          terminal.resizePane(msg.cols, msg.rows);
        }
        break;

      case 'terminal_run_claude': {
        const p = msg.projectPath || '.';
        if (!terminal.isPollingActive()) {
          terminal.stopPolling();
          terminal.startPolling((output) => {
            send(output);
          });
          setTimeout(() => terminal.runClaude(p), 1500);
        } else {
          terminal.runClaude(p);
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log('[ws] Disconnected. Reconnecting in 5s...');
    terminal.stopPolling();
    setTimeout(connect, 5000);
  });

  ws.on('error', (err) => {
    console.error('[ws] Error:', err.message);
  });
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

connect();

process.on('SIGINT', () => {
  console.log('\nShutting down agent...');
  terminal.stopPolling();
  if (ws) ws.close();
  process.exit(0);
});
