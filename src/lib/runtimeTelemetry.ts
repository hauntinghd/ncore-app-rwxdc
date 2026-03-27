import { trackGrowthEvent } from './growthEvents';
import type { Json } from './types';

interface RuntimeTelemetryOptions {
  userId?: string | null;
  sourceChannel?: string | null;
  eventSource?: string | null;
  sampleRate?: number;
}

function toFiniteDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100) / 100;
}

function shouldSample(sampleRate = 1): boolean {
  if (!Number.isFinite(sampleRate) || sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  return Math.random() < sampleRate;
}

export function queueRuntimeEvent(
  eventName: string,
  payload: Record<string, Json> = {},
  options: RuntimeTelemetryOptions = {},
): void {
  if (!shouldSample(options.sampleRate ?? 1)) return;

  queueMicrotask(() => {
    void trackGrowthEvent(eventName, payload, {
      userId: options.userId || null,
      sourceChannel: options.sourceChannel || null,
      eventSource: options.eventSource || 'app_runtime',
    }).catch(() => {
      // Telemetry must never break the product path.
    });
  });
}

export function reportRuntimeError(
  eventName: string,
  error: unknown,
  payload: Record<string, Json> = {},
  options: RuntimeTelemetryOptions = {},
): void {
  const err = error as any;
  queueRuntimeEvent(eventName, {
    ...payload,
    error_name: String(err?.name || 'Error'),
    error_message: String(err?.message || error || ''),
    error_code: String(err?.code || ''),
  }, options);
}

export function createDurationTracker(
  eventName: string,
  basePayload: Record<string, Json> = {},
  options: RuntimeTelemetryOptions = {},
): (extraPayload?: Record<string, Json>) => void {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return (extraPayload = {}) => {
    const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    queueRuntimeEvent(eventName, {
      ...basePayload,
      ...extraPayload,
      duration_ms: toFiniteDuration(finishedAt - startedAt),
    }, options);
  };
}
