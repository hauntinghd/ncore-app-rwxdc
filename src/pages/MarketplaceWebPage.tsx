import { useMemo } from 'react';
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Download,
  Gavel,
  ShieldCheck,
  Sparkles,
  Store,
  Wallet,
} from 'lucide-react';
import { resolveSurfaceUrl } from '../lib/webSurface';

interface CapabilityCard {
  title: string;
  detail: string;
}

const QUICKDRAW_CAPABILITIES: CapabilityCard[] = [
  {
    title: 'Contract Grid with briefing rails',
    detail: 'A specialist-first workflow with Terms, Tier II clearance, and operation protocol briefings inline.',
  },
  {
    title: 'Deploy flow with escrow controls',
    detail: 'Issue contracts from a dedicated modal flow with capital checks, timeline logic, and funded-state gating.',
  },
  {
    title: 'Ops-grade dispute coverage',
    detail: 'Order lifecycle, dispute pathing, and settlement controls are visible for both hiring and specialist views.',
  },
];

const GAMESTORE_CAPABILITIES: CapabilityCard[] = [
  {
    title: 'Steam-style storefront direction',
    detail: 'Large-card presentation, category rails, trending shelves, and direct purchase-to-download continuity.',
  },
  {
    title: 'Installer-ready order history',
    detail: 'Approved game purchases expose installer payloads directly so customers can reinstall without manual support.',
  },
  {
    title: 'Publisher operations lane',
    detail: 'Publishing flow keeps listing, provenance checks, and payout policy visible before go-live.',
  },
];

const TRUST_POINTS = [
  'Escrow-backed order execution',
  'Role-aware buyer vs specialist views',
  'Moderation and dispute controls',
  'Direct installer distribution support',
];

