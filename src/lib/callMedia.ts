import type { ILocalAudioTrack } from 'agora-rtc-sdk-ng';
import { loadCallSettings, saveCallSettings, type CallSettings } from './callSettings';

type AgoraRTCModule = typeof import('agora-rtc-sdk-ng')['default'];

let cachedAgoraModule: Promise<AgoraRTCModule> | null = null;

async function getAgoraModule(): Promise<AgoraRTCModule> {
  if (!cachedAgoraModule) {
    cachedAgoraModule = import('agora-rtc-sdk-ng').then((module) => module.default as AgoraRTCModule);
  }
  return cachedAgoraModule;
}

function formatRtcError(error: unknown): string {
  const e = error as any;
  const parts = [
    e?.name || 'UnknownError',
    e?.code ? `code=${e.code}` : '',
    e?.message || '',
  ].filter(Boolean);
  return parts.join(' | ');
}

function normalizeInputVolume(inputVolume: number): number {
  const numeric = Number(inputVolume);
  if (!Number.isFinite(numeric)) return 100;
  if (numeric <= 0) return 100;
  return Math.max(1, Math.min(100, Math.round(numeric)));
}

async function applyEnhancedNoiseSuppression(track: MediaStreamTrack, enabled: boolean) {
  if (!enabled || typeof track?.applyConstraints !== 'function') return;
  try {
    await track.applyConstraints({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    } as MediaTrackConstraints);
  } catch {
    // Ignore unsupported constraint errors.
  }

  try {
    await track.applyConstraints({
      advanced: [
        { voiceIsolation: true } as any,
        { googNoiseSuppression: true } as any,
        { googNoiseSuppression2: true } as any,
        { googEchoCancellation: true } as any,
        { googEchoCancellation2: true } as any,
        { googAutoGainControl: true } as any,
        { googAutoGainControl2: true } as any,
        { googHighpassFilter: true } as any,
        { googTypingNoiseDetection: true } as any,
      ],
    } as MediaTrackConstraints);
  } catch {
    // Ignore unsupported constraint errors.
  }
}

export async function resolveCallAudioSettings(base?: CallSettings): Promise<CallSettings> {
  const source = base || loadCallSettings();
  const next: CallSettings = {
    ...source,
    inputVolume: normalizeInputVolume(source.inputVolume),
    inputDeviceId: String(source.inputDeviceId || 'default').trim() || 'default',
  };

  let changed = (
    next.inputVolume !== source.inputVolume
    || next.inputDeviceId !== source.inputDeviceId
  );

  if (next.inputDeviceId !== 'default') {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasSavedInput = devices.some((device) => (
        device.kind === 'audioinput' && device.deviceId === next.inputDeviceId
      ));
      if (!hasSavedInput) {
        next.inputDeviceId = 'default';
        changed = true;
      }
    } catch {
      // If device enumeration fails, keep current best-effort settings.
    }
  }

  if (changed) {
    saveCallSettings(next);
  }
  return next;
}

export async function createConfiguredLocalAudioTrack(preferredSettings?: CallSettings): Promise<ILocalAudioTrack> {
  const callSettings = await resolveCallAudioSettings(preferredSettings);
  const errors: string[] = [];
  const AgoraRTC = await getAgoraModule();

  try {
    const selectedStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: callSettings.inputDeviceId && callSettings.inputDeviceId !== 'default'
          ? { exact: callSettings.inputDeviceId }
          : undefined,
        echoCancellation: callSettings.echoCancellation,
        noiseSuppression: callSettings.noiseSuppression,
        autoGainControl: callSettings.automaticGainControl,
      },
      video: false,
    });
    const selectedTrack = selectedStream.getAudioTracks()[0];
    if (!selectedTrack) {
      throw new Error('No audio track from selected getUserMedia');
    }
    await applyEnhancedNoiseSuppression(selectedTrack, callSettings.noiseSuppression);
    return AgoraRTC.createCustomAudioTrack({ mediaStreamTrack: selectedTrack });
  } catch (error) {
    errors.push(`getUserMedia(selected): ${formatRtcError(error)}`);
  }

  try {
    return await AgoraRTC.createMicrophoneAudioTrack({
      microphoneId: callSettings.inputDeviceId && callSettings.inputDeviceId !== 'default'
        ? callSettings.inputDeviceId
        : undefined,
      AEC: callSettings.echoCancellation,
      ANS: callSettings.noiseSuppression,
      AGC: callSettings.automaticGainControl,
    } as any);
  } catch (error) {
    errors.push(`agora(selected): ${formatRtcError(error)}`);
  }

  try {
    const defaultStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: callSettings.echoCancellation,
        noiseSuppression: callSettings.noiseSuppression,
        autoGainControl: callSettings.automaticGainControl,
      },
      video: false,
    });
    const defaultTrack = defaultStream.getAudioTracks()[0];
    if (!defaultTrack) {
      throw new Error('No audio track from default getUserMedia');
    }
    await applyEnhancedNoiseSuppression(defaultTrack, callSettings.noiseSuppression);
    return AgoraRTC.createCustomAudioTrack({ mediaStreamTrack: defaultTrack });
  } catch (error) {
    errors.push(`getUserMedia(default): ${formatRtcError(error)}`);
  }

  try {
    return await AgoraRTC.createMicrophoneAudioTrack({
      AEC: callSettings.echoCancellation,
      ANS: callSettings.noiseSuppression,
      AGC: callSettings.automaticGainControl,
    } as any);
  } catch (error) {
    errors.push(`agora(default): ${formatRtcError(error)}`);
    throw new Error(errors.join(' || '));
  }
}
