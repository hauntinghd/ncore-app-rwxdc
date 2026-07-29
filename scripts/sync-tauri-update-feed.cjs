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
const metadata = {
  version,
  notes: `NCore ${version}: restores DM and member-community visibility, hides Check update until a signed release exists, and replaces weak voice toggle tones with dedicated mute and deafen cues.`,
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
