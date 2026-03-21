type NotificationSoundKind = 'call' | 'message' | 'ping';

interface SoundPlaybackOptions {
  status?: string | null;
  force?: boolean;
}

let audioContext: AudioContext | null = null;
let callRingIntervalId: number | null = null;
const lastPlayedAt: Record<NotificationSoundKind, number> = {
  call: 0,
  message: 0,
  ping: 0,
};

const MIN_GAP_MS: Record<NotificationSoundKind, number> = {
  call: 1200,
  message: 360,
  ping: 320,
};

function normalizeStatus(value: unknown): string {
  return String(value || '').trim().toLowerCase() || 'online';
}

function canPlay(options?: SoundPlaybackOptions): boolean {
  if (typeof window === 'undefined') return false;
  if (options?.force) return true;
  return normalizeStatus(options?.status) !== 'dnd';
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!ctor) return null;
  if (!audioContext) {
    audioContext = new ctor();
  }
  if (audioContext.state === 'suspended') {
    void audioContext.resume().catch(() => undefined);
  }
  return audioContext;
}

function scheduleTone(
  ctx: AudioContext,
  {
    frequency,
    delaySec,
    durationSec,
    gainLevel,
    wave = 'sine',
  }: {
    frequency: number;
    delaySec: number;
    durationSec: number;
    gainLevel: number;
    wave?: OscillatorType;
  },
) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime + delaySec);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + delaySec);
  gain.gain.exponentialRampToValueAtTime(gainLevel, ctx.currentTime + delaySec + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delaySec + durationSec);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(ctx.currentTime + delaySec);
  oscillator.stop(ctx.currentTime + delaySec + durationSec + 0.02);
}

function playPattern(kind: NotificationSoundKind, ctx: AudioContext) {
  if (kind === 'call') {
    scheduleTone(ctx, { frequency: 680, delaySec: 0, durationSec: 0.14, gainLevel: 0.04 });
    scheduleTone(ctx, { frequency: 920, delaySec: 0.18, durationSec: 0.14, gainLevel: 0.045 });
    scheduleTone(ctx, { frequency: 680, delaySec: 0.42, durationSec: 0.12, gainLevel: 0.04 });
    return;
  }
  if (kind === 'ping') {
    scheduleTone(ctx, { frequency: 1220, delaySec: 0, durationSec: 0.08, gainLevel: 0.038, wave: 'triangle' });
    scheduleTone(ctx, { frequency: 1480, delaySec: 0.1, durationSec: 0.08, gainLevel: 0.038, wave: 'triangle' });
    scheduleTone(ctx, { frequency: 1220, delaySec: 0.2, durationSec: 0.08, gainLevel: 0.036, wave: 'triangle' });
    return;
  }
  scheduleTone(ctx, { frequency: 880, delaySec: 0, durationSec: 0.07, gainLevel: 0.03 });
  scheduleTone(ctx, { frequency: 660, delaySec: 0.1, durationSec: 0.07, gainLevel: 0.028 });
}

export function playNotificationSound(kind: NotificationSoundKind, options?: SoundPlaybackOptions): boolean {
  if (!canPlay(options)) return false;
  const now = Date.now();
  if (now - lastPlayedAt[kind] < MIN_GAP_MS[kind]) return false;

  const ctx = getAudioContext();
  if (!ctx) return false;
  lastPlayedAt[kind] = now;
  playPattern(kind, ctx);
  return true;
}

export function startIncomingCallRing(options?: SoundPlaybackOptions) {
  if (callRingIntervalId !== null) return;
  playNotificationSound('call', options);
  callRingIntervalId = window.setInterval(() => {
    playNotificationSound('call', options);
  }, 3000);
}

export function stopIncomingCallRing() {
  if (callRingIntervalId === null) return;
  window.clearInterval(callRingIntervalId);
  callRingIntervalId = null;
}

export type { NotificationSoundKind, SoundPlaybackOptions };
