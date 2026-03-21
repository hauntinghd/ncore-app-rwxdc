#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const ncoreDomain = 'ncore.nyptidindustries.com';

function run(command, options = {}) {
  const capture = Boolean(options.capture);
  const result = spawnSync(command, {
    cwd: projectRoot,
    shell: true,
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });

  if (capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command}`);
  }

  return capture ? `${result.stdout || ''}\n${result.stderr || ''}` : '';
}

function extractDeploymentUrl(output) {
  const productionMatches = Array.from(
    output.matchAll(/Production:\s+(https:\/\/[^\s]+)/gi),
  ).map((match) => String(match[1] || '').trim().replace(/[)\],]+$/, ''));
  if (productionMatches.length > 0) {
    return productionMatches[productionMatches.length - 1];
  }

  const genericMatches = Array.from(
    output.matchAll(/https:\/\/[a-z0-9-]+\.vercel\.app/gi),
  ).map((match) => String(match[0] || '').trim());
  if (genericMatches.length > 0) {
    return genericMatches[genericMatches.length - 1];
  }

  return '';
}

function main() {
  run('node scripts/ensure-latest-installer.cjs');
  run('npm run build');

  // Deploy production build without auto-promoting project custom domains.
  const deployOutput = run('npx vercel --prod --yes --skip-domain', { capture: true });
  const deploymentUrl = extractDeploymentUrl(deployOutput);
  if (!deploymentUrl) {
    throw new Error('Could not determine Vercel deployment URL from CLI output.');
  }

  run(`npx vercel alias set ${deploymentUrl} ${ncoreDomain}`);
  console.log(`[release-web] Aliased ${deploymentUrl} -> https://${ncoreDomain}`);
}

try {
  main();
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
