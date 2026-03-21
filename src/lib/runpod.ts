const FALLBACK_RUNPOD_HTTP_URL = 'https://ghjqzcykj837ui-8081.proxy.runpod.net';

export interface RunPodProbeResult {
  ok: boolean;
  url: string;
  error?: string;
}

export function getRunPodHttpUrl(): string {
  const configured = String(import.meta.env.VITE_RUNPOD_HTTP_URL || '').trim();
  const resolved = configured || FALLBACK_RUNPOD_HTTP_URL;
  return resolved.replace(/\/+$/, '');
}

export async function probeRunPodBackend(): Promise<RunPodProbeResult> {
  const url = getRunPodHttpUrl();
  try {
    await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
    });
    return { ok: true, url };
  } catch (error) {
    return {
      ok: false,
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
