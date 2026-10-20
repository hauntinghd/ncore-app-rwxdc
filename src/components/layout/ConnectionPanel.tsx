import { useEffect, useRef, useState } from 'react';
import { Lock, ShieldCheck, Signal } from 'lucide-react';
import { isE2EEnabled } from '../../lib/crypto/e2eManager';

interface ConnectionPanelProps {
  averagePingMs: number | null;
  lastPingMs: number | null;
  outboundPacketLossPct: number | null;
  /** 0-6, provider scale: 0 unknown, 1 excellent, 6 disconnected. */
  uplinkQuality?: number;
  downlinkQuality?: number;
  region?: string | null;
  onClose: () => void;
}

/*
  Thresholds people can act on, taken from what actually degrades a call:
  audio delay becomes noticeable around a quarter second of round trip, and
  packets start sounding robotic once a tenth of them are missing.
*/
const PING_WARN_MS = 250;
const LOSS_WARN_PCT = 10;

/**
 * In-call connection detail.
 *
 * Deliberately the same three numbers Discord shows — average ping, last ping,
 * outbound packet loss — because they are the ones that map to what a person
 * is hearing, and someone switching over should not have to learn a new set.
 * The store has been computing all three since before this panel existed;
 * nothing was displaying them.
 */
export function ConnectionPanel({
  averagePingMs,
  lastPingMs,
  outboundPacketLossPct,
  uplinkQuality = 0,
  downlinkQuality = 0,
  region,
  onClose,
}: ConnectionPanelProps) {
  const [tab, setTab] = useState<'connection' | 'privacy'>('connection');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const pingBad = averagePingMs !== null && averagePingMs >= PING_WARN_MS;
  const lossBad = outboundPacketLossPct !== null && outboundPacketLossPct > LOSS_WARN_PCT;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Connection details"
      className="w-72 overflow-hidden rounded-xl border border-surface-700 bg-surface-800 shadow-2xl"
    >
      <div className="flex border-b border-surface-700">
        {(['connection', 'privacy'] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setTab(candidate)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium capitalize transition-colors ${
              tab === candidate
                ? 'border-nyptid-300 text-nyptid-200'
                : 'border-transparent text-surface-400 hover:text-surface-200'
            }`}
          >
            {candidate}
          </button>
        ))}
      </div>

      {tab === 'connection' ? (
        <div className="p-4">
          <Stat label="Average ping" value={formatMs(averagePingMs)} bad={pingBad} />
          <Stat label="Last ping" value={formatMs(lastPingMs)} bad={pingBad} />
          <Stat
            label="Outbound packet loss rate"
            value={outboundPacketLossPct === null ? '—' : `${outboundPacketLossPct.toFixed(1)}%`}
            bad={lossBad}
          />

          {region && <Stat label="Voice region" value={region} mono />}

          {(uplinkQuality > 0 || downlinkQuality > 0) && (
            <div className="mt-2 flex items-center gap-2 text-xs text-surface-500">
              <Signal size={12} />
              <span>
                Up {qualityLabel(uplinkQuality)} · Down {qualityLabel(downlinkQuality)}
              </span>
            </div>
          )}

          <p className="mt-3 text-xs leading-relaxed text-surface-500">
            You may notice delayed audio at {PING_WARN_MS} ms or higher. You may sound robotic if
            your packet loss rate is over {LOSS_WARN_PCT}%.
            {(pingBad || lossBad) && ' If the problem persists, disconnect and try again.'}
          </p>

          {averagePingMs === null && (
            <p className="mt-2 text-xs text-surface-600">
              Waiting for the first measurement — this fills in a few seconds after connecting.
            </p>
          )}
        </div>
      ) : (
        <div className="p-4">
          <p className="text-xs leading-relaxed text-surface-400">
            Voice and video are encrypted in transit between you and the media server, which mixes
            and forwards the audio.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-surface-500">
            That is transport encryption, not end-to-end. The media server can process the stream.
            Direct messages are separately end-to-end encrypted; a voice call is not the same
            guarantee, and it would be dishonest to badge it as one.
          </p>

          <div className="mt-3 flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-900/60 px-3 py-2">
            <Lock size={13} className="flex-shrink-0 text-green-300" />
            <span className="text-xs text-surface-300">Encrypted in transit (DTLS-SRTP)</span>
          </div>

          {isE2EEnabled() && (
            <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-900/60 px-3 py-2">
              <ShieldCheck size={13} className="flex-shrink-0 text-green-300" />
              <span className="text-xs text-surface-300">
                Direct messages are end-to-end encrypted
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  bad = false,
  mono = false,
}: {
  label: string;
  value: string;
  bad?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <span className="text-sm text-surface-400">{label}:</span>
      <span
        className={`text-sm font-semibold ${mono ? 'font-mono' : ''} ${
          bad ? 'text-amber-300' : 'text-surface-100'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function formatMs(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${Math.round(value)} ms`;
}

/** Provider quality scale is 0-6 with 0 meaning "not measured yet". */
function qualityLabel(quality: number): string {
  const labels = ['unknown', 'excellent', 'good', 'fair', 'poor', 'bad', 'down'];
  return labels[quality] ?? 'unknown';
}
