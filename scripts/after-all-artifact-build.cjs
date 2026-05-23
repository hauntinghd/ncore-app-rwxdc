#!/usr/bin/env node
// electron-builder `afterAllArtifactBuild` hook.
// Patches the NSIS installer wrapper (the file shown in the Windows file-
// properties dialog and the UAC elevation prompt) with NYPTID company
// metadata via rcedit.
const afterPack = require('./after-pack.cjs');

module.exports = async function afterAllArtifactBuild(buildResult) {
  if (typeof afterPack.afterAllArtifactBuild === 'function') {
    await afterPack.afterAllArtifactBuild(buildResult);
  }
  // electron-builder ignores the return when undefined. Returning an empty
  // array means "no additional artifacts produced by this hook".
  return [];
};
