import { useEffect, useMemo, useState } from 'react';
import type { ElementType, MouseEvent } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Download,
  Globe2,
  Layers3,
  PlayCircle,
  ShieldCheck,
  Sparkles,
  Stars,
  Store,
  Workflow,
  Zap,
} from 'lucide-react';
import {
  DEFAULT_UPDATE_FEED_URL,
  fetchLatestInstallerAssetPath,
  fetchLatestMobileInstaller,
  resolveFeedAssetUrl,
} from '../lib/releaseFeed';
import { promptPwaInstall, usePwaRuntime } from '../lib/pwaRuntime';
import { resolveSurfaceUrl } from '../lib/webSurface';

interface Pillar {
  icon: ElementType;
  title: string;
  detail: string;
}

interface Lane {
  title: string;
  subtitle: string;
  detail: string;
  cta: string;
  href: string;
  icon: ElementType;
}

interface WorkflowStep {
  title: string;
  detail: string;
}

const FOUNDATION_PILLARS: Pillar[] = [
  {
    icon: Workflow,
    title: 'Unified communication runtime',
    detail: 'DMs, communities, and calls share one product shell with route-aware behavior.',
  },
  {
    icon: ShieldCheck,
    title: 'Owner-controlled release path',
    detail: 'You own the update feed, installer hosting, and release cadence end to end.',
  },
  {
    icon: Cpu,
    title: 'Infrastructure-ready core',
    detail: 'Built to integrate with your own backend stack and compute model choices.',
  },
  {
    icon: Layers3,
    title: 'Consistent brand surface',
    detail: 'Website, desktop, and in-app surfaces stay visually and operationally aligned.',
  },
];

const RELEASE_WORKFLOW: WorkflowStep[] = [
  {
    title: 'Build and package',
    detail: 'Ship desktop installer artifacts and release notes from one controlled pipeline.',
  },
  {
    title: 'Sync update metadata',
    detail: 'Publish /updates/latest.yml + installer payloads so clients auto-resolve the newest build.',
  },
  {
    title: 'Deploy web surfaces',
    detail: 'Marketing site, web app, and marketplace shell stay version-aware and coherent.',
  },
  {
    title: 'Operate fast patch cadence',
    detail: 'Roll out hotfixes rapidly without waiting on third-party release stores.',
  },
];

