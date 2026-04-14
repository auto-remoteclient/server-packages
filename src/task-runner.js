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

function spawnAsync(cmd, args, cwd, onLog, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end();
    let output = '';
    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        child.kill('SIGTERM');
        onLog('[timeout] Claude CLI took too long, killing...');
        reject(new Error('Claude CLI timed out after 10 minutes'));
      }
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      const line = data.toString();
      output += line;
      if (line.trim()) onLog(line.trim());
    });

    child.stderr.on('data', (data) => {
      const line = data.toString();
      output += line;
      if (line.trim()) onLog(line.trim());
    });

    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`Command exited with code ${code}`));
    });

    child.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

function getGitHubCompareUrl(cwd, baseBranch, newBranch) {
  try {
    const remote = execSync('git remote get-url origin', { cwd, encoding: 'utf-8' }).trim();
    // Handle git@github.com:owner/repo.git and https://github.com/owner/repo.git
    let match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (match) {
      const ownerRepo = match[1];
      return `https://github.com/${ownerRepo}/compare/${baseBranch}...${newBranch}?expand=1`;
    }
  } catch {}
  return null;
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
    // Continue - maybe partial changes were made
  }

  // Check if there are any changes (staged, unstaged, or untracked)
  const status = execSync('git status --porcelain', { cwd: projectPath, encoding: 'utf-8' }).trim();
  if (!status) {
    onLog('[task] No changes were made');
    exec(`git checkout ${baseBranch}`, projectPath, onLog);
    exec(`git branch -D ${branchName}`, projectPath, onLog);
    return { status: 'error', error: 'No changes were made by AI' };
  }

  onLog(`[task] Changes detected:\n${status}`);

  // Git add, commit, push
  exec('git add -A', projectPath, onLog);
  const commitMsg = `AI: ${prompt.substring(0, 72)}`;
  exec(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, projectPath, onLog);

  let pushOk = false;
  try {
    exec(`git push origin ${branchName}`, projectPath, onLog);
    pushOk = true;
  } catch (err) {
    onLog(`[task] Push failed (no remote?): ${err.message}`);
  }

  // Generate compare URL
  const compareUrl = pushOk ? getGitHubCompareUrl(projectPath, baseBranch, branchName) : null;

  // Hardcoded preview URL for now
  const previewUrl = 'http://localhost:3000';

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
