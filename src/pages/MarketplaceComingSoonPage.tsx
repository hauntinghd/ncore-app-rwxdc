import { Clock3, Sparkles } from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';

export default function MarketplaceComingSoonPage() {
  return (
    <AppShell showChannelSidebar={false} title="Marketplace">
      <main className="flex min-h-full items-center justify-center px-6 py-16">
        <section className="max-w-xl rounded-[28px] border border-nyptid-400/25 bg-surface-900/90 p-9 text-center shadow-2xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-nyptid-400/15 text-nyptid-200"><Sparkles size={30} /></div>
          <div className="mt-6 text-xs font-bold uppercase tracking-[0.28em] text-nyptid-200">NCore Marketplace</div>
          <h1 className="mt-3 text-3xl font-black text-surface-100">Coming soon</h1>
          <p className="mt-4 leading-7 text-surface-400">We are hardening payments, seller verification, delivery, and dispute protection before anyone can buy or sell here.</p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-surface-700 bg-surface-950 px-4 py-2 text-sm text-surface-300"><Clock3 size={16} />No listings or payments are live yet.</div>
        </section>
      </main>
    </AppShell>
  );
}
