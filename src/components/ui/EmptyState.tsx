import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  illustration?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, illustration, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-12 px-6 ${className || ''}`}>
      <div className="mb-5">
        {illustration ?? (Icon ? <IconHalo><Icon size={28} className="text-nyptid-200" /></IconHalo> : null)}
      </div>
      <h3 className="text-lg font-semibold text-surface-100">{title}</h3>
      {description && <p className="mt-1.5 text-sm text-surface-400 max-w-sm">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function IconHalo({ children }: { children: ReactNode }) {
  return (
    <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-nyptid-300/15 to-nyptid-400/5 border border-nyptid-300/20 flex items-center justify-center shadow-glow-sm">
      <div className="absolute inset-0 rounded-2xl bg-grid opacity-25" />
      <div className="relative">{children}</div>
    </div>
  );
}

export const EmptyIllustrations = {
  EmptyChannel: (
    <svg width="96" height="96" viewBox="0 0 96 96" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="es-chan" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f3bb52" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#c97621" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <rect x="8" y="18" width="80" height="54" rx="12" stroke="url(#es-chan)" strokeWidth="2" fill="rgba(243,187,82,0.05)" />
      <path d="M20 34 H68" stroke="#f3bb52" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      <path d="M20 46 H54" stroke="#f3bb52" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
      <path d="M20 58 H42" stroke="#f3bb52" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
      <circle cx="78" cy="60" r="8" fill="#f3bb52" opacity="0.7" />
      <path d="M75 60 l2 2 l4 -4" stroke="#150c07" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  NoFriends: (
    <svg width="96" height="96" viewBox="0 0 96 96" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="es-fr" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f3bb52" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#c97621" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <circle cx="36" cy="40" r="14" stroke="url(#es-fr)" strokeWidth="2" fill="rgba(243,187,82,0.08)" />
      <circle cx="64" cy="40" r="14" stroke="url(#es-fr)" strokeWidth="2" fill="rgba(243,187,82,0.08)" />
      <path d="M18 74 c4-10 14-14 18-14 M60 60 c4 0 14 4 18 14" stroke="url(#es-fr)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M48 50 v16 M40 58 h16" stroke="#f3bb52" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  NoDirectMessages: (
    <svg width="96" height="96" viewBox="0 0 96 96" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="es-dm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f3bb52" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#c97621" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <path d="M14 24 h52 a8 8 0 0 1 8 8 v24 a8 8 0 0 1 -8 8 H34 l-14 12 v-12 h-6 a8 8 0 0 1 -8 -8 V32 a8 8 0 0 1 8 -8 z" stroke="url(#es-dm)" strokeWidth="2" fill="rgba(243,187,82,0.06)" />
      <circle cx="30" cy="44" r="3" fill="#f3bb52" />
      <circle cx="42" cy="44" r="3" fill="#f3bb52" opacity="0.75" />
      <circle cx="54" cy="44" r="3" fill="#f3bb52" opacity="0.45" />
    </svg>
  ),
  NoResults: (
    <svg width="96" height="96" viewBox="0 0 96 96" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="es-nr" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f3bb52" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#c97621" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <circle cx="42" cy="42" r="22" stroke="url(#es-nr)" strokeWidth="3" fill="rgba(243,187,82,0.06)" />
      <path d="M59 59 l18 18" stroke="#f3bb52" strokeWidth="3" strokeLinecap="round" />
      <path d="M32 40 l8 8 l16 -16" stroke="#f3bb52" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.55" />
    </svg>
  ),
  NoCommunities: (
    <svg width="96" height="96" viewBox="0 0 96 96" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="es-co" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f3bb52" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#c97621" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <rect x="14" y="30" width="20" height="20" rx="5" stroke="url(#es-co)" strokeWidth="2" fill="rgba(243,187,82,0.07)" />
      <rect x="38" y="18" width="20" height="20" rx="5" stroke="url(#es-co)" strokeWidth="2" fill="rgba(243,187,82,0.07)" />
      <rect x="62" y="30" width="20" height="20" rx="5" stroke="url(#es-co)" strokeWidth="2" fill="rgba(243,187,82,0.07)" />
      <rect x="26" y="52" width="20" height="20" rx="5" stroke="url(#es-co)" strokeWidth="2" fill="rgba(243,187,82,0.07)" />
      <rect x="50" y="52" width="20" height="20" rx="5" stroke="url(#es-co)" strokeWidth="2" fill="rgba(243,187,82,0.07)" />
      <circle cx="48" cy="62" r="4" fill="#f3bb52" />
    </svg>
  ),
} as const;