export function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [latestInstallerHref, setLatestInstallerHref] = useState('');
  const [mobileApkHref, setMobileApkHref] = useState('');
  const [mobileInstallHint, setMobileInstallHint] = useState('');
  const pwaRuntime = usePwaRuntime();

  const buildVersion = useMemo(() => __APP_VERSION__, []);
  const buildDate = useMemo(
    () =>
      new Date(__BUILD_TIME__).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    []
  );

  const appHref = useMemo(() => resolveSurfaceUrl('app', '/app/dm'), []);
  const marketplaceHref = useMemo(() => resolveSurfaceUrl('marketplace', '/'), []);

  const desktopInstallerName = `NCore Setup ${buildVersion}.exe`;
  const desktopInstallerBlockmapName = `${desktopInstallerName}.blockmap`;
  const desktopInstallerFallbackHref = `/updates/${encodeURIComponent(desktopInstallerName)}`;
  const resolvedInstallerHref = latestInstallerHref || desktopInstallerFallbackHref;
  const localFeedBase = typeof window !== 'undefined'
    ? `${window.location.origin}/updates`
    : DEFAULT_UPDATE_FEED_URL;

  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
  const isAndroidClient = /android/.test(userAgent);
  const isIOSClient = /iphone|ipad|ipod/.test(userAgent);
  const isMobileClient = isAndroidClient || isIOSClient || /mobile/.test(userAgent);
  const primaryDownloadHref = isAndroidClient && mobileApkHref ? mobileApkHref : resolvedInstallerHref;

  const primaryDownloadLabel = isMobileClient
    ? isAndroidClient
      ? mobileApkHref
        ? 'Download NCore for Android'
        : 'Install NCore Web App'
      : 'Install NCore Web App'
    : 'Download NCore';

  const launchLanes: Lane[] = useMemo(
    () => [
      {
        title: 'NCore Web App',
        subtitle: 'app.ncore.nyptidindustries.com',
        detail: 'Primary realtime product surface for chat, calls, communities, and account operations.',
        cta: 'Open Web App',
        href: appHref,
        icon: Globe2,
      },
      {
        title: 'NCore Desktop',
        subtitle: 'Installer + updater feed',
        detail: 'Desktop client with auto-update path mapped to your owned /updates release infrastructure.',
        cta: primaryDownloadLabel,
        href: primaryDownloadHref,
        icon: Download,
      },
      {
        title: 'NCore Marketplace',
        subtitle: 'ncoremarket.nyptidindustries.com',
        detail: 'Dedicated external marketplace shell for QuickDraw hiring operations and game distribution.',
        cta: 'Open Marketplace Site',
        href: marketplaceHref,
        icon: Store,
      },
    ],
    [appHref, marketplaceHref, primaryDownloadHref, primaryDownloadLabel]
  );

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadLatestInstallerPath = async () => {
      try {
        const installerPath = await fetchLatestInstallerAssetPath(localFeedBase);
        if (!installerPath || cancelled) return;
        const absoluteUrl = resolveFeedAssetUrl(localFeedBase, installerPath);
        if (!absoluteUrl) return;
        setLatestInstallerHref(absoluteUrl);
      } catch {
        // keep fallback installer path when feed lookup is unavailable
      }
    };

    void loadLatestInstallerPath();
    return () => {
      cancelled = true;
    };
  }, [localFeedBase]);

  useEffect(() => {
    if (!isMobileClient) return;
    let cancelled = false;

    const resolveMobileInstaller = async () => {
      const mobile = await fetchLatestMobileInstaller(localFeedBase);
      if (cancelled) return;
      if (mobile?.mode === 'apk' && mobile.url) {
        setMobileApkHref(mobile.url);
      } else {
        setMobileApkHref('');
      }
    };

    void resolveMobileInstaller();
    return () => {
      cancelled = true;
    };
  }, [isMobileClient, localFeedBase]);

  async function handlePrimaryDownloadClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!isMobileClient) return;

    if (isAndroidClient && mobileApkHref) {
      setMobileInstallHint('');
      return;
    }

    event.preventDefault();

    if (pwaRuntime.installPromptAvailable || isIOSClient) {
      const result = await promptPwaInstall();
      if (!result.ok && result.message) {
        setMobileInstallHint(result.message);
      } else {
        setMobileInstallHint('');
      }
      return;
    }

    if (isAndroidClient) {
      setMobileInstallHint('Android APK is not uploaded yet. Install NCore from your browser menu with Add to Home screen.');
      return;
    }

    setMobileInstallHint('Install NCore from your browser menu with Add to Home screen.');
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#090e14] text-slate-100">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_-10%,rgba(213,122,32,0.18),transparent_48%),radial-gradient(circle_at_87%_4%,rgba(88,110,166,0.12),transparent_44%),linear-gradient(180deg,#0a1019_0%,#090d14_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(201,145,71,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(201,145,71,0.07)_1px,transparent_1px)] bg-[size:34px_34px] opacity-35" />
      </div>

      <nav
        className={`fixed left-0 right-0 top-0 z-50 border-b transition-all duration-300 ${
          scrolled
            ? 'border-[#2f3036] bg-[#0b1017]/90 backdrop-blur-md'
            : 'border-transparent bg-transparent'
        }`}
      >
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <a href={resolveSurfaceUrl('marketing', '/')} className="flex items-center gap-3">
            <img
              src={`${import.meta.env.BASE_URL}NCore.jpg`}
              alt="NCore"
              className="h-9 w-9 rounded-xl border border-[#3a3d44] object-cover"
            />
            <div>
              <div className="text-lg font-black tracking-wide text-white">NCore</div>
              <div className="text-[11px] text-slate-400">by NYPTID Industries</div>
            </div>
          </a>

          <div className="hidden items-center gap-6 text-sm text-slate-300 md:flex">
            <a href="#platform" className="transition-colors hover:text-white">Platform</a>
            <a href="#execution" className="transition-colors hover:text-white">Execution</a>
            <a href="#launch" className="transition-colors hover:text-white">Launch Surfaces</a>
          </div>

          <div className="flex items-center gap-2">
            <a href={appHref} className="nyptid-btn-secondary hidden px-4 py-2 sm:inline-flex">
              Open Web App
            </a>
            <a
              href={primaryDownloadHref}
              className="nyptid-btn-primary px-4 py-2"
              target="_blank"
              rel="noreferrer"
              onClick={handlePrimaryDownloadClick}
            >
              {primaryDownloadLabel}
            </a>
          </div>
        </div>
      </nav>

      <main className="relative z-10 px-6 pb-20 pt-32">
        <section className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[1.04fr_0.96fr]">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#5a4c2e] bg-[#3c2c16]/55 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.11em] text-[#f0cd83]">
              <Sparkles size={14} />
              Release track v{buildVersion}
            </div>

            <h1 className="text-5xl font-black leading-tight tracking-tight text-[#f9f7f2] md:text-6xl">
              Serious communication
              <br />
              infrastructure for
              <br />
              <span className="bg-[linear-gradient(120deg,#f2c66d,#df932f,#ffdca1)] bg-clip-text text-transparent">
                operators who ship fast.
              </span>
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">
              NCore combines realtime communication, owned update infrastructure, and web-to-desktop continuity in one
              product stack so your team controls operations instead of renting platform direction.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a href={appHref} className="nyptid-btn-primary px-6 py-3 text-base">
                Open NCore Web App
                <ArrowRight size={18} />
              </a>
              <a href={marketplaceHref} className="nyptid-btn-secondary px-6 py-3 text-base">
                Explore Marketplace Site
                <ChevronRight size={18} />
              </a>
            </div>

            {mobileInstallHint && (
              <div className="mt-4 max-w-2xl rounded-lg border border-[#8d6e33] bg-[#3a2d13]/65 px-4 py-2.5 text-sm text-[#f6d894]">
                {mobileInstallHint}
              </div>
            )}

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[#343842] bg-[#151b24]/90 px-4 py-3 text-sm text-slate-200">
                <div className="mb-1 text-xs uppercase tracking-[0.11em] text-slate-400">Runtime Targets</div>
                Desktop + Web + PWA
              </div>
              <div className="rounded-xl border border-[#343842] bg-[#151b24]/90 px-4 py-3 text-sm text-slate-200">
                <div className="mb-1 text-xs uppercase tracking-[0.11em] text-slate-400">Release Domain</div>
                ncore.nyptidindustries.com/updates
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#4d412f] bg-[linear-gradient(160deg,rgba(63,40,20,0.82),rgba(23,18,13,0.92)_68%,rgba(16,13,11,0.96))] p-6 lg:p-7">
            <div className="mb-2 text-xs uppercase tracking-[0.11em] text-[#d2b483]">Release command center</div>
            <div className="text-2xl font-black text-[#fff6e3]">NCore v{buildVersion}</div>
            <div className="mb-6 mt-1 text-sm text-[#c9b08a]">Built on {buildDate}</div>

            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-xl border border-[#5a4b37] bg-[#2f2216]/85 p-3">
                <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-[#4dd29d]" />
                <p className="text-sm text-[#e5d3b8]">Desktop updater resolves the latest installer from one managed feed.</p>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-[#5a4b37] bg-[#2f2216]/85 p-3">
                <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-[#4dd29d]" />
                <p className="text-sm text-[#e5d3b8]">Web and desktop release identity stay synchronized per version bump.</p>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-[#5a4b37] bg-[#2f2216]/85 p-3">
                <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-[#4dd29d]" />
                <p className="text-sm text-[#e5d3b8]">PWA install path is available for mobile users when native installers are not preferred.</p>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-[#594a35] bg-[#2a1f15] p-3">
                <div className="text-xs text-[#bf9f72]">Default feed file</div>
                <div className="mt-1 text-sm font-semibold text-[#ffeecf]">/updates/latest.yml</div>
              </div>
              <div className="rounded-lg border border-[#594a35] bg-[#2a1f15] p-3">
                <div className="text-xs text-[#bf9f72]">Installer payload</div>
                <div className="mt-1 text-sm font-semibold text-[#ffeecf]">{desktopInstallerName}</div>
              </div>
            </div>
          </div>
        </section>

        <section id="platform" className="mx-auto mt-20 w-full max-w-7xl">
          <div className="mb-8 flex items-end justify-between gap-6">
            <div>
              <h2 className="text-4xl font-black text-white">Platform Foundation</h2>
              <p className="mt-3 max-w-3xl text-slate-400">
                NCore is architected as an operator platform: communication runtime, release control, and extensible infrastructure.
              </p>
            </div>
            <div className="hidden rounded-lg border border-[#3a3d44] bg-[#141922] px-3 py-2 text-xs text-slate-400 lg:inline-flex">
              Updated runtime profile: March 2026
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {FOUNDATION_PILLARS.map((pillar) => (
              <div key={pillar.title} className="rounded-2xl border border-[#333743] bg-[#121823]/90 p-5">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#4f5563] bg-[#1a2331]">
                  <pillar.icon size={17} className="text-[#f0cd83]" />
                </div>
                <h3 className="text-lg font-bold text-white">{pillar.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{pillar.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="execution" className="mx-auto mt-20 grid w-full max-w-7xl gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="rounded-2xl border border-[#343945] bg-[#111824]/88 p-6">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#444c5b] bg-[#182131] px-3 py-1 text-xs uppercase tracking-[0.11em] text-slate-300">
              <Zap size={14} />
              Execution workflow
            </div>
            <h3 className="text-2xl font-black text-white">How NCore ships production releases</h3>
            <div className="mt-5 space-y-4">
              {RELEASE_WORKFLOW.map((step, index) => (
                <div key={step.title} className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-[#4d5566] bg-[#1b2534] text-xs font-bold text-[#f0cd83]">
                    {index + 1}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">{step.title}</div>
                    <p className="mt-1 text-sm leading-relaxed text-slate-300">{step.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#343945] bg-[#111824]/88 p-6">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#444c5b] bg-[#182131] px-3 py-1 text-xs uppercase tracking-[0.11em] text-slate-300">
              <Stars size={14} />
              Experience layer
            </div>
            <h3 className="text-2xl font-black text-white">Web app quality gates</h3>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <div className="rounded-xl border border-[#3a4150] bg-[#171f2d] p-3">
                Route-aware app shell for desktop + browser parity.
              </div>
              <div className="rounded-xl border border-[#3a4150] bg-[#171f2d] p-3">
                PWA runtime with install prompt support and update polling.
              </div>
              <div className="rounded-xl border border-[#3a4150] bg-[#171f2d] p-3">
                Dedicated marketplace web property with separate visual language.
              </div>
              <div className="rounded-xl border border-[#3a4150] bg-[#171f2d] p-3">
                Installer artifacts and feed metadata pinned to each release card.
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-[#4c412e] bg-[#2a2115] p-3 text-xs text-[#e6c990]">
              /updates/{desktopInstallerBlockmapName}
            </div>
          </div>
        </section>

        <section id="launch" className="mx-auto mt-20 w-full max-w-7xl">
          <div className="mb-8 flex items-center gap-3">
            <PlayCircle size={20} className="text-[#f0cd83]" />
            <h2 className="text-4xl font-black text-white">Choose Launch Surface</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {launchLanes.map((lane) => (
              <div key={lane.title} className="rounded-2xl border border-[#343945] bg-[#111824]/88 p-5">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#4f5665] bg-[#1a2331]">
                  <lane.icon size={17} className="text-[#f0cd83]" />
                </div>
                <div className="text-xs uppercase tracking-[0.11em] text-slate-400">{lane.subtitle}</div>
                <h3 className="mt-1 text-xl font-bold text-white">{lane.title}</h3>
                <p className="mt-2 min-h-[84px] text-sm leading-relaxed text-slate-300">{lane.detail}</p>
                <a
                  href={lane.href}
                  className="nyptid-btn-primary mt-4 w-full px-4 py-2.5"
                  target={lane.href.startsWith('http') ? '_blank' : undefined}
                  rel={lane.href.startsWith('http') ? 'noreferrer' : undefined}
                  onClick={lane.title === 'NCore Desktop' ? handlePrimaryDownloadClick : undefined}
                >
                  {lane.cta}
                  <ArrowRight size={16} />
                </a>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-[#2f333d] px-6 py-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-4 md:flex-row">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <img src={`${import.meta.env.BASE_URL}NCore.jpg`} alt="NCore" className="h-7 w-7 rounded-md border border-[#3b3f48] object-cover" />
            NCore by NYPTID Industries Advanced Technologies
          </div>
          <div className="text-xs text-slate-500">Build v{buildVersion}</div>
        </div>
      </footer>
    </div>
  );
}
