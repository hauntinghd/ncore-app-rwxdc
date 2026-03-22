export type WebSurface = 'marketing' | 'app' | 'marketplace';

const PRODUCTION_HOSTS: Record<WebSurface, string> = {
  marketing: 'ncore.nyptidindustries.com',
  app: 'app.ncore.nyptidindustries.com',
  marketplace: 'ncoremarketplace.nyptidindustries.com',
};

function isLocalHost(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local')
  );
}

function normalizedPath(pathname: string) {
  if (!pathname) return '/';
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

export function detectWebSurface(isElectron = false): WebSurface {
  if (isElectron || typeof window === 'undefined') return 'app';
  const params = new URLSearchParams(window.location.search);
  const forcedSurface = params.get('surface');
  if (forcedSurface === 'marketing' || forcedSurface === 'app' || forcedSurface === 'marketplace') {
    return forcedSurface;
  }

  const host = window.location.hostname.toLowerCase();
  if (isLocalHost(host)) return 'marketing';
  if (
    host.includes('ncoremarketplace.') ||
    host.startsWith('ncoremarketplace-') ||
    host.includes('ncoremarket.') ||
    host.startsWith('ncoremarket-') ||
    host.startsWith('market.ncore')
  ) {
    return 'marketplace';
  }
  if (host.startsWith('app.') || host.startsWith('webapp.')) {
    return 'app';
  }
  return 'marketing';
}

export function resolveSurfaceUrl(surface: WebSurface, pathname = '/'): string {
  if (typeof window === 'undefined') return normalizedPath(pathname);
  const currentHost = window.location.hostname.toLowerCase();
  const path = normalizedPath(pathname);

  if (isLocalHost(currentHost) || currentHost.endsWith('.vercel.app') || currentHost.endsWith('.netlify.app')) {
    return path;
  }

  if (!currentHost.endsWith('nyptidindustries.com')) {
    return path;
  }

  const targetHost = PRODUCTION_HOSTS[surface];
  if (!targetHost || currentHost === targetHost) return path;

  return `https://${targetHost}${path}`;
}
