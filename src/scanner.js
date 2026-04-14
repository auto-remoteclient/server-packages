const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SCAN_DIRS = [
  '/var/www',
  '/home'
];

function findGitRepos(baseDir, maxDepth = 3) {
  const repos = [];
  if (!fs.existsSync(baseDir)) return repos;

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') && entry.name !== '.git') continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.name === '.git') {
          const projectDir = path.dirname(fullPath);
          repos.push(projectDir);
          return; // Don't go deeper into a git repo
        }
        walk(fullPath, depth + 1);
      }
    } catch {
      // Permission denied, skip
    }
  }

  walk(baseDir, 0);
  return repos;
}

function getRepoInfo(repoPath) {
  try {
    const name = path.basename(repoPath);
    let remote = '';
    try {
      remote = execSync('git remote get-url origin', { cwd: repoPath, encoding: 'utf-8' }).trim();
    } catch {}

    let branch = '';
    try {
      branch = execSync('git branch --show-current', { cwd: repoPath, encoding: 'utf-8' }).trim();
    } catch {}

    return {
      name,
      path: repoPath,
      remote,
      branch
    };
  } catch {
    return null;
  }
}

async function scanProjects() {
  const allRepos = [];

  // Also check custom dirs from env
  const extraDirs = process.env.SCAN_DIRS ? process.env.SCAN_DIRS.split(',') : [];
  const dirsToScan = [...SCAN_DIRS, ...extraDirs];

  for (const dir of dirsToScan) {
    const repos = findGitRepos(dir);
    for (const repoPath of repos) {
      const info = getRepoInfo(repoPath);
      if (info) allRepos.push(info);
    }
  }

  console.log(`[scanner] Found ${allRepos.length} projects`);
  return allRepos;
}

module.exports = { scanProjects };
