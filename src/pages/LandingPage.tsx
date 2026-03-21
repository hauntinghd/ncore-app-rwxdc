import { useEffect, useMemo, useState } from 'react';
import type { ElementType, MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  ChevronRight,
  CloudCog,
  Cpu,
  Download,
  Globe,
  Gauge,
  Layers,
  Lock,
  MessageSquare,
  PhoneCall,
  Rocket,
  Shield,
  Sparkles,
  TimerReset,
  Workflow,
} from 'lucide-react';
import {
  DEFAULT_UPDATE_FEED_URL,
  fetchLatestInstallerAssetPath,
  fetchLatestMobileInstaller,
  resolveFeedAssetUrl,
} from '../lib/releaseFeed';
import { promptPwaInstall, usePwaRuntime } from '../lib/pwaRuntime';

interface FeaturePillar {
  icon: ElementType;
  title: string;
  description: string;
}

interface OperatorStep {
  title: string;
  detail: string;
}

interface CompareRow {
  capability: string;
  ncore: string;
  alternatives: string;
}

interface TrustChip {
  icon: ElementType;
  label: string;
  value: string;
}

const TRUST_CHIPS: TrustChip[] = [
  {
    icon: PhoneCall,
    label: 'Call runtime',
    value: 'Persistent session model',
  },
  {
    icon: Download,
    label: 'Release delivery',
    value: 'Self-hosted update feed',
  },
  {
    icon: Cpu,
    label: 'Compute model',
    value: 'RunPod compatible',
  },
  {
    icon: Globe,
    label: 'Runtime targets',
    value: 'Desktop + Web + PWA',
  },
];

const FEATURE_PILLARS: FeaturePillar[] = [
  {
    icon: Workflow,
    title: 'Unified communication core',
    description:
      'Direct messages, group threads, calls, and shared spaces run as one connected product surface.',
  },
  {
    icon: Shield,
    title: 'Ownership-first architecture',
    description:
      'Control branding, moderation rules, release pace, and operational policies without platform lock-in.',
  },
  {
    icon: CloudCog,
    title: 'Infrastructure-ready by design',
    description:
      'Your backend stack can plug in directly, including custom services and model compute workflows.',
  },
  {
    icon: Lock,
    title: 'Private distribution control',
    description:
      'Host desktop installer packages and metadata on your domain with an updater path you manage.',
  },
  {
    icon: Gauge,
    title: 'Performance-aware frontend',
    description:
      'Route-level code splitting and targeted runtime loading keep startup lightweight and responsive.',
  },
  {
    icon: Layers,
    title: 'Brand-consistent client shell',
    description:
      'A dedicated visual system keeps website, desktop experience, and updater identity aligned.',
  },
];

const OPERATOR_STEPS: OperatorStep[] = [
  {
    title: 'Ship a version',
    detail:
      'Increment version metadata, build the installer, and publish release notes in a single pipeline.',
  },
  {
    title: 'Sync update feed',
    detail:
      'Publish latest.yml plus installer artifacts under /updates so desktop clients auto-resolve the newest build.',
  },
  {
    title: 'Deploy website + release cards',
    detail:
      'Website and update feed stay aligned so users see the same version in-app and on the public landing page.',
  },
  {
    title: 'Own operational cadence',
    detail:
      'Roll out fast patches or larger milestones on your timeline, without waiting on third-party app stores.',
  },
];

const COMPARE_ROWS: CompareRow[] = [
  {
    capability: 'Routing-aware call continuity',
    ncore: 'Calls and call indicators are integrated with your app routing model.',
    alternatives: 'Generic chat apps do not usually align voice sessions with your custom product flows.',
  },
  {
    capability: 'Learning + community integration',
    ncore: 'Structured learning and communication are built into one stack.',
    alternatives: 'Often requires external tools and fragmented workflows.',
  },
  {
    capability: 'Release and distribution control',
    ncore: 'Installer packaging, feed hosting, and changelog delivery stay in your control.',
    alternatives: 'Distribution is controlled by third-party platform release channels.',
  },
  {
    capability: 'Backend compute extensibility',
    ncore: 'Designed to integrate with your own backend and model infrastructure.',
    alternatives: 'Limited first-party path for custom runtime integration in-app.',
  },
  {
    capability: 'Brand and UX ownership',
    ncore: 'Website, app shell, and update surface can all follow your product identity.',
    alternatives: 'Core brand language and UX are platform-defined.',
  },
];

