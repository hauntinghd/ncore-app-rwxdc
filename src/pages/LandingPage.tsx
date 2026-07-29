import { useEffect, useMemo, useState } from 'react';
import type { ElementType, MouseEvent } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Command,
  Cpu,
  Download,
  Globe2,
  Layers3,
  MessageSquare,
  PhoneCall,
  Radar,
  Server,
  ShieldCheck,
  Sparkles,
  Store,
  Workflow,
  Zap,
} from 'lucide-react';
import {
  DEFAULT_UPDATE_FEED_URL,
  fetchLatestNativeDesktopInstaller,
  fetchLatestMobileInstaller,
} from '../lib/releaseFeed';
import { promptPwaInstall, usePwaRuntime } from '../lib/pwaRuntime';
import { resolveSurfaceUrl } from '../lib/webSurface';

interface ProofChip {
  label: string;
  detail: string;
}

interface CommandLayer {
  icon: ElementType;
  title: string;
  detail: string;
}

interface DifferenceCard {
  title: string;
  pain: string;
  upgrade: string;
}

interface SurfaceCard {
  title: string;
  eyebrow: string;
  detail: string;
  cta: string;
  href: string;
  icon: ElementType;
}

const HERO_PROOF: ProofChip[] = [
  {
    label: 'Owned release path',
    detail: 'Desktop installers, web deploys, and update feeds live on infrastructure you control.',
  },
  {
    label: 'One command layer',
    detail: 'Messaging, calls, communities, discover, and status all move inside one product shell.',
  },
  {
    label: 'Built by NYPTID',
    detail: 'NCore is not a white-labeled community clone. It is your stack, your brand, your direction.',
  },
];

const COMMAND_LAYERS: CommandLayer[] = [
  {
    icon: MessageSquare,
    title: 'Realtime messaging',
    detail: 'Direct messages, live thread state, typing presence, and community chat without route staleness.',
  },
  {
    icon: PhoneCall,
    title: 'Voice and calls',
    detail: 'Voice surfaces are integrated into the same identity, notification, and presence model.',
  },
  {
    icon: Server,
    title: 'Community operations',
    detail: 'Roles, onboarding, discovery, safety rails, and server administration belong in the same runtime.',
  },
  {
    icon: ShieldCheck,
    title: 'Trust and moderation',
    detail: 'NCore is positioned to grow beyond generic chat by making moderation and trust first-class surfaces.',
  },
  {
    icon: Workflow,
    title: 'Growth and launch rails',
    detail: 'Discovery, marketplace, and campaign surfaces can sit beside communication instead of outside it.',
  },
  {
    icon: Cpu,
    title: 'Owned distribution',
    detail: 'You decide how fast to ship, how to patch, and how to route people into the right experience.',
  },
];

