import { Wifi, WifiOff } from 'lucide-react';

// Agora network-quality values (same mapping as RTCNetworkQuality in rtcProvider):
//   0 = unknown, 1 = excellent, 2 = good, 3 = poor, 4 = bad, 5 = very bad, 6 = disconnected
export interface NetworkQualityBarsProps {
  uplink: number;
  downlink: number;
  rttMs?: number | null;
  compact?: boolean;
}

function qualityLabel(q: number): { label: string; tone: 'good' | 'ok' | 'warn' | 'bad' | 'unknown' } {
  if (q <= 0) return { label: 'Unknown', tone: 'unknown' };
  if (q === 1) return { label: 'Excellent', tone: 'good' };
  if (q === 2) return { label: 'Good', tone: 'good' };
  if (q === 3) return { label: 'Fair', tone: 'ok' };
  if (q === 4) return { label: 'Poor', tone: 'warn' };
  if (q === 5) return { label: 'Very poor', tone: 'bad' };
  return { label: 'Disconnected', tone: 'bad' };
}

function toneClass(tone: 'good' | 'ok' | 'warn' | 'bad' | 'unknown'): string {
  switch (tone) {
    case 'good': return 'text-emerald-300';
    case 'ok': return 'text-amber-200';
    case 'warn': return 'text-orange-300';
    case 'bad': return 'text-red-300';
    default: return 'text-surface-400';
  }
}

function barFill(bar: number, quality: number): boolean {
  if (quality <= 0 || quality >= 6) return false;
  // quality 1 (excellent) → 4 bars; 5 (very poor) → 1 bar
  const filled = Math.max(0, Math.min(4, 5 - quality));
  return bar < filled;
}

export function NetworkQualityBars({ uplink, downlink, rttMs, compact }: NetworkQualityBarsProps) {
  const worst = Math.max(uplink, downlink);
  const state = qualityLabel(worst);
  const tone = toneClass(state.tone);
  const disconnected = worst >= 6 || (uplink === 0 && downlink === 0);

  const Icon = disconnected ? WifiOff : Wifi;

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border border-surface-700 bg-surface-900/80 backdrop-blur ${compact ? 'px-2 py-1' : 'px-3 py-1.5'}`}
      title={`Up ${qualityLabel(uplink).label} · Down ${qualityLabel(downlink).label}${rttMs != null ? ` · ${Math.round(rttMs)}ms` : ''}`}
    >
      <Icon size={compact ? 12 : 14} className={tone} />
      <div className="flex items-end gap-[2px]" aria-hidden="true">
        {[0, 1, 2, 3].map((bar) => (
          <span
            key={bar}
            className={`block w-[3px] ${compact ? 'rounded-[1px]' : 'rounded-sm'} transition-colors ${barFill(bar, worst) ? tone.replace('text-', 'bg-') : 'bg-surface-700'}`}
            style={{ height: `${4 + bar * 3}px` }}
          />
        ))}
      </div>
      {!compact && (
        <span className={`text-xs font-medium ${tone}`}>
          {state.label}
          {rttMs != null && Number.isFinite(rttMs) ? ` · ${Math.round(rttMs)}ms` : ''}
        </span>
      )}
    </div>
  );
}