export function MarketplaceWebPage() {
  const appMarketplaceHref = useMemo(() => resolveSurfaceUrl('app', '/app/marketplace'), []);
  const appLoginHref = useMemo(() => resolveSurfaceUrl('app', '/login'), []);
  const mainSiteHref = useMemo(() => resolveSurfaceUrl('marketing', '/'), []);
  const installerHref = useMemo(() => resolveSurfaceUrl('marketing', '/updates/latest.yml'), []);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#030c18] text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_-5%,rgba(55,132,224,0.2),transparent_44%),radial-gradient(circle_at_82%_5%,rgba(36,188,147,0.14),transparent_43%),linear-gradient(180deg,#020914_0%,#041226_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(137,188,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(137,188,255,0.06)_1px,transparent_1px)] bg-[size:38px_38px] opacity-40" />
      </div>

      <nav className="relative z-10 border-b border-[#193556] bg-[#031224]/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#3e6b9c] bg-[#0d243e]">
              <Store size={18} className="text-[#8ab6e8]" />
            </div>
            <div>
              <div className="text-base font-extrabold tracking-wide text-white">NCore Market</div>
              <div className="text-xs text-slate-400">QuickDraw + Game Distribution Surface</div>
            </div>
          </div>

          <div className="hidden items-center gap-6 text-sm text-slate-300 md:flex">
            <a href="#quickdraw" className="transition-colors hover:text-white">QuickDraw</a>
            <a href="#gamestore" className="transition-colors hover:text-white">Game Store</a>
            <a href="#launch" className="transition-colors hover:text-white">Launch Path</a>
          </div>

          <div className="flex items-center gap-2">
            <a href={mainSiteHref} className="nyptid-btn-secondary px-4 py-2">
              NCore Site
            </a>
            <a href={appLoginHref} className="nyptid-btn-primary px-4 py-2">
              Open App
            </a>
          </div>
        </div>
      </nav>

      <main className="relative z-10 px-6 pb-20 pt-14">
        <section className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#2c5278] bg-[#112842] px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[#9ac4f0]">
              <Sparkles size={14} />
              Marketplace web architecture
            </div>

            <h1 className="text-5xl font-black leading-tight tracking-tight text-white md:text-6xl">
              Build a true dual-surface marketplace
              <br />
              <span className="text-[#7edbb8]">for hiring talent and shipping games.</span>
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">
              NCore Market is designed as its own web property so QuickDraw operations and game distribution can evolve
              faster than the main communication shell while still sharing the same account and billing core.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a href={appMarketplaceHref} className="nyptid-btn-primary px-6 py-3 text-base">
                Enter NCore Market
                <ArrowRight size={18} />
              </a>
              <a href={installerHref} className="nyptid-btn-secondary px-6 py-3 text-base">
                Release Feed
                <Download size={16} />
              </a>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {TRUST_POINTS.map((point) => (
                <div
                  key={point}
                  className="flex items-center gap-2 rounded-xl border border-[#2a4567] bg-[#0d223a]/90 px-4 py-3 text-sm text-slate-200"
                >
                  <CheckCircle2 size={15} className="text-[#4dd29d]" />
                  {point}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#325579] bg-[linear-gradient(165deg,rgba(19,46,74,0.92)_0%,rgba(7,21,39,0.95)_70%)] p-6">
            <div className="mb-5 text-xs uppercase tracking-[0.12em] text-slate-400">Operating surfaces</div>
            <div className="space-y-4">
              <div className="rounded-xl border border-[#31557a] bg-[#0f2741] p-4">
                <div className="mb-1 flex items-center gap-2 text-base font-bold text-white">
                  <Briefcase size={16} className="text-[#8ab6e8]" />
                  QuickDraw Services
                </div>
                <p className="text-sm text-slate-300">
                  Specialist hiring with deploy flow, escrow-backed contracts, and briefing-first onboarding.
                </p>
              </div>
              <div className="rounded-xl border border-[#31557a] bg-[#0f2741] p-4">
                <div className="mb-1 flex items-center gap-2 text-base font-bold text-white">
                  <Store size={16} className="text-[#8ab6e8]" />
                  Buy and Sell Games
                </div>
                <p className="text-sm text-slate-300">
                  Steam-inspired storefront with polished discovery shelves and direct installer delivery after purchase.
                </p>
              </div>
              <div className="rounded-xl border border-[#31557a] bg-[#0f2741] p-4">
                <div className="mb-1 flex items-center gap-2 text-base font-bold text-white">
                  <Wallet size={16} className="text-[#8ab6e8]" />
                  Billing + Payout Backbone
                </div>
                <p className="text-sm text-slate-300">
                  Unified account ledger with Stripe-backed payout routing for creators and service specialists.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="quickdraw" className="mx-auto mt-20 w-full max-w-7xl">
          <div className="mb-8 flex items-center gap-3">
            <div className="h-9 w-1.5 rounded-full bg-[#4dd29d]" />
            <div>
              <h2 className="text-3xl font-black text-white">QuickDraw Service Command</h2>
              <p className="text-slate-400">TRW-inspired control room feel, adapted to NCore language and workflows.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {QUICKDRAW_CAPABILITIES.map((card) => (
              <div key={card.title} className="rounded-2xl border border-[#2a4668] bg-[#0a1f36]/92 p-5">
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#40658d] bg-[#122f4d]">
                  <ShieldCheck size={16} className="text-[#88b5e8]" />
                </div>
                <h3 className="text-lg font-bold text-white">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{card.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="gamestore" className="mx-auto mt-20 w-full max-w-7xl">
          <div className="mb-8 flex items-center gap-3">
            <div className="h-9 w-1.5 rounded-full bg-[#8ab6e8]" />
            <div>
              <h2 className="text-3xl font-black text-white">Game Storefront Direction</h2>
              <p className="text-slate-400">A cleaner, more premium market shell that can compete with mainstream storefront UX.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {GAMESTORE_CAPABILITIES.map((card) => (
              <div key={card.title} className="rounded-2xl border border-[#2a4668] bg-[#0a1f36]/92 p-5">
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#40658d] bg-[#122f4d]">
                  <Gavel size={16} className="text-[#88b5e8]" />
                </div>
                <h3 className="text-lg font-bold text-white">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{card.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="launch" className="mx-auto mt-20 w-full max-w-7xl rounded-2xl border border-[#2f5275] bg-[linear-gradient(135deg,rgba(12,34,56,0.94),rgba(8,21,38,0.96))] p-8 md:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#3c6288] bg-[#112b47] px-3 py-1 text-xs uppercase tracking-[0.12em] text-[#93bce8]">
                <ChevronRight size={14} />
                Launch sequence
              </div>
              <h3 className="text-3xl font-black text-white">Ship market as a standalone web product</h3>
              <p className="mt-2 max-w-3xl text-slate-300">
                Use `ncoremarket.nyptidindustries.com` for public marketplace presentation while the app surface
                handles authenticated contracts, publishing, and purchase lifecycle actions.
              </p>
            </div>
            <a href={appMarketplaceHref} className="nyptid-btn-primary px-6 py-3 text-base">
              Launch Marketplace Surface
              <ArrowRight size={18} />
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
