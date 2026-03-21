#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const shouldSkipIfMissing = process.argv.includes('--if-present');

const projectRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(projectRoot, 'release');
const latestYmlPath = path.join(releaseDir, 'latest.yml');
const publicReleaseNotesPath = path.join(projectRoot, 'public', 'updates', 'release-notes.json');
const pendingNotesPaths = [
  path.join(projectRoot, 'release-notes.next.json'),
  path.join(releaseDir, 'release-notes.next.json'),
];
const targets = [
  path.join(projectRoot, 'public', 'updates'),
  path.join(projectRoot, 'dist', 'updates'),
];
const mobileFeedFileName = 'mobile-latest.json';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseLatestYml(raw) {
  const versionMatch = raw.match(/^version:\s*(.+)$/m);
  const pathMatch = raw.match(/^path:\s*(.+)$/m);
  const urlMatches = Array.from(raw.matchAll(/^\s*-\s*url:\s*(.+)$/gm));

  const clean = (value) => String(value || '').trim().replace(/^['"]|['"]$/g, '');
  const version = versionMatch ? clean(versionMatch[1]) : '';
  const pathValue = pathMatch ? clean(pathMatch[1]) : '';
  const urls = urlMatches.map((m) => clean(m[1])).filter(Boolean);
  const installerName = pathValue || urls[0] || '';

  return { version, installerName, urls };
}

function copyFile(sourcePath, targetDir) {
  if (!fs.existsSync(sourcePath)) return false;
  ensureDir(targetDir);
  const destPath = path.join(targetDir, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, destPath);
  return true;
}

function pruneTargetBinaries(targetDir, keepFileNames) {
  ensureDir(targetDir);
  const keep = new Set((Array.isArray(keepFileNames) ? keepFileNames : []).filter(Boolean));
  const binaryExtensions = new Set(['.exe', '.blockmap', '.apk']);
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!binaryExtensions.has(ext)) continue;
    if (keep.has(entry.name)) continue;
    try {
      fs.unlinkSync(path.join(targetDir, entry.name));
    } catch (error) {
      console.warn(`Warning: failed to remove stale update artifact ${entry.name}: ${error?.message || error}`);
    }
  }
}

function parseSemver(value) {
  const match = String(value || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemverTuple(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

function formatSemverTuple(tuple) {
  if (!tuple) return '0.0.0';
  return `${tuple[0]}.${tuple[1]}.${tuple[2]}`;
}

function assertPatchStepVersion(version, releases) {
  const currentTuple = parseSemver(version);
  if (!currentTuple) {
    throw new Error(`Version step violation: "${version}" is not valid semver (x.y.z).`);
  }

  const existing = Array.isArray(releases)
    ? releases
      .map((entry) => String(entry?.version || '').trim())
      .map((value) => ({ value, tuple: parseSemver(value) }))
      .filter((entry) => entry.tuple)
    : [];

  if (existing.length === 0) return;

  existing.sort((a, b) => compareSemverTuple(a.tuple, b.tuple) * -1);
  const previous = existing[0];
  if (!previous?.tuple) return;

  // Allow re-sync for the same version (e.g. deployment retry), but block non-+1 jumps for new versions.
  if (compareSemverTuple(currentTuple, previous.tuple) === 0) {
    return;
  }

  const expected = [previous.tuple[0], previous.tuple[1], previous.tuple[2] + 1];
  const isExpectedPatchStep = currentTuple[0] === expected[0]
    && currentTuple[1] === expected[1]
    && currentTuple[2] === expected[2];

  if (!isExpectedPatchStep) {
    throw new Error(
      `Version step violation: expected next release v${formatSemverTuple(expected)} after v${previous.value}; got v${version}. Run npm run version:bump before syncing.`,
    );
  }
}

function listApkCandidates(searchDirs) {
  const candidates = [];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith('.apk')) continue;
      const fullPath = path.join(dir, entry.name);
      const stats = fs.statSync(fullPath);
      candidates.push({
        dir,
        name: entry.name,
        fullPath,
        mtimeMs: Number(stats.mtimeMs || 0),
        semver: parseSemver(entry.name),
      });
    }
  }
  return candidates;
}

function findLatestApk() {
  const searchDirs = [releaseDir, ...targets];
  const candidates = listApkCandidates(searchDirs);
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const semverOrder = compareSemverTuple(a.semver, b.semver);
    if (semverOrder !== 0) return semverOrder * -1;
    return b.mtimeMs - a.mtimeMs;
  });

  return candidates[0];
}

function buildMobileFeed(version, latestApk) {
  const updatedAt = new Date().toISOString();
  if (!latestApk) {
    return {
      mode: 'pwa',
      version,
      updatedAt,
      url: '/',
      message: 'Android installer is not published yet. Install NCore from your browser menu with Add to Home Screen.',
    };
  }

  return {
    mode: 'apk',
    version: latestApk.semver ? latestApk.semver.join('.') : version,
    updatedAt,
    fileName: latestApk.name,
    url: latestApk.name,
    message: 'Latest Android installer is available for direct download.',
  };
}

function syncMobileFeed(version) {
  const latestApk = findLatestApk();
  if (latestApk) {
    for (const targetDir of targets) {
      copyFile(latestApk.fullPath, targetDir);
    }
  }

  const mobileFeed = buildMobileFeed(version, latestApk);
  for (const targetDir of targets) {
    ensureDir(targetDir);
    const outputPath = path.join(targetDir, mobileFeedFileName);
    fs.writeFileSync(outputPath, `${JSON.stringify(mobileFeed, null, 2)}\n`, 'utf8');
  }
  return latestApk ? latestApk.name : '';
}

