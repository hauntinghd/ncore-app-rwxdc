export interface CallSettings {
  inputDeviceId: string;
  outputDeviceId: string;
  cameraDeviceId: string;
  inputVolume: number;
  outputVolume: number;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  automaticGainControl: boolean;
  qualityHD: boolean;
  hardwareAcceleration: boolean;
  screenShareQuality: '720p30' | '1080p120' | '4k60';
}

export interface MediaDeviceOption {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

const STORAGE_KEY = 'nyptid.callSettings.v1';

export const DEFAULT_CALL_SETTINGS: CallSettings = {
  inputDeviceId: 'default',
  outputDeviceId: 'default',
  cameraDeviceId: 'default',
  inputVolume: 100,
  outputVolume: 100,
  echoCancellation: true,
  noiseSuppression: true,
  automaticGainControl: true,
  qualityHD: false,
  hardwareAcceleration: true,
  screenShareQuality: '720p30',
};

export function loadCallSettings(): CallSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CALL_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<CallSettings>;
    return {
      ...DEFAULT_CALL_SETTINGS,
      ...parsed,
    };
  } catch {
    return DEFAULT_CALL_SETTINGS;
  }
}

export function saveCallSettings(settings: CallSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export async function enumerateCallDevices(): Promise<{
  audioInputs: MediaDeviceOption[];
  audioOutputs: MediaDeviceOption[];
  videoInputs: MediaDeviceOption[];
}> {
  let devices = await navigator.mediaDevices.enumerateDevices();

  // Labels are empty before permission; attempt to unlock labels.
  const missingLabels = devices.some((d) => !d.label);
  if (missingLabels) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach((t) => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      // Best effort only; keep devices without labels.
    }
  }

  const toOption = (d: MediaDeviceInfo): MediaDeviceOption => ({
    deviceId: d.deviceId || 'default',
    label: d.label || fallbackLabel(d.kind),
    kind: d.kind,
  });

  const audioInputs = normalizeDeviceList(devices.filter((d) => d.kind === 'audioinput').map(toOption), 'audioinput');
  const audioOutputs = normalizeDeviceList(devices.filter((d) => d.kind === 'audiooutput').map(toOption), 'audiooutput');
  const videoInputs = normalizeDeviceList(devices.filter((d) => d.kind === 'videoinput').map(toOption), 'videoinput');

  return { audioInputs, audioOutputs, videoInputs };
}

function fallbackLabel(kind: MediaDeviceKind): string {
  if (kind === 'audioinput') return 'Default - System Microphone';
  if (kind === 'audiooutput') return 'Default - System Output';
  return 'Default - System Camera';
}

function normalizeDeviceList(devices: MediaDeviceOption[], kind: MediaDeviceKind): MediaDeviceOption[] {
  const seen = new Set<string>();
  const normalized: MediaDeviceOption[] = [];

  for (const d of devices) {
    const key = `${d.kind}:${d.deviceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(d);
  }

  const hasDefault = normalized.some((d) => d.deviceId === 'default');
  if (!hasDefault) {
    normalized.unshift({
      kind,
      deviceId: 'default',
      label: fallbackLabel(kind),
    });
  }

  return normalized;
}
