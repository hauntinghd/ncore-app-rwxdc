function normalizeBasePath(path: string): string {
  const value = String(path || '').trim();
  if (!value) return '/app/settings';
  return value.startsWith('/') ? value : `/${value}`;
}

export function resolveBillingReturnUrl(path = '/app/settings'): string {
  const normalizedPath = normalizeBasePath(path);
  const fallback = `https://ncore.nyptidindustries.com${normalizedPath}`;

  try {
    const current = new URL(window.location.href);
    if (current.protocol === 'https:' || current.protocol === 'http:') {
      current.pathname = normalizedPath;
      current.search = '';
      current.hash = '';
      return current.toString();
    }
  } catch {
    // noop
  }

  return fallback;
}
