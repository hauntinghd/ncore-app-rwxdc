import { getStreamerModeSettings } from './streamerMode';

type NotificationSoundKind =
  | 'call'
  | 'message'
  | 'ping'
  | 'mute_on'
  | 'mute_off'
  | 'deafen_on'
  | 'deafen_off';

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
  mute_on: 0,
  mute_off: 0,
  deafen_on: 0,
  deafen_off: 0,
};

const MIN_GAP_MS: Record<NotificationSoundKind, number> = {
  call: 1200,
  message: 360,
  ping: 320,
  mute_on: 120,
  mute_off: 120,
  deafen_on: 120,
  deafen_off: 120,
};

const IN_APP_SOUND_MIN_VOLUME_PERCENT = 85;
const IN_APP_SOUND_TARGET_VOLUME_PERCENT = 100;
const IN_APP_SOUND_VOLUME_SCALE = Math.max(
  IN_APP_SOUND_MIN_VOLUME_PERCENT,
  IN_APP_SOUND_TARGET_VOLUME_PERCENT,
) / 100;

function applyVolumeScale(gainLevel: number): number {
  return Math.max(0.0001, Math.min(1, gainLevel * IN_APP_SOUND_VOLUME_SCALE));
}

function normalizeStatus(value: unknown): string {
  return String(value || '').trim().toLowerCase() || 'online';
}

function canPlay(options?: SoundPlaybackOptions): boolean {
  if (typeof window === 'undefined') return false;
  if (options?.force) return true;
  const streamerMode = getStreamerModeSettings();
  if (streamerMode.enabled && streamerMode.silentNotifications) return false;
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

export function primeNotificationAudio(): boolean {
  return Boolean(getAudioContext());
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
  gain.gain.exponentialRampToValueAtTime(applyVolumeScale(gainLevel), ctx.currentTime + delaySec + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delaySec + durationSec);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(ctx.currentTime + delaySec);
  oscillator.stop(ctx.currentTime + delaySec + durationSec + 0.02);
}

function playPattern(kind: NotificationSoundKind, ctx: AudioContext) {
  if (kind === 'call') {
    scheduleTone(ctx, { frequency: 680, delaySec: 0, durationSec: 0.14, gainLevel: 0.11 });
    scheduleTone(ctx, { frequency: 920, delaySec: 0.18, durationSec: 0.14, gainLevel: 0.125 });
    scheduleTone(ctx, { frequency: 680, delaySec: 0.42, durationSec: 0.12, gainLevel: 0.11 });
    return;
  }
  if (kind === 'ping') {
    scheduleTone(ctx, { frequency: 1220, delaySec: 0, durationSec: 0.08, gainLevel: 0.1, wave: 'triangle' });
    scheduleTone(ctx, { frequency: 1480, delaySec: 0.1, durationSec: 0.08, gainLevel: 0.1, wave: 'triangle' });
    scheduleTone(ctx, { frequency: 1220, delaySec: 0.2, durationSec: 0.08, gainLevel: 0.095, wave: 'triangle' });
    return;
  }
  if (kind === 'mute_on') {
    scheduleTone(ctx, { frequency: 560, delaySec: 0, durationSec: 0.08, gainLevel: 0.095, wave: 'square' });
    return;
  }
  if (kind === 'mute_off') {
    scheduleTone(ctx, { frequency: 760, delaySec: 0, durationSec: 0.08, gainLevel: 0.095, wave: 'square' });
    return;
  }
  if (kind === 'deafen_on') {
    scheduleTone(ctx, { frequency: 420, delaySec: 0, durationSec: 0.08, gainLevel: 0.09, wave: 'square' });
    scheduleTone(ctx, { frequency: 360, delaySec: 0.11, durationSec: 0.08, gainLevel: 0.09, wave: 'square' });
    return;
  }
  if (kind === 'deafen_off') {
    scheduleTone(ctx, { frequency: 360, delaySec: 0, durationSec: 0.08, gainLevel: 0.09, wave: 'square' });
    scheduleTone(ctx, { frequency: 520, delaySec: 0.11, durationSec: 0.08, gainLevel: 0.09, wave: 'square' });
    return;
  }
  scheduleTone(ctx, { frequency: 880, delaySec: 0, durationSec: 0.07, gainLevel: 0.095 });
  scheduleTone(ctx, { frequency: 660, delaySec: 0.1, durationSec: 0.07, gainLevel: 0.09 });
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

export function playVoiceToggleSound(kind: 'mute' | 'deafen', enabled: boolean, options?: SoundPlaybackOptions): boolean {
  const cueKind: NotificationSoundKind = kind === 'mute'
    ? (enabled ? 'mute_on' : 'mute_off')
    : (enabled ? 'deafen_on' : 'deafen_off');
  return playNotificationSound(cueKind, { ...options, force: true });
}

export type { NotificationSoundKind, SoundPlaybackOptions };
