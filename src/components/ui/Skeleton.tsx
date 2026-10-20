import type { CSSProperties } from 'react';

export interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
  rounded?: 'sm' | 'md' | 'lg' | 'full';
}

/**
 * Base skeleton block. Shimmer animation is CSS-only (`animate-pulse`) and
 * respects `prefers-reduced-motion` via the existing media query in index.css.
 */
export function Skeleton({ className, style, rounded = 'md' }: SkeletonProps) {
  const radius = rounded === 'full'
    ? 'rounded-full'
    : rounded === 'lg'
      ? 'rounded-xl'
      : rounded === 'sm'
        ? 'rounded-sm'
        : 'rounded-md';
  return (
    <div
      aria-hidden="true"
      className={`bg-surface-700/60 ${radius} animate-pulse ${className || ''}`}
      style={style}
    />
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className || ''}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: `${100 - (i * 12)}%` }}
        />
      ))}
    </div>
  );
}

/**
 * Avatar + name + subtitle row. Matches the shape of a friends / DM list row
 * so replacing a spinner with this feels instant.
 */
export function SkeletonUserRow() {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <Skeleton className="h-10 w-10" rounded="full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
    </div>
  );
}

/**
 * Card-shaped skeleton for a profile header. Avatar + name + bio block.
 */
export function SkeletonProfileHeader() {
  return (
    <div className="nyptid-card p-5">
      <div className="flex items-center gap-4">
        <Skeleton className="h-20 w-20" rounded="full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="h-3 w-1/4" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
    </div>
  );
}

/**
 * A message row skeleton — avatar + 2 message lines — so loading ChatPage
 * doesn't read as empty while messages fetch.
 */
export function SkeletonMessageRow({ lines = 2 }: { lines?: number }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2">
      <Skeleton className="h-9 w-9" rounded="full" />
      <div className="flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-2 w-14" />
        </div>
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-3"
            style={{ width: `${92 - i * 18}%` }}
          />
        ))}
      </div>
    </div>
  );
}
