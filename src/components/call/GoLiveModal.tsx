import { useEffect, useMemo, useState } from 'react';
import { AppWindow, Lock, Monitor, X } from 'lucide-react';

export type GoLiveQuality = '720p30' | '1080p120' | '4k60';

export interface GoLiveSource {
  id: string;
  name: string;
  type: 'screen' | 'window';
  thumbnailDataUrl?: string;
  appIconDataUrl?: string;
}

const QUALITY_PRESETS: Array<{ value: GoLiveQuality; title: string; detail: string; lockedHint: string }> = [
  { value: '720p30', title: 'Standard', detail: '720p · 30fps', lockedHint: '' },
  { value: '1080p120', title: 'Smoother video', detail: '1080p · 120fps', lockedHint: 'Unlocks at Level 35' },
  { value: '4k60', title: 'Best quality', detail: '4K · 60fps', lockedHint: 'NCore Boost' },
];

/**
 * Discord-style "Go Live" picker.
 *
 * Where the runtime can enumerate capture sources with thumbnails (the
 * Electron build's desktopCapturer), they are shown as Applications / Entire
 * Screen tabs and the choice is passed through. Where it cannot (Tauri /
 * WebView2, browsers), the source grid is replaced by a note and the system
 * picker appears after "Go Live" — getDisplayMedia offers no way to
 * preselect a window there.
 */
export function GoLiveModal({
  open,
  onClose,
  onGoLive,
  sources,
  loadingSources,
  initialQuality,
  allowedQualities,
}: {
  open: boolean;
  onClose: () => void;
  onGoLive: (options: { quality: GoLiveQuality; sourceId: string | null }) => void;
  sources: GoLiveSource[];
  loadingSources: boolean;
  initialQuality: GoLiveQuality;
  allowedQualities: GoLiveQuality[];
}) {
  const [tab, setTab] = useState<'window' | 'screen'>('window');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [quality, setQuality] = useState<GoLiveQuality>(initialQuality);

  useEffect(() => {
    if (!open) return;
    setQuality(allowedQualities.includes(initialQuality) ? initialQuality : '720p30');
    setSelectedSourceId(null);
  }, [open, initialQuality, allowedQualities]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const hasSources = sources.length > 0;
  const visibleSources = useMemo(() => sources.filter((s) => s.type === tab), [sources, tab]);
  const canGoLive = !hasSources || Boolean(selectedSourceId);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-surface-700/80 bg-surface-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-lg font-bold text-surface-100">Go Live</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-surface-400 hover:bg-surface-800 hover:text-surface-100" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {hasSources ? (
          <>
            <div className="mx-5 mt-3 grid grid-cols-2 gap-1 rounded-xl bg-surface-950/70 p-1">
              {([
                { id: 'window', label: 'Applications', icon: AppWindow },
                { id: 'screen', label: 'Entire Screen', icon: Monitor },
              ] as const).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition-colors ${
                    tab === item.id ? 'bg-surface-800 text-surface-100' : 'text-surface-400 hover:text-surface-200'
                  }`}
                >
                  <item.icon size={15} />
                  {item.label}
                </button>
              ))}
            </div>
            <div className="mt-3 grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto px-5 pb-2">
              {visibleSources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => setSelectedSourceId(source.id)}
                  onDoubleClick={() => onGoLive({ quality, sourceId: source.id })}
                  className={`overflow-hidden rounded-xl border-2 text-left transition-colors ${
                    selectedSourceId === source.id ? 'border-nyptid-300' : 'border-transparent hover:border-surface-600'
                  }`}
                >
                  <div className="aspect-video bg-surface-950">
                    {source.thumbnailDataUrl
                      ? <img src={source.thumbnailDataUrl} alt="" className="h-full w-full object-contain" />
                      : <div className="flex h-full items-center justify-center text-surface-600"><Monitor size={28} /></div>}
                  </div>
                  <div className="flex items-center gap-2 bg-surface-800/60 px-3 py-2">
                    {source.appIconDataUrl && <img src={source.appIconDataUrl} alt="" className="h-4 w-4" />}
                    <span className="truncate text-sm font-medium text-surface-100">{source.name}</span>
                  </div>
                </button>
              ))}
              {visibleSources.length === 0 && (
                <div className="col-span-2 py-10 text-center text-sm text-surface-500">
                  {loadingSources ? 'Looking for windows and screens...' : 'Nothing to share here.'}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="mx-5 mt-3 rounded-xl bg-surface-950/70 px-4 py-6 text-center text-sm text-surface-400">
            {loadingSources
              ? 'Looking for windows and screens...'
              : 'Pick your quality, then choose the window or screen to share in the next step.'}
          </div>
        )}

        <div className="mt-3 border-t border-surface-800 px-5 py-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-surface-500">Stream quality</div>
          <div className="grid grid-cols-3 gap-2">
            {QUALITY_PRESETS.map((preset) => {
              const allowed = allowedQualities.includes(preset.value);
              const selected = quality === preset.value;
              return (
                <button
                  key={preset.value}
                  type="button"
                  disabled={!allowed}
                  onClick={() => setQuality(preset.value)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    selected
                      ? 'border-nyptid-300 bg-nyptid-300/10'
                      : allowed
                        ? 'border-surface-700 bg-surface-950/50 hover:border-surface-600'
                        : 'cursor-not-allowed border-surface-800 bg-surface-950/30 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-surface-100">
                    {!allowed && <Lock size={12} className="text-surface-500" />}
                    {preset.title}
                  </div>
                  <div className="text-xs text-surface-400">{allowed ? preset.detail : preset.lockedHint}</div>
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="nyptid-btn-secondary px-4 py-2 text-sm">Cancel</button>
            <button
              type="button"
              disabled={!canGoLive}
              onClick={() => onGoLive({ quality, sourceId: hasSources ? selectedSourceId : null })}
              className="nyptid-btn-primary px-5 py-2 text-sm disabled:opacity-50"
            >
              Go Live
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
