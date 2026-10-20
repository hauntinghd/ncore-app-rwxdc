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
  const errorPayload: Record<string, Json> = {
    ...payload,
    error_name: String(err?.name || 'Error'),
    error_message: String(err?.message || error || ''),
    error_code: String(err?.code || ''),
  };
  queueRuntimeEvent(eventName, errorPayload, options);
  // Optional external forward (Sentry, Discord, any HTTP receiver). Off by default.
  forwardErrorToExternalHook(eventName, errorPayload, err).catch(() => {
    // Telemetry must never break the product path.
  });
}

let errorHookBudget = {
  minuteStart: 0,
  count: 0,
};

async function forwardErrorToExternalHook(
  eventName: string,
  payload: Record<string, Json>,
  errorObject: any,
): Promise<void> {
  const url = String(
    (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_ERROR_WEBHOOK_URL : '')
    || '',
  ).trim();
  if (!url) return;

  // Crude in-memory rate limit: max 30 errors/min per tab to avoid spamming
  // a misbehaving endpoint during a render loop.
  const now = Date.now();
  if (now - errorHookBudget.minuteStart > 60_000) {
    errorHookBudget = { minuteStart: now, count: 0 };
  }
  if (errorHookBudget.count >= 30) return;
  errorHookBudget.count += 1;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        event: eventName,
        app: 'ncore',
        version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '',
        ts: new Date().toISOString(),
        payload,
        stack: String(errorObject?.stack || ''),
        href: typeof window !== 'undefined' ? window.location.href : '',
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      }),
    });
  } catch {
    // swallow — this is best-effort telemetry
  }
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
