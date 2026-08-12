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
    const copyrightLine = String(pkg.build?.copyright || `Copyright © 2026 ${company}`).trim();

    const baseVersionStrings = {
      CompanyName: company,
      ProductName: product,
      LegalCopyright: copyrightLine,
      LegalTrademarks1: company,
      LegalTrademarks2: company,
    };

    // 1. The main runtime exe (win-unpacked/NCore.exe) — shown in Task Manager,
    //    Task bar tooltips, file Properties Details tab, and the uninstall entry.
    await rcedit(exePath, {
      icon: iconPath,
      'file-version': version,
      'product-version': version,
      'version-string': {
        ...baseVersionStrings,
        FileDescription: description,
        OriginalFilename: 'NCore.exe',
        InternalName: 'NCore',
      },
    });
    console.log(`[afterPack] Patched runtime executable: ${exePath}`);
  } catch (error) {
    console.warn('[afterPack] Skipped executable patch:', error?.message || error);
  }
}

/**
 * Patch the NSIS installer wrapper itself AFTER electron-builder finishes
 * producing it. The wrapper is what Windows' file-properties dialog and the
 * UAC prompt pull company / copyright / description strings from. This runs
 * from the `afterAllArtifactBuild` electron-builder hook (wired from the
 * same module).
 */
async function patchInstallerArtifacts(buildResult) {
  try {
    if (!buildResult || !Array.isArray(buildResult.artifactPaths)) return;
    const rcedit = require('rcedit');
    const projectRoot = path.resolve(__dirname, '..');
    const iconPath = path.join(projectRoot, 'electron', 'assets', 'ncore-icon.ico');
    const pkgPath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(iconPath) || !fs.existsSync(pkgPath)) return;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const version = String(pkg.version || '').trim() || '0.0.0';
    const company = 'NYPTID Industries Advanced Technologies';
    const product = 'NCore';
    const copyrightLine = String(pkg.build?.copyright || `Copyright © 2026 ${company}`).trim();

    for (const artifactPath of buildResult.artifactPaths) {
      const ext = path.extname(artifactPath).toLowerCase();
      if (ext !== '.exe') continue;
      const fileName = path.basename(artifactPath);
      // Only the top-level setup + uninstaller — skip anything else.
      const isInstaller = /^NCore-Setup-[\d.]+\.exe$/i.test(fileName) || /__uninstaller/i.test(fileName);
      if (!isInstaller) continue;
      try {
        await rcedit(artifactPath, {
          icon: iconPath,
          'file-version': version,
          'product-version': version,
          'version-string': {
            CompanyName: company,
            ProductName: product,
            FileDescription: `${product} Setup`,
            LegalCopyright: copyrightLine,
            LegalTrademarks1: company,
            LegalTrademarks2: company,
            OriginalFilename: fileName,
            InternalName: 'NCoreSetup',
          },
        });
        console.log(`[afterAllArtifactBuild] Patched installer wrapper: ${artifactPath}`);
      } catch (error) {
        console.warn(`[afterAllArtifactBuild] Failed to patch ${fileName}:`, error?.message || error);
      }
    }
  } catch (error) {
    console.warn('[afterAllArtifactBuild] Skipped installer patch:', error?.message || error);
  }
}

module.exports = run;
module.exports.default = run;
module.exports.afterAllArtifactBuild = patchInstallerArtifacts;

