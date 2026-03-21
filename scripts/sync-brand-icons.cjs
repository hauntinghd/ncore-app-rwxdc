#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pngToIcoModule = require('png-to-ico');
const pngToIco = typeof pngToIcoModule === 'function' ? pngToIcoModule : pngToIcoModule.default;

const projectRoot = path.resolve(__dirname, '..');
const logoCandidates = [
  path.join(projectRoot, 'public', 'NCore.jpg'),
  path.join(projectRoot, 'public', 'NCore.JPG'),
  path.join(projectRoot, 'public', 'NCore.jpeg'),
  path.join(projectRoot, 'public', 'NCore.JPEG'),
  path.join(projectRoot, 'public', 'ncore-logo.jpg'),
  path.join(projectRoot, 'public', 'ncore-logo.jpeg'),
  path.join(projectRoot, 'public', 'ncore.jpg'),
  path.join(projectRoot, 'public', 'ncore.JPG'),
  path.join(projectRoot, 'public', 'ncore.jpeg'),
  path.join(projectRoot, 'public', 'ncore.JPEG'),
  path.join(projectRoot, 'public', 'ncore-logo.png'),
];
const canonicalPngPath = path.join(projectRoot, 'public', 'ncore-logo.png');
const outputPaths = [
  path.join(projectRoot, 'electron', 'assets', 'ncore-icon.ico'),
  path.join(projectRoot, 'release', 'ncore-exe-icon.ico'),
  path.join(projectRoot, 'build', 'ncore-icon.ico'),
];

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function resolveSourceLogo() {
  for (const candidate of logoCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function toCanonicalPng(sourcePath) {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.png') {
    if (sourcePath !== canonicalPngPath) {
      fs.copyFileSync(sourcePath, canonicalPngPath);
    }
    return canonicalPngPath;
  }

  if (process.platform !== 'win32') {
    throw new Error(`JPG source detected (${sourcePath}) but automatic conversion requires Windows PowerShell.`);
  }

  const command = [
    'Add-Type -AssemblyName System.Drawing;',
    `$input = '${sourcePath.replace(/'/g, "''")}';`,
    `$output = '${canonicalPngPath.replace(/'/g, "''")}';`,
    '$image = [System.Drawing.Image]::FromFile($input);',
    '$image.Save($output, [System.Drawing.Imaging.ImageFormat]::Png);',
    '$image.Dispose();',
  ].join(' ');

  execFileSync('powershell', ['-NoProfile', '-Command', command], { stdio: 'ignore' });
  return canonicalPngPath;
}

async function main() {
  const sourceLogoPath = resolveSourceLogo();
  if (!sourceLogoPath) {
    throw new Error(`Missing source logo. Expected one of: ${logoCandidates.join(', ')}`);
  }

  const pngSource = toCanonicalPng(sourceLogoPath);
  const iconBuffer = await pngToIco(pngSource);
  for (const outputPath of outputPaths) {
    ensureDir(outputPath);
    fs.writeFileSync(outputPath, iconBuffer);
  }

  console.log(`Synced brand icon from ${sourceLogoPath} (canonical: ${pngSource})`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
