#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

async function run(context) {
  try {
    if (!context || context.electronPlatformName !== 'win32') return;

    const rcedit = require('rcedit');
    const projectRoot = context.appDir || path.resolve(__dirname, '..');
    const appOutDir = context.appOutDir;
    const exePath = path.join(appOutDir, 'NCore.exe');
    const iconPath = path.join(projectRoot, 'electron', 'assets', 'ncore-icon.ico');
    const pkgPath = path.join(projectRoot, 'package.json');

    if (!fs.existsSync(exePath) || !fs.existsSync(iconPath) || !fs.existsSync(pkgPath)) {
      return;
    }

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const version = String(pkg.version || '').trim() || '0.0.0';
    const company = 'NYPTID Industries Advanced Technologies';
    const product = 'NCore';
    const description = String(pkg.description || 'NCore desktop application.').trim();

    await rcedit(exePath, {
      icon: iconPath,
      'file-version': version,
      'product-version': version,
      'version-string': {
        CompanyName: company,
        ProductName: product,
        FileDescription: description,
        OriginalFilename: 'NCore.exe',
      },
    });

    console.log(`[afterPack] Patched Windows executable icon/version: ${exePath}`);
  } catch (error) {
    console.warn('[afterPack] Skipped executable patch:', error?.message || error);
  }
}

module.exports = run;

