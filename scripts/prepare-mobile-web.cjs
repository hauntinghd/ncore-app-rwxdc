#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'dist');
const targetDir = path.join(rootDir, 'dist-mobile');
const updatesDirName = 'updates';

if (!fs.existsSync(sourceDir)) {
  console.error(`[prepare-mobile-web] Missing source build directory: ${sourceDir}`);
  process.exit(1);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });

const shouldInclude = (entryPath) => {
  const relative = path.relative(sourceDir, entryPath);
  if (!relative || relative === '.') return true;
  const topSegment = relative.split(path.sep)[0];
  return topSegment !== updatesDirName;
};

fs.cpSync(sourceDir, targetDir, {
  recursive: true,
  filter: shouldInclude
});

console.log(`[prepare-mobile-web] Created ${targetDir} (excluding /${updatesDirName}).`);
