import { Headphones } from 'lucide-react';

/**
 * Deafen toggle icon: a headset, struck through when deafened — the same
 * visual language as Discord. lucide ships no "HeadphoneOff", so the slash is
 * drawn here; it uses currentColor so callers' red/neutral tones still apply.
 */
export function DeafenIcon({ deafened, size = 16 }: { deafened: boolean; size?: number }) {
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }} aria-hidden="true">
      <Headphones size={size} />
      {deafened && (
        <svg
          viewBox="0 0 24 24"
          width={size}
          height={size}
          className="absolute inset-0"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinecap="round"
        >
          <line x1="3" y1="3" x2="21" y2="21" />
        </svg>
      )}
    </span>
  );
}
