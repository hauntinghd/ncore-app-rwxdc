import { formatBadgeCount } from '../../lib/readState';

interface UnreadBadgeProps {
  count: number;
  /** Mention badges stay red and always show a number; plain unread uses a dot. */
  variant?: 'mention' | 'unread';
  className?: string;
}

/**
 * Mention counts are the signal people actually act on, so they get a numeric
 * red pill. Plain unread activity gets a quiet dot — matching how the channel
 * name itself goes bold rather than shouting a number.
 */
export function UnreadBadge({ count, variant = 'mention', className = '' }: UnreadBadgeProps) {
  if (count <= 0) return null;

  if (variant === 'unread') {
    return (
      <span
        className={`inline-block h-2 w-2 flex-shrink-0 rounded-full bg-surface-100 ${className}`}
        aria-label={`${count} unread ${count === 1 ? 'message' : 'messages'}`}
      />
    );
  }

  return (
    <span
      className={`inline-flex h-[18px] min-w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold leading-none text-white ${className}`}
      aria-label={`${count} ${count === 1 ? 'mention' : 'mentions'}`}
    >
      {formatBadgeCount(count)}
    </span>
  );
}
