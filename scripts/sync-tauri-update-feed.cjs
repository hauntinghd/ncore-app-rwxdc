#!/usr/bin/env node

// Publishes the signed Tauri updater contract beside the existing web assets.
// The private key is never read here; Tauri CLI creates the .sig during build.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const bundleDir = path.join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const publicDir = path.join(root, 'public', 'updates', 'tauri');
const installerName = `NCore_${version}_x64-setup.exe`;
const installer = path.join(bundleDir, installerName);
const signature = `${installer}.sig`;

if (!fs.existsSync(installer)) throw new Error(`Missing Tauri installer: ${installer}`);
if (!fs.existsSync(signature)) throw new Error(`Missing Tauri signature: ${signature}`);

fs.mkdirSync(publicDir, { recursive: true });
fs.copyFileSync(installer, path.join(publicDir, installerName));
fs.copyFileSync(signature, path.join(publicDir, `${installerName}.sig`));

const sig = fs.readFileSync(signature, 'utf8').trim();

// Notes come from the published release-notes feed for this version; the
// previous hardcoded string shipped stale 2026-07 notes with every release.
function notesForVersion(v) {
  try {
    const feed = JSON.parse(
      fs.readFileSync(path.join(root, 'public', 'updates', 'release-notes.json'), 'utf8'),
    );
    const entry = (feed.releases || []).find((r) => r.version === v);
    if (entry) {
      const lines = [...(entry.improvements || []), ...(entry.bugFixes || [])];
      if (lines.length > 0) return `NCore ${v}: ${lines.join(' ')}`;
    }
  } catch {
    // fall through to the generic line
  }
  return `NCore ${v}.`;
}

const metadata = {
  version,
  notes: notesForVersion(version),
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: sig,
      url: `https://ncore.nyptidindustries.com/updates/tauri/${installerName}`,
    },
  },
};
fs.writeFileSync(path.join(publicDir, 'latest.json'), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`[tauri-update] Published ${installerName} and signed latest.json staging assets.`);
