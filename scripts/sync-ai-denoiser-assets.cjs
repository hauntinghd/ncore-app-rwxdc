const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(projectRoot, 'node_modules', 'agora-extension-ai-denoiser', 'external');
const targetDir = path.join(projectRoot, 'public', 'ai-denoiser');

if (!fs.existsSync(sourceDir)) {
  console.warn('[sync-ai-denoiser-assets] Source assets not found:', sourceDir);
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });

for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const sourcePath = path.join(sourceDir, entry.name);
  const targetPath = path.join(targetDir, entry.name);
  fs.copyFileSync(sourcePath, targetPath);
}

console.log('[sync-ai-denoiser-assets] Synced Agora AI denoiser assets to public/ai-denoiser');
