export const DEFAULT_UPDATE_FEED_URL = 'https://ncore.nyptidindustries.com/updates';

export interface ReleaseLogEntry {
  version: string;
  date: string;
  badge: string;
  improvements: string[];
  bugFixes: string[];
}

export interface MobileLatestEntry {
  mode: 'apk' | 'pwa';
  version: string;
  url: string;
  message: string;
  fileName?: string;
  updatedAt?: string;
}

function clean(value: unknown): string {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function toAbsoluteUrl(baseUrl: string, targetPath: string): string {
  const cleanedPath = clean(targetPath);
  if (!cleanedPath) return '';
  if (/^https?:\/\//i.test(cleanedPath)) return cleanedPath;
  try {
    const normalizedBase = normalizeUpdateFeedBase(baseUrl, DEFAULT_UPDATE_FEED_URL);
    const base = normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`;
    return new URL(cleanedPath.replace(/^\/+/, ''), base).toString();
  } catch {
    return '';
  }
}

export function normalizeUpdateFeedBase(rawUrl: string, fallback = DEFAULT_UPDATE_FEED_URL): string {
  const value = clean(rawUrl);
  if (!value) return fallback;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return fallback;
    const noHash = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
    return noHash.endsWith('/latest.yml') ? noHash.replace(/\/latest\.yml$/i, '') : noHash;
  } catch {
    return fallback;
  }
}

function normalizeSemver(value: string): string {
  const cleaned = clean(value).replace(/^v/i, '');
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return '';
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function getReleaseVersionKey(version: string): string {
  const semver = normalizeSemver(version);
  if (semver) return semver;
  return clean(version).toLowerCase();
}

export function compareSemver(a: string, b: string): number {
  const pa = normalizeSemver(a).split('.').map((v) => Number(v));
  const pb = normalizeSemver(b).split('.').map((v) => Number(v));
  if (pa.length !== 3 || pb.length !== 3 || pa.some(Number.isNaN) || pb.some(Number.isNaN)) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function parseSortableDate(rawDate: string): number {
  const parsed = Date.parse(clean(rawDate));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function dedupeAndSortReleaseLog(entries: ReleaseLogEntry[]): ReleaseLogEntry[] {
  const seen = new Set<string>();
  const output: ReleaseLogEntry[] = [];

  for (const entry of entries) {
    const version = clean(entry?.version);
    if (!version) continue;
    const key = getReleaseVersionKey(version);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    output.push({
      version,
      date: clean(entry?.date),
      badge: clean(entry?.badge || 'Release'),
      improvements: Array.isArray(entry?.improvements)
        ? entry.improvements.map((item) => clean(item)).filter(Boolean)
        : [],
      bugFixes: Array.isArray(entry?.bugFixes)
        ? entry.bugFixes.map((item) => clean(item)).filter(Boolean)
        : [],
    });
  }

  output.sort((a, b) => {
    const semverOrder = compareSemver(b.version, a.version);
    if (semverOrder !== 0) return semverOrder;

    const bDate = parseSortableDate(b.date);
    const aDate = parseSortableDate(a.date);
    if (!Number.isNaN(bDate) && !Number.isNaN(aDate) && bDate !== aDate) {
      return bDate - aDate;
    }

    return b.version.localeCompare(a.version, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });

  return output;
}

export function applyReleaseBadges(
  releases: ReleaseLogEntry[],
  options: { currentBuildVersion?: string; latestFeedVersion?: string } = {},
): ReleaseLogEntry[] {
  const currentKey = getReleaseVersionKey(String(options.currentBuildVersion || ''));
  const latestKey = getReleaseVersionKey(String(options.latestFeedVersion || ''));

  return releases.map((release, index) => {
    const releaseKey = getReleaseVersionKey(release.version);
    let badge = clean(release.badge || '');

    if (currentKey && releaseKey && releaseKey === currentKey) {
      badge = 'Current Build';
    } else if (latestKey && releaseKey && releaseKey === latestKey) {
      badge = currentKey === latestKey ? 'Current Build' : 'Latest Release';
    } else if (currentKey || latestKey) {
      badge = 'Previous';
    } else if (!badge) {
      badge = index === 0 ? 'Release' : 'Previous';
    }

    return {
      ...release,
      badge,
    };
  });
}

export async function resolveUpdateFeedBase(defaultUrl = DEFAULT_UPDATE_FEED_URL): Promise<string> {
  const fallback = normalizeUpdateFeedBase(defaultUrl, DEFAULT_UPDATE_FEED_URL);
  if (typeof window === 'undefined' || !window.desktopBridge?.getUpdateConfig) {
    return fallback;
  }

  try {
    const result = await window.desktopBridge.getUpdateConfig();
    if (result.ok && typeof result.url === 'string') {
      return normalizeUpdateFeedBase(result.url, fallback);
    }
  } catch {
    // use fallback
  }

  return fallback;
}

function normalizeReleaseRows(payload: unknown): ReleaseLogEntry[] {
  const payloadRecord = payload && typeof payload === 'object'
    ? payload as { releases?: unknown }
    : null;
  const sourceRows = Array.isArray(payload)
    ? payload
    : Array.isArray(payloadRecord?.releases)
      ? payloadRecord.releases
      : [];

  const collectList = (...sources: unknown[]): string[] => (
    sources
      .flatMap((source) => (Array.isArray(source) ? source : []))
      .map((entry) => clean(entry))
      .filter(Boolean)
  );

  return sourceRows
    .map((sourceRow): ReleaseLogEntry | null => {
      const row = sourceRow && typeof sourceRow === 'object'
        ? sourceRow as Record<string, unknown>
        : null;
      if (!row) return null;

      const changes = row.changes && typeof row.changes === 'object'
        ? row.changes as Record<string, unknown>
        : null;

      const version = clean(row.version);
      if (!version) return null;
      const date = clean(
        row.date
        || row.releaseDate
        || row.releasedAt
        || row.updatedAt
        || row.created_at
        || 'Previous release',
      );
      const badge = clean(row.badge || 'Release');
      const improvements = collectList(
        row.improvements,
        row.highlights,
        row.features,
        changes?.improvements,
        changes?.features,
      );
      const bugFixes = collectList(
        row.bugFixes,
        row.fixes,
        changes?.bugFixes,
        changes?.fixes,
      );
      return { version, date, badge, improvements, bugFixes };
    })
    .filter((entry: ReleaseLogEntry | null): entry is ReleaseLogEntry => Boolean(entry));
}

export async function fetchReleaseNotesFromFeed(feedBase: string): Promise<ReleaseLogEntry[]> {
  const normalizedBase = normalizeUpdateFeedBase(feedBase, DEFAULT_UPDATE_FEED_URL);
  const query = `?ts=${Date.now()}`;
  const candidates = Array.from(
    new Set([`${normalizedBase}/release-notes.json${query}`, `/updates/release-notes.json${query}`]),
  );

  for (const url of candidates) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) continue;
      const payload = await response.json();
      const normalized = normalizeReleaseRows(payload);
      if (normalized.length > 0) {
        return normalized;
      }
    } catch {
      // try next candidate
    }
  }

  return [];
}

export async function fetchLatestReleaseVersion(feedBase: string): Promise<string> {
  const normalizedBase = normalizeUpdateFeedBase(feedBase, DEFAULT_UPDATE_FEED_URL);
  const candidates = Array.from(
    new Set([`${normalizedBase}/latest.yml?ts=${Date.now()}`, `/updates/latest.yml?ts=${Date.now()}`]),
  );

  for (const url of candidates) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) continue;
      const raw = await response.text();
      const versionMatch = raw.match(/^version:\s*(.+)$/m);
      if (!versionMatch) continue;
      const version = clean(versionMatch[1]);
      if (version) return version;
    } catch {
      // try next
    }
  }

  return '';
}

export async function fetchLatestInstallerAssetPath(feedBase: string): Promise<string> {
  const normalizedBase = normalizeUpdateFeedBase(feedBase, DEFAULT_UPDATE_FEED_URL);
  const candidates = Array.from(
    new Set([`${normalizedBase}/latest.yml?ts=${Date.now()}`, `/updates/latest.yml?ts=${Date.now()}`]),
  );

  for (const url of candidates) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) continue;
      const raw = await response.text();
      const pathMatch = raw.match(/^path:\s*(.+)$/m);
      if (pathMatch) {
        const installerPath = clean(pathMatch[1]);
        if (installerPath) return installerPath;
      }
      const urlMatch = raw.match(/^\s*-\s*url:\s*(.+)$/m);
      if (urlMatch) {
        const installerPath = clean(urlMatch[1]);
        if (installerPath) return installerPath;
      }
    } catch {
      // try next
    }
  }

  return '';
}

export async function fetchLatestMobileInstaller(feedBase: string): Promise<MobileLatestEntry | null> {
  const normalizedBase = normalizeUpdateFeedBase(feedBase, DEFAULT_UPDATE_FEED_URL);
  const timestamp = Date.now();
  const candidates = Array.from(
    new Set([`${normalizedBase}/mobile-latest.json?ts=${timestamp}`, `/updates/mobile-latest.json?ts=${timestamp}`]),
  );

  for (const url of candidates) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) continue;
      const payload = await response.json();
      const rawMode = clean(payload?.mode).toLowerCase();
      const mode: 'apk' | 'pwa' = rawMode === 'apk' ? 'apk' : 'pwa';
      const relativeUrl = clean(
        payload?.url
        || payload?.path
        || payload?.apkUrl
        || payload?.apkPath
        || (mode === 'pwa' ? '/' : ''),
      );
      const resolvedUrl = toAbsoluteUrl(normalizedBase, relativeUrl);
      if (!resolvedUrl) continue;

      return {
        mode,
        version: clean(payload?.version),
        url: resolvedUrl,
        message: clean(payload?.message),
        fileName: clean(payload?.fileName || payload?.file),
        updatedAt: clean(payload?.updatedAt || payload?.updated_at),
      };
    } catch {
      // try next candidate
    }
  }

  const apkFallbackCandidates = ['/updates/NCore-Mobile.apk', '/updates/NCore Mobile.apk', '/updates/NCore.apk'];
  for (const relativeUrl of apkFallbackCandidates) {
    const absoluteUrl = toAbsoluteUrl(normalizedBase, relativeUrl);
    if (!absoluteUrl) continue;
    try {
      const response = await fetch(absoluteUrl, { method: 'HEAD', cache: 'no-store' });
      if (!response.ok) continue;
      return {
        mode: 'apk',
        version: '',
        url: absoluteUrl,
        message: 'Latest Android installer is available for direct download.',
      };
    } catch {
      // try next candidate
    }
  }

  return null;
}

export function resolveFeedAssetUrl(feedBase: string, assetPath: string): string {
  return toAbsoluteUrl(feedBase, assetPath);
}

export function buildFallbackReleaseLog(buildVersion: string, buildDate: string): ReleaseLogEntry[] {
  return [
    {
      version: buildVersion,
      date: buildDate,
      badge: 'Current Build',
      improvements: [
        `NCore desktop build v${buildVersion} is installed locally.`,
        'Live release notes are fetched from your configured update feed.',
      ],
      bugFixes: [
        'Remote release notes are temporarily unavailable; showing local fallback details.',
      ],
    },
  ];
}