const DIFFERENCE_CARDS: DifferenceCard[] = [
  {
    title: 'Stop renting your community surface',
    pain: 'Discord gives you reach, but it also gives you their constraints, their priorities, and their ceiling.',
    upgrade: 'NCore keeps the realtime experience while letting NYPTID own the product, the routes, and the release stack.',
  },
  {
    title: 'Make operations visible',
    pain: 'Generic chat apps bury moderation, onboarding, discovery, and platform control behind scattered tools.',
    upgrade: 'NCore puts community operations next to messaging instead of pretending they are separate products.',
  },
  {
    title: 'Ship like a software company',
    pain: 'When the stack is fragmented, every update becomes a coordination problem across platforms and vendors.',
    upgrade: 'NCore is built so desktop, web, PWA, and future product surfaces can ship on one controlled cadence.',
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

  // The Tauri update feed is the single source of truth for the native client.
  // Keep a versioned direct fallback for first-time visitors if the feed check
  // is temporarily unavailable.
  const desktopInstallerName = `NCore_${buildVersion}_x64-setup.exe`;
  const desktopInstallerFallbackHref = `/updates/tauri/${encodeURIComponent(desktopInstallerName)}`;
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
    : 'Download Desktop';

  const launchSurfaces: SurfaceCard[] = useMemo(
    () => [
      {
        title: 'NCore Web App',
        eyebrow: 'Primary realtime surface',
        detail: 'Jump straight into messaging, calls, communities, settings, and the growing command layer.',
        cta: 'Open Web App',
        href: appHref,
        icon: Globe2,
      },
      {
        title: 'NCore Desktop',
        eyebrow: 'Owned installer + updater',
        detail: 'Desktop builds ship on your timeline with release metadata, feeds, and distribution under your control.',
        cta: primaryDownloadLabel,
        href: primaryDownloadHref,
        icon: Download,
      },
      {
        title: 'NCore Marketplace',
        eyebrow: 'Separate web property',
        detail: 'A dedicated surface for commerce, offers, and future operator workflows at the correct live domain.',
        cta: 'Open Marketplace',
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
        const installer = await fetchLatestNativeDesktopInstaller(localFeedBase);
        if (!installer?.url || cancelled) return;
        setLatestInstallerHref(installer.url);
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
      setMobileInstallHint('Android APK is not uploaded yet. Install NCore from your browser menu with Add to Home Screen.');
      return;
    }

    setMobileInstallHint('Install NCore from your browser menu with Add to Home Screen.');
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#070917] text-[#f5f7ff]">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_9%_8%,rgba(65,221,202,0.18),transparent_34%),radial-gradient(circle_at_88%_10%,rgba(119,107,255,0.2),transparent_34%),radial-gradient(circle_at_52%_88%,rgba(242,96,164,0.13),transparent_44%),linear-gradient(180deg,#0b1023_0%,#070917_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:48px_48px] opacity-40" />
        <div className="absolute left-[-12rem] top-20 h-[28rem] w-[28rem] rounded-full bg-[#35d6c5]/12 blur-3xl" />
        <div className="absolute right-[-10rem] top-24 h-[26rem] w-[26rem] rounded-full bg-[#7467ff]/20 blur-3xl" />
      </div>

      <nav
        className={`fixed left-0 right-0 top-0 z-50 border-b transition-all duration-300 ${
          scrolled
            ? 'border-white/8 bg-[#090d14]/84 backdrop-blur-xl'
            : 'border-transparent bg-transparent'
        }`}
      >
        <div className="mx-auto flex w-full max-w-[1380px] items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <a href="/" className="flex items-center gap-3">
            <img
              src={`${import.meta.env.BASE_URL}ncore-logo.svg`}
              alt="NCore"
              className="h-10 w-10 rounded-2xl border border-white/10 object-cover shadow-[0_14px_30px_rgba(0,0,0,0.35)]"
            />
            <div>
              <div className="text-lg font-black tracking-[0.08em] text-white">NCore</div>
              <div className="text-[11px] uppercase tracking-[0.26em] text-white/45">NYPTID Industries</div>
            </div>
          </a>

          <div className="hidden items-center gap-7 text-sm font-medium text-white/68 lg:flex">
            <a href="#why-ncore" className="transition-colors hover:text-white">Why NCore</a>
            <a href="#command-layer" className="transition-colors hover:text-white">Command Layer</a>
            <a href="#surfaces" className="transition-colors hover:text-white">Launch Surfaces</a>
          </div>

          <div className="flex items-center gap-2">
            <a href={appHref} className="nyptid-btn-secondary hidden px-4 py-2 sm:inline-flex">
              Open App
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

      <main className="relative z-10 px-5 pb-24 pt-28 lg:px-8 lg:pt-32">
        <section className="mx-auto grid w-full max-w-[1380px] gap-8 lg:grid-cols-[1.06fr_0.94fr] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#41ddca]/30 bg-[#102139]/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#82f5df]">
              <Sparkles size={13} />
              Built by NYPTID Industries Advanced Technologies
            </div>

            <h1 className="mt-6 max-w-4xl font-black leading-[0.94] tracking-[-0.05em] text-white text-[3.4rem] sm:text-[4.2rem] lg:text-[5.8rem]">
              The command layer for communities that outgrow Discord.
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-7 text-white/72 sm:text-lg">
              NCore is where messaging, calls, discover, moderation, identity, and owned distribution collapse into one
              product stack. It is built for operators who want to control the surface, not rent it.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a href={appHref} className="nyptid-btn-primary px-6 py-3 text-base">
                Enter NCore
                <ArrowRight size={18} />
              </a>
              <a href="#surfaces" className="nyptid-btn-secondary px-6 py-3 text-base">
                View Launch Surfaces
                <ChevronRight size={18} />
              </a>
            </div>

            {mobileInstallHint && (
              <div className="mt-4 max-w-2xl rounded-2xl border border-[#8f6a2b]/45 bg-[#34240f]/78 px-4 py-3 text-sm text-[#f8d48c]">
                {mobileInstallHint}
              </div>
            )}

            <div className="mt-8 grid gap-3 md:grid-cols-3">
              {HERO_PROOF.map((item) => (
                <div
                  key={item.label}
                  className="rounded-[24px] border border-white/8 bg-white/[0.04] px-4 py-4 shadow-[0_24px_60px_rgba(0,0,0,0.22)] backdrop-blur"
                >
                  <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-[#82f5df]">{item.label}</div>
                  <div className="mt-2 text-sm leading-6 text-white/72">{item.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-x-10 top-8 h-48 rounded-full bg-[#41ddca]/18 blur-3xl" />
            <div className="absolute right-0 top-24 h-40 w-40 rounded-full bg-[#776bff]/20 blur-3xl" />

            <div className="relative overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(160deg,rgba(11,20,41,0.94),rgba(22,24,58,0.92)_36%,rgba(40,14,52,0.92)_100%)] p-5 shadow-[0_36px_120px_rgba(0,0,0,0.45)] lg:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#82f5df]">NCore Command Stack</div>
                  <div className="mt-2 text-2xl font-black text-white">One runtime. Multiple surfaces.</div>
                </div>
                <div className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-200">
                  Live
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
                <div className="space-y-3">
                  {[
                    {
                      title: 'Messaging and state',
                      detail: 'Realtime threads, presence, typing, notifications, and route-aware refresh paths.',
                    },
                    {
                      title: 'Community control',
                      detail: 'Server structure, onboarding, permissions, moderation, and profile context.',
                    },
                    {
                      title: 'Distribution',
                      detail: `Desktop build ${buildVersion} with owned installer path and versioned update feed.`,
                    },
                  ].map((row, index) => (
                    <div
                      key={row.title}
                      className={`rounded-[24px] border px-4 py-4 ${
                        index === 0
                          ? 'border-[#41ddca]/28 bg-[#102139]/78'
                          : 'border-white/8 bg-white/[0.04]'
                      }`}
                    >
                      <div className="flex items-center gap-2 text-sm font-semibold text-white">
                        <CheckCircle2 size={15} className={index === 0 ? 'text-[#82f5df]' : 'text-emerald-300'} />
                        {row.title}
                      </div>
                      <div className="mt-2 text-sm leading-6 text-white/68">{row.detail}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded-[28px] border border-white/8 bg-[#0d121b]/92 p-4">
                  <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-4">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.24em] text-white/42">Operator panel</div>
                      <div className="mt-1 text-xl font-black text-white">Product advantage</div>
                    </div>
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[#776bff]/30 bg-[#1b1945]/90">
                      <Command size={18} className="text-[#b5adff]" />
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {[
                      ['Messaging shell', 'DMs, communities, and call routes share the same identity model.'],
                      ['Discovery and growth', 'Discovery is treated like a product surface, not a random tab.'],
                      ['Status and presence', 'Status, custom status, and presence belong across every surface.'],
                      ['Owned updates', `Release build stamped ${buildDate}. Feed base: ${DEFAULT_UPDATE_FEED_URL}`],
                    ].map(([title, body]) => (
                      <div key={title} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-white">{title}</div>
                          <div className="flex gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-emerald-300 animate-pulse" />
                            <span className="h-2 w-2 rounded-full bg-[#82f5df] animate-pulse [animation-delay:180ms]" />
                            <span className="h-2 w-2 rounded-full bg-[#5876e4] animate-pulse [animation-delay:360ms]" />
                          </div>
                        </div>
                        <div className="mt-2 text-sm leading-6 text-white/64">{body}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="why-ncore"
          className="landing-deferred-section mx-auto mt-20 grid w-full max-w-[1380px] gap-6 rounded-[36px] border border-white/8 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] px-5 py-6 shadow-[0_24px_100px_rgba(0,0,0,0.24)] lg:grid-cols-[0.92fr_1.08fr] lg:px-7 lg:py-7"
        >
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-white/62">
              <Radar size={13} />
              Why NCore exists
            </div>
            <div className="mt-4 max-w-xl text-4xl font-black leading-tight text-white">
              A serious community product needs more than chat bubbles.
            </div>
            <p className="mt-4 max-w-xl text-sm leading-7 text-white/68 sm:text-base">
              Discord is the benchmark for familiarity. NCore should be the upgrade path for control. That means better
              operations, tighter product identity, faster iteration, and infrastructure you own instead of borrow.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {DIFFERENCE_CARDS.map((card, index) => (
              <div
                key={card.title}
                className={`rounded-[28px] border px-5 py-5 ${
                  index === 1
                    ? 'border-[#776bff]/28 bg-[#171c42]/76'
                    : 'border-white/8 bg-white/[0.04]'
                }`}
              >
                <div className="text-lg font-black text-white">{card.title}</div>
                <div className="mt-3 text-sm leading-6 text-white/58">{card.pain}</div>
                <div className="mt-4 rounded-2xl border border-emerald-400/18 bg-emerald-400/8 px-4 py-4 text-sm leading-6 text-emerald-50/90">
                  {card.upgrade}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="command-layer" className="landing-deferred-section mx-auto mt-20 w-full max-w-[1380px]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-white/62">
                <Layers3 size={13} />
                Command Layer
              </div>
              <div className="mt-4 max-w-3xl text-4xl font-black leading-tight text-white">
                Everything that should make NCore better than Discord has to ship inside the same stack.
              </div>
            </div>

            <div className="rounded-[24px] border border-white/8 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/62">
              The bar is simple: every core surface should feel intentional, connected, and ready to scale.
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {COMMAND_LAYERS.map((layer) => (
              <div
                key={layer.title}
                className="group rounded-[28px] border border-white/8 bg-[linear-gradient(160deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-5 transition-transform duration-300 hover:-translate-y-1"
              >
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-[#120d08]">
                  <layer.icon size={18} className="text-[#82f5df]" />
                </div>
                <div className="mt-4 text-xl font-black text-white">{layer.title}</div>
                <div className="mt-3 text-sm leading-7 text-white/66">{layer.detail}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-deferred-section mx-auto mt-20 w-full max-w-[1380px]">
          <div className="grid gap-4 lg:grid-cols-[0.92fr_1.08fr]">
            <div className="rounded-[32px] border border-white/8 bg-[linear-gradient(145deg,rgba(18,45,63,0.82),rgba(20,17,54,0.94))] p-6">
              <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#82f5df]">Execution Rail</div>
              <div className="mt-4 text-3xl font-black text-white">
                Web, desktop, and marketplace should feel like one machine.
              </div>
              <div className="mt-4 text-sm leading-7 text-white/68">
                The website cannot look like an engineering note. It has to sell the product, set the tone, and route
                people cleanly into the right surface. That is the standard this page is now built for.
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {[
                {
                  icon: Globe2,
                  title: 'Marketing',
                  detail: 'Position the product clearly and route visitors without confusing domain handoffs.',
                },
                {
                  icon: Download,
                  title: 'Desktop',
                  detail: 'Deliver the current build immediately with a real updater path and clean release framing.',
                },
                {
                  icon: Store,
                  title: 'Marketplace',
                  detail: 'Keep the external commerce surface reachable on the actual live domain, not stale copy.',
                },
              ].map((item) => (
                <div key={item.title} className="rounded-[28px] border border-white/8 bg-white/[0.04] p-5">
                  <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
                    <item.icon size={18} className="text-[#82f5df]" />
                  </div>
                  <div className="mt-4 text-xl font-black text-white">{item.title}</div>
                  <div className="mt-3 text-sm leading-7 text-white/64">{item.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="surfaces" className="landing-deferred-section mx-auto mt-20 w-full max-w-[1380px]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-white/62">
                <Zap size={13} />
                Launch Surfaces
              </div>
              <div className="mt-4 text-4xl font-black text-white">Choose where to enter NCore.</div>
            </div>

            <div className="text-sm text-white/56">
              Current build: <span className="font-semibold text-white/78">v{buildVersion}</span>
            </div>
          </div>

          <div className="mt-8 grid gap-4 xl:grid-cols-3">
            {launchSurfaces.map((surface, index) => (
              <div
                key={surface.title}
                className={`overflow-hidden rounded-[30px] border shadow-[0_20px_80px_rgba(0,0,0,0.28)] ${
                  index === 1
                    ? 'border-[#776bff]/28 bg-[linear-gradient(160deg,rgba(28,31,78,0.86),rgba(14,18,45,0.96))]'
                    : 'border-white/8 bg-[linear-gradient(160deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))]'
                }`}
              >
                <div className="border-b border-white/8 px-5 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-white/52">{surface.eyebrow}</div>
                      <div className="mt-3 text-3xl font-black text-white">{surface.title}</div>
                    </div>
                    <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
                      <surface.icon size={19} className="text-[#82f5df]" />
                    </div>
                  </div>
                </div>

                <div className="p-5">
                  <div className="min-h-[6.5rem] text-sm leading-7 text-white/68">{surface.detail}</div>
                  <a
                    href={surface.href}
                    className="nyptid-btn-primary mt-5 w-full px-4 py-3"
                    target={surface.href.startsWith('http') ? '_blank' : undefined}
                    rel={surface.href.startsWith('http') ? 'noreferrer' : undefined}
                    onClick={surface.title === 'NCore Desktop' ? handlePrimaryDownloadClick : undefined}
                  >
                    {surface.cta}
                    <ArrowRight size={16} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-deferred-section mx-auto mt-20 w-full max-w-[1380px]">
          <div className="overflow-hidden rounded-[36px] border border-white/8 bg-[linear-gradient(135deg,rgba(65,221,202,0.14),rgba(255,255,255,0.03)_24%,rgba(119,107,255,0.18)_100%)] px-6 py-8 lg:px-8 lg:py-10">
            <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#f0c87d]">Next Phase</div>
                <div className="mt-4 max-w-3xl text-4xl font-black leading-tight text-white">
                  NCore should feel like a finished product company, not a promising prototype.
                </div>
                <div className="mt-4 max-w-2xl text-sm leading-7 text-white/68 sm:text-base">
                  This site now sells the right story. The next step is to keep eliminating unfinished flows inside the
                  app until the product quality matches the positioning.
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                <a href={appHref} className="nyptid-btn-primary px-6 py-3">
                  Open NCore
                  <ArrowRight size={18} />
                </a>
                <a
                  href={primaryDownloadHref}
                  className="nyptid-btn-secondary px-6 py-3"
                  target="_blank"
                  rel="noreferrer"
                  onClick={handlePrimaryDownloadClick}
                >
                  Download Desktop
                  <Download size={18} />
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/8 px-5 py-8 lg:px-8">
        <div className="mx-auto flex w-full max-w-[1380px] flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3 text-sm text-white/56">
            <img
              src={`${import.meta.env.BASE_URL}ncore-logo.svg`}
              loading="lazy"
              decoding="async"
              alt="NCore"
              className="h-8 w-8 rounded-xl border border-white/10 object-cover"
            />
            NCore by NYPTID Industries Advanced Technologies
          </div>
          <div className="text-xs uppercase tracking-[0.22em] text-white/38">Build {buildVersion}</div>
        </div>
      </footer>
    </div>
  );
}
