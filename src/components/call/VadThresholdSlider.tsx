import { useEffect, useState } from 'react';
import { loadCallSettings, saveCallSettings } from '../../lib/callSettings';

export interface VadThresholdSliderProps {
  onChange?: (value: number) => void;
  className?: string;
}

/**
 * VAD threshold slider (0 = off, 1 = very aggressive gate).
 * Value is forwarded to the RNNoise worklet live via the session's
 * `setVadThreshold` method (caller wires that through the onChange prop).
 */
export function VadThresholdSlider({ onChange, className }: VadThresholdSliderProps) {
  const [value, setValue] = useState(() => {
    const stored = loadCallSettings().vadThreshold;
    return Number.isFinite(stored) ? Math.max(0, Math.min(1, stored)) : 0.5;
  });

  useEffect(() => {
    const id = setTimeout(() => {
      saveCallSettings({ ...loadCallSettings(), vadThreshold: value });
      onChange?.(value);
    }, 75);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const percent = Math.round(value * 100);
  const label = value === 0 ? 'Off' : value < 0.35 ? 'Loose' : value < 0.65 ? 'Moderate' : 'Aggressive';

  return (
    <div className={`inline-flex items-center gap-2 rounded-full border border-surface-700 bg-surface-900/80 backdrop-blur px-3 py-1.5 ${className || ''}`}>
      <span className="text-[10px] uppercase tracking-wide text-surface-400">Gate</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className="w-24 accent-nyptid-300"
        aria-label="Voice activity gate threshold"
      />
      <span className="text-[11px] font-medium text-surface-200 w-20 text-right" title={`Threshold ${value.toFixed(2)}`}>
        {label} · {percent}%
      </span>
    </div>
  );
}
