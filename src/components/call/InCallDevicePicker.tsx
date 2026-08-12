import { useEffect, useRef, useState } from 'react';
import { Headphones, Mic, Settings2, Video as VideoIcon } from 'lucide-react';
import { enumerateCallDevices, loadCallSettings, saveCallSettings, type MediaDeviceOption } from '../../lib/callSettings';

export interface InCallDevicePickerProps {
  onMicChange?: (deviceId: string) => void | Promise<void>;
  onCameraChange?: (deviceId: string) => void | Promise<void>;
  onSpeakerChange?: (deviceId: string) => void | Promise<void>;
}

export function InCallDevicePicker({ onMicChange, onCameraChange, onSpeakerChange }: InCallDevicePickerProps) {
  const [open, setOpen] = useState(false);
  const [mics, setMics] = useState<MediaDeviceOption[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceOption[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceOption[]>([]);
  const [mic, setMic] = useState(() => loadCallSettings().inputDeviceId);
  const [speaker, setSpeaker] = useState(() => loadCallSettings().outputDeviceId);
  const [camera, setCamera] = useState(() => loadCallSettings().cameraDeviceId);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    enumerateCallDevices().then((result) => {
      if (cancelled) return;
      setMics(result.audioInputs);
      setSpeakers(result.audioOutputs);
      setCameras(result.videoInputs);
    }).catch(() => {
      // Ignore enumeration errors — labels require prior mic/cam permission.
    });
    const refresh = () => {
      enumerateCallDevices().then((result) => {
        if (cancelled) return;
        setMics(result.audioInputs);
        setSpeakers(result.audioOutputs);
        setCameras(result.videoInputs);
      }).catch(() => {});
    };
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  async function applyMic(deviceId: string) {
    setMic(deviceId);
    saveCallSettings({ ...loadCallSettings(), inputDeviceId: deviceId });
    try { await onMicChange?.(deviceId); } catch (err) { console.warn('Mic switch failed', err); }
  }
  async function applySpeaker(deviceId: string) {
    setSpeaker(deviceId);
    saveCallSettings({ ...loadCallSettings(), outputDeviceId: deviceId });
    try { await onSpeakerChange?.(deviceId); } catch (err) { console.warn('Speaker switch failed', err); }
  }
  async function applyCamera(deviceId: string) {
    setCamera(deviceId);
    saveCallSettings({ ...loadCallSettings(), cameraDeviceId: deviceId });
    try { await onCameraChange?.(deviceId); } catch (err) { console.warn('Camera switch failed', err); }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${open ? 'bg-nyptid-300 text-surface-950' : 'bg-surface-700 text-surface-200 hover:bg-surface-600'}`}
        title="Devices"
        aria-label="Change audio / video devices"
      >
        <Settings2 size={18} />
      </button>
      {open && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 w-[280px] rounded-xl border border-surface-700 bg-surface-900/95 backdrop-blur shadow-2xl p-3 z-50">
          <div className="text-xs font-semibold text-surface-300 mb-2">Devices</div>

          <label className="block mb-2">
            <span className="text-[11px] uppercase tracking-wide text-surface-400 flex items-center gap-1.5"><Mic size={11} /> Microphone</span>
            <select
              value={mic}
              onChange={(e) => void applyMic(e.target.value)}
              className="nyptid-input mt-1 text-xs py-1.5"
            >
              {mics.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
          </label>

          <label className="block mb-2">
            <span className="text-[11px] uppercase tracking-wide text-surface-400 flex items-center gap-1.5"><Headphones size={11} /> Output</span>
            <select
              value={speaker}
              onChange={(e) => void applySpeaker(e.target.value)}
              className="nyptid-input mt-1 text-xs py-1.5"
            >
              {speakers.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-surface-400 flex items-center gap-1.5"><VideoIcon size={11} /> Camera</span>
            <select
              value={camera}
              onChange={(e) => void applyCamera(e.target.value)}
              className="nyptid-input mt-1 text-xs py-1.5"
            >
              {cameras.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
