import type { ILocalAudioTrack } from 'agora-rtc-sdk-ng';
import type { AIDenoiserExtension, IAIDenoiserProcessor } from 'agora-extension-ai-denoiser';

type AgoraRTCModule = typeof import('agora-rtc-sdk-ng')['default'];

export interface AIDenoiserBinding {
  engine: 'ai' | 'fallback' | 'off';
  detail: string;
  teardown: () => Promise<void>;
}

interface ExtensionState {
  AgoraRTC: AgoraRTCModule;
  extension: AIDenoiserExtension;
}

let extensionPromise: Promise<ExtensionState> | null = null;

function formatError(error: unknown): string {
  const e = error as any;
  return [
    e?.name || 'UnknownError',
    e?.code ? `code=${e.code}` : '',
    e?.message || String(error || ''),
  ]
    .filter(Boolean)
    .join(' | ');
}

function getAssetsPath(): string {
  if (typeof window === 'undefined') return './ai-denoiser';
  if (window.location.protocol === 'file:') return './ai-denoiser';

  const rawBase = String(import.meta.env.BASE_URL || '/');
  const normalizedBase = rawBase === './'
    ? '/'
    : (rawBase.startsWith('/') ? rawBase : `/${rawBase.replace(/^\.?\//, '')}`);
  const baseWithSlash = normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`;
  return `${baseWithSlash}ai-denoiser`;
}

async function getExtensionState(): Promise<ExtensionState> {
  if (!extensionPromise) {
    extensionPromise = (async () => {
      const [{ AIDenoiserExtension }, agoraRtcModule] = await Promise.all([
        import('agora-extension-ai-denoiser'),
        import('agora-rtc-sdk-ng'),
      ]);

      const AgoraRTC = agoraRtcModule.default as AgoraRTCModule;
      const extension = new AIDenoiserExtension({
        assetsPath: getAssetsPath(),
        fetchOptions: { cache: 'no-cache' },
      });
      AgoraRTC.registerExtensions([extension]);
      return { AgoraRTC, extension };
    })();
  }

  return extensionPromise;
}

async function destroyProcessor(track: ILocalAudioTrack, processor: IAIDenoiserProcessor | null) {
  if (!processor) return;
  try {
    processor.unpipe();
  } catch {
    // noop
  }
  try {
    track.unpipe();
  } catch {
    // noop
  }
  try {
    track.pipe(track.processorDestination);
  } catch {
    // noop
  }
  try {
    await processor.destroy();
  } catch {
    // noop
  }
}

export async function createAIDenoiserBinding(
  track: ILocalAudioTrack,
  enabled: boolean,
): Promise<AIDenoiserBinding> {
  if (!enabled) {
    return {
      engine: 'off',
      detail: 'noise suppression disabled',
      teardown: async () => {},
    };
  }

  try {
    const { extension } = await getExtensionState();
    if (!extension.checkCompatibility()) {
      return {
        engine: 'fallback',
        detail: 'AI denoiser unsupported in this runtime',
        teardown: async () => {},
      };
    }

    const processor = extension.createProcessor();
    processor.on('overload', () => {
      console.warn('Agora AI denoiser overload detected; audio processing may be constrained.');
    });
    processor.on('pipeerror', (error: Error) => {
      console.warn('Agora AI denoiser pipe error; restoring direct audio pipeline.', error);
      void destroyProcessor(track, processor);
    });

    track.pipe(processor).pipe(track.processorDestination);
    await processor.setMode('NSNG');
    await processor.setLevel('AGGRESSIVE');
    await processor.setLatency('LOW');
    await processor.enable();

    return {
      engine: 'ai',
      detail: 'Agora AI denoiser active',
      teardown: async () => {
        await destroyProcessor(track, processor);
      },
    };
  } catch (error) {
    console.warn('Failed to initialize Agora AI denoiser; falling back to browser/Agora suppression.', error);
    return {
      engine: 'fallback',
      detail: formatError(error),
      teardown: async () => {},
    };
  }
}
