#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
const packageLockPath = path.resolve(__dirname, '..', 'package-lock.json');
const bumpType = String(process.argv[2] || 'patch').toLowerCase();

if (!['major', 'minor', 'patch'].includes(bumpType)) {
  console.error(`Invalid bump type "${bumpType}". Use major, minor, or patch.`);
  process.exit(1);
}

const raw = fs.readFileSync(packageJsonPath, 'utf8');
const pkg = JSON.parse(raw);
const current = String(pkg.version || '').trim();
const match = current.match(/^(\d+)\.(\d+)\.(\d+)$/);

if (!match) {
  console.error(`package.json version "${current}" is not in x.y.z format.`);
  process.exit(1);
}

let major = Number(match[1]);
let minor = Number(match[2]);
let patch = Number(match[3]);

if (bumpType === 'major') {
  major += 1;
  minor = 0;
  patch = 0;
} else if (bumpType === 'minor') {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}

const nextVersion = `${major}.${minor}.${patch}`;
pkg.version = nextVersion;
fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

if (fs.existsSync(packageLockPath)) {
  try {
    const lockRaw = fs.readFileSync(packageLockPath, 'utf8');
    const lockJson = JSON.parse(lockRaw);
    lockJson.version = nextVersion;
    if (lockJson.packages && lockJson.packages['']) {
      lockJson.packages[''].version = nextVersion;
    }
    fs.writeFileSync(packageLockPath, `${JSON.stringify(lockJson, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.warn(`Warning: failed to sync package-lock version: ${error?.message || error}`);
  }
}

console.log(`Version bumped: ${current} -> ${nextVersion}`);
