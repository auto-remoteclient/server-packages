const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function exec(cmd, cwd, onLog) {
  onLog(`$ ${cmd}`);
  try {
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 300000 });
    if (output.trim()) onLog(output.trim());
    return output.trim();
  } catch (err) {
    const msg = err.stderr || err.stdout || err.message;
    onLog(`[error] ${msg}`);
    throw new Error(msg);
  }
}

function spawnAsync(cmd, args, cwd, onLog) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end();
    let output = '';

    child.stdout.on('data', (data) => {
      const line = data.toString();
      output += line;
      onLog(line.trim());
    });

    child.stderr.on('data', (data) => {
      const line = data.toString();
      output += line;
      onLog(line.trim());
    });

    child.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`Command exited with code ${code}`));
    });

    child.on('error', reject);
  });
}

function getGitHubCompareUrl(cwd, baseBranch, newBranch) {
  try {
    const remote = execSync('git remote get-url origin', { cwd, encoding: 'utf-8' }).trim();
    // Convert git@github.com:owner/repo.git or https://github.com/owner/repo.git
    let match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (match) {
      const ownerRepo = match[1];
      return `https://github.com/${ownerRepo}/compare/${baseBranch}...${newBranch}?expand=1`;
    }
  } catch {}
  return null;
}

async function startPreview(cwd, onLog) {
  // Try cloudflared first, then ngrok
  const port = 3000 + Math.floor(Math.random() * 1000);

  // Check if package.json has a dev script
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const scripts = pkg.scripts || {};

    onLog(`[preview] Installing dependencies...`);
    try {
      execSync('npm install', { cwd, encoding: 'utf-8', timeout: 120000 });
    } catch {}

    // Start dev server in background
    const devCmd = scripts.dev ? 'npm run dev' : scripts.start ? 'npm start' : null;
    if (devCmd) {
      onLog(`[preview] Starting: ${devCmd} (port ${port})`);
      const child = spawn('sh', ['-c', `PORT=${port} ${devCmd}`], {
        cwd,
        detached: true,
        stdio: 'ignore'
      });
      child.unref();

      // Wait a bit for server to start
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Try to create tunnel
  let previewUrl = null;
  try {
    // Try cloudflared
    onLog('[preview] Creating tunnel with cloudflared...');
    const tunnelChild = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    previewUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tunnel timeout')), 15000);

      const handler = (data) => {
        const line = data.toString();
        const match = line.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      };

      tunnelChild.stdout.on('data', handler);
      tunnelChild.stderr.on('data', handler);
      tunnelChild.on('error', () => {
        clearTimeout(timeout);
        reject(new Error('cloudflared not found'));
      });
    });

    tunnelChild.unref();
    onLog(`[preview] URL: ${previewUrl}`);
  } catch {
    onLog('[preview] cloudflared failed, trying ngrok...');
    try {
      const ngrokChild = spawn('ngrok', ['http', String(port), '--log=stdout'], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      previewUrl = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('ngrok timeout')), 15000);
        ngrokChild.stdout.on('data', (data) => {
          const line = data.toString();
          const match = line.match(/(https:\/\/[a-z0-9-]+\.ngrok[a-z.-]*\.[a-z]+)/);
          if (match) {
            clearTimeout(timeout);
            resolve(match[1]);
          }
        });
        ngrokChild.on('error', () => {
          clearTimeout(timeout);
          reject(new Error('ngrok not found'));
        });
      });

      ngrokChild.unref();
      onLog(`[preview] URL: ${previewUrl}`);
    } catch {
      onLog('[preview] No tunnel tool available (install cloudflared or ngrok)');
      previewUrl = `http://localhost:${port}`;
    }
  }

  return previewUrl;
}

async function runTask(projectPath, prompt, onLog) {
  onLog(`[task] Starting task on ${projectPath}`);
  onLog(`[task] Prompt: ${prompt}`);

  // Get current branch as base
  const baseBranch = exec('git branch --show-current', projectPath, onLog);

  // Create new branch
  const timestamp = Date.now();
  const branchName = `ai/task-${timestamp}`;
  exec(`git checkout -b ${branchName}`, projectPath, onLog);
  onLog(`[task] Created branch: ${branchName}`);

  // Run Claude Code CLI
  onLog('[task] Running AI code generation...');
  try {
    await spawnAsync('claude', ['-p', prompt, '--dangerously-skip-permissions'], projectPath, onLog);
  } catch (err) {
    onLog(`[task] Claude CLI error: ${err.message}`);
    // Continue anyway - maybe partial changes were made
  }

  // Check if there are changes
  const diff = execSync('git diff --stat', { cwd: projectPath, encoding: 'utf-8' }).trim();
  if (!diff) {
    onLog('[task] No changes were made');
    exec(`git checkout ${baseBranch}`, projectPath, onLog);
    exec(`git branch -D ${branchName}`, projectPath, onLog);
    return { status: 'error', error: 'No changes were made by AI' };
  }

  onLog(`[task] Changes:\n${diff}`);

  // Start preview
  const previewUrl = await startPreview(projectPath, onLog);

  // Git commit and push
  exec('git add .', projectPath, onLog);
  const commitMsg = `AI: ${prompt.substring(0, 72)}`;
  exec(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, projectPath, onLog);

  try {
    exec(`git push origin ${branchName}`, projectPath, onLog);
  } catch (err) {
    onLog(`[task] Push failed: ${err.message}`);
  }

  // Generate compare URL
  const compareUrl = getGitHubCompareUrl(projectPath, baseBranch, branchName);

  const result = {
    status: 'success',
    branch: branchName,
    preview_url: previewUrl,
    compare_url: compareUrl,
    base_branch: baseBranch
  };

  onLog(`[task] Done! ${JSON.stringify(result, null, 2)}`);
  return result;
}

module.exports = { runTask };