const ROLLOUT_COMING_SOON = [
  'Public rollout checklist for the next release wave is being finalized.',
  'Installer feed remains available at /updates on this domain.',
  'Desktop app default update URL remains https://ncore.nyptidindustries.com/updates.',
  'Changelog cards and release metadata are now synced from your release pipeline.',
];

export function LandingPage() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [latestInstallerHref, setLatestInstallerHref] = useState('');
  const [mobileApkHref, setMobileApkHref] = useState('');
  const [mobileInstallHint, setMobileInstallHint] = useState('');
  const appLogoUrl = `${import.meta.env.BASE_URL}NCore.jpg`;
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

  const desktopInstallerName = `NCore Setup ${buildVersion}.exe`;
  const desktopInstallerBlockmapName = `${desktopInstallerName}.blockmap`;
  const desktopInstallerHref = `/updates/${encodeURIComponent(desktopInstallerName)}`;
  const resolvedInstallerHref = latestInstallerHref || desktopInstallerHref;
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
        : 'Install NCore (Web App)'
      : 'Install NCore (Web App)'
    : 'Download NCore';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18);
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
      setMobileInstallHint('Android APK is not uploaded yet. Install NCore from your browser menu using Add to Home screen.');
      return;
    }

    setMobileInstallHint('Install NCore from your browser menu using Add to Home screen.');
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-surface-950 text-surface-100">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-grid" />
        <div className="absolute inset-0 bg-hero-gradient" />
        <div className="absolute -top-28 left-1/2 h-[420px] w-[980px] -translate-x-1/2 rounded-full bg-nyptid-300/10 blur-3xl" />
        <div className="absolute -left-32 top-1/3 h-[320px] w-[320px] rounded-full bg-nyptid-700/20 blur-3xl" />
        <div className="absolute -right-32 top-2/3 h-[320px] w-[320px] rounded-full bg-nyptid-500/15 blur-3xl" />
      </div>

      <nav
        className={`fixed left-0 right-0 top-0 z-50 border-b transition-all duration-300 ${
          scrolled
            ? 'border-surface-800 bg-surface-950/92 backdrop-blur-md'
            : 'border-transparent bg-transparent'
        }`}
      >
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <img
              src={appLogoUrl}
              alt="NCore"
              className="h-9 w-9 rounded-xl border border-surface-700 object-cover"
            />
            <div>
              <div className="text-lg font-black tracking-wide text-gradient">NCore</div>
              <div className="-mt-0.5 text-[11px] text-surface-500">by NYPTID Industries</div>
            </div>
          </div>

          <div className="hidden items-center gap-6 text-sm text-surface-400 md:flex">
            <a href="#platform" className="transition-colors hover:text-surface-100">Platform</a>
            <a href="#compare" className="transition-colors hover:text-surface-100">Compare</a>
            <a href="#deploy" className="transition-colors hover:text-surface-100">Deploy</a>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="nyptid-btn-secondary hidden px-4 py-2 sm:inline-flex"
            >
              Open App
            </button>
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

      <main className="relative px-6 pb-20 pt-32">
        <section className="mx-auto grid w-full max-w-7xl items-center gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-nyptid-300/30 bg-nyptid-300/10 px-4 py-1.5 text-xs font-semibold tracking-wide text-nyptid-200">
              <Sparkles size={14} />
              NCore v{buildVersion} release track
            </div>

            <h1 className="text-5xl font-black leading-tight tracking-tight md:text-6xl">
              Professional communication infrastructure
              <br />
              <span className="text-gradient">for communities that need full control.</span>
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-surface-300">
              NCore is designed for serious operators who want reliable realtime communication, private distribution,
              and brand-owned product delivery without depending on third-party platform direction.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href={primaryDownloadHref}
                className="nyptid-btn-primary px-6 py-3 text-base"
                target="_blank"
                rel="noreferrer"
                onClick={handlePrimaryDownloadClick}
              >
                {primaryDownloadLabel}
                <ArrowRight size={18} />
              </a>
              <a href="#platform" className="nyptid-btn-secondary px-6 py-3 text-base">
                Explore Platform
                <ChevronRight size={18} />
              </a>
            </div>

            {mobileInstallHint && (
              <div className="mt-4 max-w-2xl rounded-lg border border-nyptid-300/25 bg-nyptid-300/10 px-4 py-2.5 text-sm text-nyptid-100">
                {mobileInstallHint}
              </div>
            )}

            <div className="mt-8 flex flex-wrap gap-3 text-sm text-surface-400">
              <div className="inline-flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-900/80 px-3 py-2">
                <PhoneCall size={14} className="text-nyptid-300" />
                Persistent call sessions
              </div>
              <div className="inline-flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-900/80 px-3 py-2">
                <CloudCog size={14} className="text-nyptid-300" />
                RunPod backend ready
              </div>
              <div className="inline-flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-900/80 px-3 py-2">
                <Download size={14} className="text-nyptid-300" />
                Owner-hosted updater
              </div>
            </div>
          </div>

          <div className="nyptid-card relative overflow-hidden p-6 lg:p-7">
            <div className="pointer-events-none absolute inset-0 bg-card-gradient" />
            <div className="relative">
              <div className="mb-2 text-xs uppercase tracking-wider text-surface-500">Release operations</div>
              <div className="text-2xl font-black text-surface-100">NCore v{buildVersion}</div>
              <div className="mb-6 mt-1 text-sm text-surface-400">Built on {buildDate}</div>

              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <Check size={16} className="mt-0.5 flex-shrink-0 text-green-400" />
                  <p className="text-sm text-surface-300">Update feed metadata and installer artifacts are synced from one release pipeline.</p>
                </div>
                <div className="flex items-start gap-3">
                  <Check size={16} className="mt-0.5 flex-shrink-0 text-green-400" />
                  <p className="text-sm text-surface-300">Desktop updater uses /updates/latest.yml so each client resolves the newest build reliably.</p>
                </div>
                <div className="flex items-start gap-3">
                  <Check size={16} className="mt-0.5 flex-shrink-0 text-green-400" />
                  <p className="text-sm text-surface-300">Website release cards, notification entries, and installer version remain aligned per release.</p>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-surface-700 bg-surface-900 p-3">
                  <div className="text-xs text-surface-500">Default feed URL</div>
                  <div className="mt-1 text-sm font-semibold text-surface-100">/updates/latest.yml</div>
                </div>
                <div className="rounded-lg border border-surface-700 bg-surface-900 p-3">
                  <div className="text-xs text-surface-500">Installer package</div>
                  <div className="mt-1 text-sm font-semibold text-surface-100">{desktopInstallerName}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto mt-10 grid w-full max-w-7xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST_CHIPS.map((chip) => (
            <div key={chip.label} className="rounded-xl border border-surface-700 bg-surface-900/75 p-4 backdrop-blur-sm">
              <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-nyptid-300/25 bg-nyptid-300/10">
                <chip.icon size={16} className="text-nyptid-200" />
              </div>
              <div className="text-xs uppercase tracking-wide text-surface-500">{chip.label}</div>
              <div className="mt-1 text-sm font-semibold text-surface-100">{chip.value}</div>
            </div>
          ))}
        </section>

        <section id="platform" className="mx-auto mt-20 w-full max-w-7xl">
          <div className="mb-10 flex flex-wrap items-start justify-between gap-6">
            <div>
              <h2 className="text-4xl font-black text-surface-100">A full platform, not just a chat client</h2>
              <p className="mt-3 max-w-3xl text-surface-400">
                NCore is built as a product stack you operate end to end, with communication, release delivery, and
                infrastructure extensibility in one system.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-900 px-3 py-2 text-xs text-surface-500">
              <TimerReset size={14} className="text-nyptid-300" />
              Platform notes refreshed on March 20, 2026
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="grid gap-4 md:grid-cols-2">
              {FEATURE_PILLARS.map((feature) => (
                <div key={feature.title} className="nyptid-card-hover p-5">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-nyptid-300/25 bg-nyptid-300/15">
                    <feature.icon size={19} className="text-nyptid-200" />
                  </div>
                  <h3 className="text-lg font-bold text-surface-100">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-surface-400">{feature.description}</p>
                </div>
              ))}
            </div>

            <div className="nyptid-card p-6">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-nyptid-300/20 bg-nyptid-300/10 px-3 py-1.5 text-xs uppercase tracking-wider text-nyptid-200">
                <Rocket size={14} />
                Operator workflow
              </div>
              <h3 className="text-2xl font-black text-surface-100">How NCore ships clean releases</h3>
              <div className="mt-5 space-y-4">
                {OPERATOR_STEPS.map((step, index) => (
                  <div key={step.title} className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-surface-600 bg-surface-900 text-xs font-bold text-nyptid-300">
                      {index + 1}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-surface-100">{step.title}</div>
                      <p className="mt-1 text-sm leading-relaxed text-surface-400">{step.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="compare" className="mx-auto mt-20 w-full max-w-7xl rounded-2xl border border-surface-800 bg-surface-900/45 p-6">
          <div className="mb-6">
            <h2 className="text-4xl font-black text-surface-100">NCore vs generic chat platforms</h2>
            <p className="mt-3 max-w-3xl text-surface-400">
              NCore is tuned for owner-operated communities and controlled deployment, not just social chat traffic.
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-surface-700">
            <table className="w-full min-w-[760px] text-left">
              <thead className="bg-surface-900">
                <tr className="text-xs uppercase tracking-wider text-surface-500">
                  <th className="border-b border-surface-700 px-4 py-3">Capability</th>
                  <th className="border-b border-surface-700 px-4 py-3">NCore</th>
                  <th className="border-b border-surface-700 px-4 py-3">Other platforms</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row) => (
                  <tr key={row.capability} className="border-b border-surface-800/70 last:border-0">
                    <td className="px-4 py-4 text-sm font-semibold text-surface-200">{row.capability}</td>
                    <td className="px-4 py-4 text-sm text-surface-300">{row.ncore}</td>
                    <td className="px-4 py-4 text-sm text-surface-400">{row.alternatives}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="deploy" className="mx-auto mt-20 grid w-full max-w-7xl gap-6 lg:grid-cols-2">
          <div className="nyptid-card p-6">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-nyptid-300/20 bg-nyptid-300/10 px-3 py-1.5 text-xs uppercase tracking-wider text-nyptid-200">
              <Shield size={14} />
              Domain rollout
            </div>
            <div className="mb-3 inline-flex items-center rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-1 text-[11px] font-semibold text-yellow-300">
              Coming soon
            </div>
            <h3 className="mb-4 text-2xl font-black text-surface-100">Public rollout guide is being finalized</h3>
            <div className="space-y-3">
              {ROLLOUT_COMING_SOON.map((item, index) => (
                <div key={item} className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-surface-700 bg-surface-800 text-xs font-bold text-nyptid-300">
                    {index + 1}
                  </div>
                  <p className="text-sm leading-relaxed text-surface-300">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="nyptid-card p-6">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-nyptid-300/20 bg-nyptid-300/10 px-3 py-1.5 text-xs uppercase tracking-wider text-nyptid-200">
              <MessageSquare size={14} />
              Update feed
            </div>
            <h3 className="mb-4 text-2xl font-black text-surface-100">Expected /updates structure</h3>
            <pre className="overflow-auto rounded-lg border border-surface-700 bg-surface-900 p-4 text-xs text-surface-300">{`/updates/latest.yml
/updates/${desktopInstallerName}
/updates/${desktopInstallerBlockmapName}`}</pre>
            <p className="mt-4 text-sm leading-relaxed text-surface-400">
              Keep release files in sync per version bump. Default desktop update URL:
              <br />
              <code className="text-nyptid-200">https://ncore.nyptidindustries.com/updates</code>
            </p>
          </div>
        </section>

        <section className="mx-auto mt-20 w-full max-w-7xl">
          <div className="rounded-2xl border border-nyptid-300/20 bg-gradient-to-br from-nyptid-900/35 via-surface-900 to-surface-900 p-8 md:p-10">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-3xl font-black text-surface-100">Ready to ship NCore professionally</h3>
                <p className="mt-2 max-w-2xl text-surface-300">
                  Launch your website, publish installers to your own feed, and keep every client aligned to the same release track.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a
                  href={primaryDownloadHref}
                  className="nyptid-btn-primary px-6 py-3"
                  target="_blank"
                  rel="noreferrer"
                  onClick={handlePrimaryDownloadClick}
                >
                  {primaryDownloadLabel}
                  <ArrowRight size={18} />
                </a>
                <button type="button" className="nyptid-btn-secondary px-6 py-3" onClick={() => navigate('/login')}>
                  Open App
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative border-t border-surface-800 px-6 py-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-4 text-sm text-surface-500 md:flex-row">
          <div className="flex items-center gap-2">
            <img
              src={appLogoUrl}
              alt="NCore"
              className="h-7 w-7 rounded-md object-cover"
            />
            <span>NCore by NYPTID Industries Advanced Technologies</span>
          </div>
          <div className="text-xs text-surface-600">Build v{buildVersion}</div>
        </div>
      </footer>
    </div>
  );
}
