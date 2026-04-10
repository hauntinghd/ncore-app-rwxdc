/**
 * RNNoise Noise Suppression Binding
 *
 * Provides Krisp-grade noise cancellation using a forked RNNoise compiled to WASM.
 * This module manages the AudioWorklet lifecycle and provides the same
 * NoiseSuppressionBinding interface used by the RTC providers.
 *
 * Usage:
 *   const binding = await createRNNoiseBinding(audioTrack, true);
 *   // ... later
 *   await binding.teardown();
 *
 * The RNNoise WASM binary should be placed at:
 *   /audio-processors/rnnoise.wasm
 *
 * The AudioWorklet processor script should be placed at:
 *   /audio-processors/rnnoise-worklet-processor.js
 */

import type { NoiseSuppressionBinding } from '../rtcProvider';

const WORKLET_URL = '/audio-processors/rnnoise-worklet-processor.js';
const WASM_URL = '/audio-processors/rnnoise.wasm';
const PERFORMANCE_BUDGET_MS = 8; // Must process within 8ms of a 10ms frame

interface RNNoiseState {
  context: AudioContext;
  workletNode: AudioWorkletNode;
  sourceNode: MediaStreamAudioSourceNode;
  destinationNode: MediaStreamAudioDestinationNode;
  vadProbability: number;
  performanceOk: boolean;
}

let wasmModuleCache: Promise<WebAssembly.Module> | null = null;

async function loadWasmModule(): Promise<WebAssembly.Module> {
  if (!wasmModuleCache) {
    wasmModuleCache = fetch(WASM_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to fetch RNNoise WASM: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => WebAssembly.compile(buffer))
      .catch((error) => {
        wasmModuleCache = null;
        throw error;
      });
  }
  return wasmModuleCache;
}

function isAudioWorkletSupported(): boolean {
  return typeof AudioContext !== 'undefined'
    && typeof AudioWorkletNode !== 'undefined'
    && typeof window !== 'undefined';
}

/**
 * Create an RNNoise-based noise suppression binding.
 *
 * This intercepts the audio track's MediaStreamTrack, processes it through
 * the RNNoise AudioWorklet, and returns a new processed track.
 *
 * @param mediaStreamTrack - The raw MediaStreamTrack from the audio input
 * @param enabled - Whether noise suppression should be active
 * @param options - Optional configuration
 * @returns NoiseSuppressionBinding with engine info and teardown function
 */
export async function createRNNoiseBinding(
  mediaStreamTrack: MediaStreamTrack,
  enabled: boolean,
  options?: {
    vadThreshold?: number; // 0 = disabled, 0.5 = moderate, 0.8 = aggressive
    onVadUpdate?: (probability: number) => void;
  },
): Promise<{ binding: NoiseSuppressionBinding; processedTrack: MediaStreamTrack | null }> {
  if (!enabled) {
    return {
      binding: {
        engine: 'off',
        detail: 'RNNoise disabled',
        teardown: async () => {},
      },
      processedTrack: null,
    };
  }

  if (!isAudioWorkletSupported()) {
    return {
      binding: {
        engine: 'fallback',
        detail: 'AudioWorklet not supported in this runtime',
        teardown: async () => {},
      },
      processedTrack: null,
    };
  }

  let state: RNNoiseState | null = null;

  try {
    // Load WASM module
    const wasmModule = await loadWasmModule();

    // Create audio processing pipeline
    const context = new AudioContext({ sampleRate: 48000 });
    await context.audioWorklet.addModule(WORKLET_URL);

    const sourceStream = new MediaStream([mediaStreamTrack]);
    const sourceNode = context.createMediaStreamSource(sourceStream);
    const workletNode = new AudioWorkletNode(context, 'rnnoise-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const destinationNode = context.createMediaStreamDestination();

    // Wire: source → worklet → destination
    sourceNode.connect(workletNode);
    workletNode.connect(destinationNode);

    state = {
      context,
      workletNode,
      sourceNode,
      destinationNode,
      vadProbability: 0,
      performanceOk: true,
    };

    // Wait for worklet to signal ready after WASM init
    const readyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('RNNoise worklet init timeout')), 5000);
      workletNode.port.onmessage = (event) => {
        const data = event.data;
        if (data.type === 'ready') {
          clearTimeout(timeout);
          resolve();
        } else if (data.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(data.message));
        } else if (data.type === 'vad') {
          if (state) state.vadProbability = data.probability;
          options?.onVadUpdate?.(data.probability);
        }
      };
    });

    // Send WASM module to worklet
    workletNode.port.postMessage({ type: 'load-wasm', wasmModule });

    // Configure threshold
    if (options?.vadThreshold) {
      workletNode.port.postMessage({ type: 'set-threshold', threshold: options.vadThreshold });
    }

    await readyPromise;

    // Return the processed audio track
    const processedTrack = destinationNode.stream.getAudioTracks()[0] || null;

    return {
      binding: {
        engine: 'ai',
        detail: 'RNNoise WASM noise suppression active',
        teardown: async () => {
          try {
            sourceNode.disconnect();
            workletNode.disconnect();
            destinationNode.disconnect();
            await context.close();
          } catch {
            // noop
          }
          state = null;
        },
      },
      processedTrack,
    };
  } catch (error) {
    // Clean up partial state on failure
    if (state) {
      try {
        state.sourceNode.disconnect();
        state.workletNode.disconnect();
        state.destinationNode.disconnect();
        await state.context.close();
      } catch {
        // noop
      }
    }

    console.warn('RNNoise initialization failed, falling back to browser suppression:', error);
    return {
      binding: {
        engine: 'fallback',
        detail: `RNNoise init failed: ${(error as Error).message}`,
        teardown: async () => {},
      },
      processedTrack: null,
    };
  }
}
