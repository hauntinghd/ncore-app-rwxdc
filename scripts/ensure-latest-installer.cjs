#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(projectRoot, 'package.json');
const releaseLatestYmlPath = path.join(projectRoot, 'release', 'latest.yml');
const publicLatestYmlPath = path.join(projectRoot, 'public', 'updates', 'latest.yml');
const syncScriptPath = path.join(__dirname, 'sync-update-feed.cjs');

function parseLatestYml(raw) {
  const clean = (value) => String(value || '').trim().replace(/^['"]|['"]$/g, '');
  const versionMatch = raw.match(/^version:\s*(.+)$/m);
  const pathMatch = raw.match(/^path:\s*(.+)$/m);
  const fileUrlMatch = raw.match(/^\s*-\s*url:\s*(.+)$/m);

  const version = versionMatch ? clean(versionMatch[1]) : '';
  const installerName = pathMatch ? clean(pathMatch[1]) : (fileUrlMatch ? clean(fileUrlMatch[1]) : '');
  return { version, installerName };
}

function normalizeSemver(value) {
  const cleaned = String(value || '').trim().replace(/^v/i, '');
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return '';
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function runNpmScript(scriptName) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run(npmCmd, ['run', scriptName]);
}

function runSyncFeed() {
  run(process.execPath, [syncScriptPath, '--if-present']);
}

function installerForCurrentVersionExists(targetVersion) {
  if (!fs.existsSync(releaseLatestYmlPath)) return false;
  const latestRaw = fs.readFileSync(releaseLatestYmlPath, 'utf8');
  const parsed = parseLatestYml(latestRaw);
  const normalizedLatest = normalizeSemver(parsed.version);
  const normalizedTarget = normalizeSemver(targetVersion);
  if (!normalizedLatest || normalizedLatest !== normalizedTarget) return false;
  if (!parsed.installerName) return false;
  const installerPath = path.join(projectRoot, 'release', parsed.installerName);
  return fs.existsSync(installerPath);
}

function validatePublicFeed(targetVersion) {
  if (!fs.existsSync(publicLatestYmlPath)) {
    throw new Error('public/updates/latest.yml is missing after sync.');
  }
  const publicRaw = fs.readFileSync(publicLatestYmlPath, 'utf8');
  const parsed = parseLatestYml(publicRaw);
  const normalizedPublic = normalizeSemver(parsed.version);
  const normalizedTarget = normalizeSemver(targetVersion);
  if (!normalizedPublic || normalizedPublic !== normalizedTarget) {
    throw new Error(
      `public/updates/latest.yml is ${parsed.version || 'unknown'}, expected ${targetVersion}.`
    );
  }
}

function main() {
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Missing ${packageJsonPath}`);
  }
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const targetVersion = String(pkg.version || '').trim();
  if (!targetVersion) {
    throw new Error('package.json version is missing.');
  }

  if (!installerForCurrentVersionExists(targetVersion)) {
    console.log(`[ensure-latest-installer] Building NSIS installer for v${targetVersion}...`);
    runNpmScript('build:exe:auto:nobump');
  } else {
    console.log(`[ensure-latest-installer] Installer already present for v${targetVersion}.`);
    runSyncFeed();
  }

  validatePublicFeed(targetVersion);
  console.log(`[ensure-latest-installer] Update feed is aligned to v${targetVersion}.`);
}

try {
  main();
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}

