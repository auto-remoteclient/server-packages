const { execSync, execFileSync, spawnSync } = require('child_process');

const SESSION_NAME = 'dev';
const TMUX_TARGET = `${SESSION_NAME}:0.0`;

let polling = false;
let pollInterval = null;
let lastOutput = '';

function bashSingleQuoted(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

function resetTmuxSession() {
  try {
    execSync(`tmux kill-session -t ${SESSION_NAME} 2>/dev/null`, {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore']
    });
  } catch {
    /* ignore */
  }
  execSync(
    `tmux new-session -d -s ${SESSION_NAME} -x 120 -y 36 -- bash --login`,
    { encoding: 'utf8' }
  );
}

function sendInputLine(line) {
  execFileSync('tmux', ['send-keys', '-t', TMUX_TARGET, '-l', line], { encoding: 'utf8' });
  execFileSync('tmux', ['send-keys', '-t', TMUX_TARGET, 'Enter'], { encoding: 'utf8' });
}

function sendInput(input) {
  try {
    const lines = input.split('\n');
    for (const line of lines) {
      if (line === '') {
        execFileSync('tmux', ['send-keys', '-t', TMUX_TARGET, 'Enter'], { encoding: 'utf8' });
      } else {
        sendInputLine(line);
      }
    }
  } catch {
    /* ignore */
  }
}

function sendRawKeys(keys) {
  try {
    execSync(`tmux send-keys -t ${TMUX_TARGET} ${keys}`, { encoding: 'utf-8' });
  } catch {
    /* ignore */
  }
}

function sendInteractiveInput(data) {
  if (data == null || data === '') return;
  const bufName = `wpaste_${process.pid}`;
  const input = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const load = spawnSync('tmux', ['load-buffer', '-b', bufName, '-'], {
    input,
    maxBuffer: 10 * 1024 * 1024
  });
  if (load.error || load.status !== 0) return;
  spawnSync('tmux', ['paste-buffer', '-b', bufName, '-t', TMUX_TARGET, '-d']);
}

function sanitizePaneText(text) {
  if (text == null) return '';
  return String(text).replace(/\0/g, '');
}

function getOutput() {
  const variants = [
    ['capture-pane', '-t', TMUX_TARGET, '-p', '-e', '-a', '-q', '-S', '-5000'],
    ['capture-pane', '-t', TMUX_TARGET, '-p', '-e', '-S', '-5000'],
    ['capture-pane', '-t', TMUX_TARGET, '-p', '-S', '-5000'],
    ['capture-pane', '-t', TMUX_TARGET, '-p']
  ];
  let best = '';
  for (const args of variants) {
    try {
      const out = execFileSync('tmux', args, {
        encoding: 'utf8',
        timeout: 8000,
        maxBuffer: 12 * 1024 * 1024
      });
      const s = sanitizePaneText(out);
      if (s.length > best.length) best = s;
    } catch {
      /* older tmux may not support -a / -e */
    }
  }
  return best;
}

function clearPollInterval() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function stopPolling() {
  clearPollInterval();
  polling = false;
}

function startPolling(onOutput, intervalMs = 450) {
  clearPollInterval();
  resetTmuxSession();
  polling = true;
  lastOutput = '';

  const initial = getOutput();
  lastOutput = initial;
  onOutput({ type: 'terminal_snapshot', data: initial });

  pollInterval = setInterval(() => {
    const current = getOutput();
    lastOutput = current;
    onOutput({ type: 'terminal_snapshot', data: current });
  }, intervalMs);
}

function cdIntoProject(projectPath) {
  const dir = bashSingleQuoted(projectPath);
  sendInputLine(`cd ${dir}`);
}

function runClaude(projectPath) {
  const dir = bashSingleQuoted(projectPath);
  const cmd = String(process.env.CLAUDE_BIN || 'claude').trim();
  if (!cmd) return;
  if (/\s/.test(cmd)) {
    sendInputLine(`cd ${dir} && ${cmd}`);
  } else {
    sendInputLine(`cd ${dir} && exec ${cmd}`);
  }
}

function resizePane(cols, rows) {
  try {
    execSync(`tmux resize-pane -t ${TMUX_TARGET} -x ${cols} -y ${rows}`, { encoding: 'utf-8' });
  } catch {
    /* ignore */
  }
}

function isPollingActive() {
  return polling;
}

module.exports = {
  sendInput,
  sendInteractiveInput,
  sendRawKeys,
  getOutput,
  startPolling,
  stopPolling,
  cdIntoProject,
  runClaude,
  resizePane,
  isPollingActive
};