function sanitizeList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function loadPendingReleaseNotes(version) {
  const pendingPath = pendingNotesPaths.find((candidate) => fs.existsSync(candidate));
  if (!pendingPath) return null;
  try {
    const raw = fs.readFileSync(pendingPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const improvements = sanitizeList(parsed.improvements);
    const bugFixes = sanitizeList(parsed.bugFixes);
    if (improvements.length === 0 && bugFixes.length === 0) {
      console.warn('release-notes.next.json is present but empty. Falling back to default notes.');
      return null;
    }

    const requestedVersion = String(parsed.version || '').trim();
    if (requestedVersion && requestedVersion !== version) {
      console.warn(
        `release-notes.next.json targets version ${requestedVersion} but current build is ${version}. Using current build version.`,
      );
    }

    const date = String(parsed.date || '').trim() || new Date().toISOString().slice(0, 10);
    const badge = String(parsed.badge || '').trim() || 'Current Build';
    const preserveFile = Boolean(parsed.preserveFile);

    return { date, badge, improvements, bugFixes, preserveFile, pendingPath };
  } catch (error) {
    console.warn(`Warning: failed to parse release-notes.next.json: ${error?.message || error}`);
    return null;
  }
}

function syncReleaseNotes(version) {
  ensureDir(path.dirname(publicReleaseNotesPath));

  let releaseNotes = { releases: [] };
  if (fs.existsSync(publicReleaseNotesPath)) {
    try {
      const raw = fs.readFileSync(publicReleaseNotesPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.releases)) {
        releaseNotes = parsed;
      }
    } catch (error) {
      console.warn(`Warning: failed to parse release-notes.json, recreating file: ${error?.message || error}`);
    }
  }

  assertPatchStepVersion(version, releaseNotes.releases);

  const existingEntry = releaseNotes.releases.find((entry) => String(entry?.version || '').trim() === version) || null;
  const existing = releaseNotes.releases.filter((entry) => String(entry?.version || '').trim() !== version);
  for (const entry of existing) {
    if (entry?.badge === 'Current Build') {
      entry.badge = 'Previous';
    }
  }

  const pending = loadPendingReleaseNotes(version);
  const allowDefaultNotes = process.env.NCORE_ALLOW_DEFAULT_RELEASE_NOTES === '1';
  const shouldReuseExisting = !pending
    && existingEntry
    && (
      (Array.isArray(existingEntry.improvements) && existingEntry.improvements.length > 0)
      || (Array.isArray(existingEntry.bugFixes) && existingEntry.bugFixes.length > 0)
    );

  if (!pending && !shouldReuseExisting && !allowDefaultNotes) {
    throw new Error(
      'Missing curated release notes. Create project/release-notes.next.json before syncing a new version.',
    );
  }

  const newEntry = pending ? {
    version,
    date: pending.date,
    badge: pending.badge,
    improvements: pending.improvements,
    bugFixes: pending.bugFixes,
  } : shouldReuseExisting ? {
    ...existingEntry,
    version,
    badge: 'Current Build',
  } : {
    version,
    date: new Date().toISOString().slice(0, 10),
    badge: 'Current Build',
    improvements: [
      `Release pipeline advanced to v${version} with the newest installer package.`,
      'Desktop installer and website update feed are now aligned.',
      "What's New and release metadata now stay in sync automatically per version bump.",
    ],
    bugFixes: [
      'Fixed feed mismatch where latest installer version could advance without a matching top release note entry.',
      'Release badge rotation now updates consistently so only the newest entry is marked Current Build.',
      'Improved deployment consistency for update metadata across public and dist feed directories.',
    ],
  };

  releaseNotes.releases = [newEntry, ...existing];
  fs.writeFileSync(publicReleaseNotesPath, `${JSON.stringify(releaseNotes, null, 4)}\n`, 'utf8');

  if (pending && !pending.preserveFile) {
    try {
      fs.unlinkSync(pending.pendingPath);
    } catch (error) {
      console.warn(`Warning: failed to clear release-notes.next.json: ${error?.message || error}`);
    }
  }
}

function main() {
  if (!fs.existsSync(latestYmlPath)) {
    if (shouldSkipIfMissing) {
      console.log(`No release/latest.yml found. Skipping update feed sync.`);
      return;
    }
    throw new Error(`Missing ${latestYmlPath}. Run electron-builder first.`);
  }

  const latestRaw = fs.readFileSync(latestYmlPath, 'utf8');
  const parsed = parseLatestYml(latestRaw);

  if (!parsed.version) {
    throw new Error('release/latest.yml is missing version.');
  }
  if (!parsed.installerName) {
    throw new Error('release/latest.yml is missing installer path/url.');
  }

  const installerPath = path.join(releaseDir, parsed.installerName);
  if (!fs.existsSync(installerPath)) {
    if (shouldSkipIfMissing) {
      console.log(`Installer missing for latest.yml (${installerPath}). Skipping update feed sync.`);
      return;
    }
    throw new Error(`Missing installer ${installerPath}.`);
  }

  const blockmapPath = `${installerPath}.blockmap`;
  const installerFileName = path.basename(installerPath);
  const blockmapFileName = path.basename(blockmapPath);
  syncReleaseNotes(parsed.version);

  for (const targetDir of targets) {
    copyFile(latestYmlPath, targetDir);
    copyFile(installerPath, targetDir);
    copyFile(blockmapPath, targetDir);
    copyFile(publicReleaseNotesPath, targetDir);
  }
  const latestApkFileName = syncMobileFeed(parsed.version);
  for (const targetDir of targets) {
    pruneTargetBinaries(targetDir, [installerFileName, blockmapFileName, latestApkFileName]);
  }

  console.log(`Update feed synced: v${parsed.version}`);
  console.log(`Installer: ${path.basename(installerPath)}`);
}

try {
  main();
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
