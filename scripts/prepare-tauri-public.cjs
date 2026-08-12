#!/usr/bin/env node

// Tauri embeds the complete frontend directory in the native executable.
// `public/updates` intentionally contains legacy Electron installers for the
// web updater; including those inside a Tauri installer recursively bloats it
// by ~100 MB. Create a desktop-specific public directory without that feed.
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const source = path.join(projectRoot, 'public');
const target = path.join(projectRoot, 'public-tauri');

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, {
  recursive: true,
  filter: (candidate) => {
    const relative = path.relative(source, candidate);
    return relative.split(path.sep).every((part) => part !== 'updates');
  },
});

console.log('[prepare-tauri-public] Copied public assets without legacy update binaries.');
