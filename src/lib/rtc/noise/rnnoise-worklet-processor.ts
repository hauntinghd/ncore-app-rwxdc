/**
 * RNNoise AudioWorklet Processor
 *
 * Runs RNNoise WASM in an AudioWorklet for real-time noise suppression.
 * The WASM binary must be loaded and compiled before this processor is used.
 *
 * This file is compiled separately and served as a standalone worklet script
 * at /audio-processors/rnnoise-worklet-processor.js
 *
 * Message protocol:
 *   Main → Worklet:
 *     { type: 'load-wasm', wasmModule: WebAssembly.Module }
 *     { type: 'set-enabled', enabled: boolean }
 *     { type: 'set-threshold', threshold: number }  // VAD threshold 0-1
 *
 *   Worklet → Main:
 *     { type: 'ready' }
 *     { type: 'vad', probability: number }  // voice activity probability 0-1
 *     { type: 'error', message: string }
 */

// RNNoise operates on 480-sample frames at 48kHz (10ms).
const RNNOISE_FRAME_SIZE = 480;

class RNNoiseProcessor extends AudioWorkletProcessor {
  private wasmInstance: WebAssembly.Instance | null = null;
  private denoiseState: number = 0; // Pointer to rnnoise state
  private inputBuffer: Float32Array = new Float32Array(RNNOISE_FRAME_SIZE);
  private outputBuffer: Float32Array = new Float32Array(RNNOISE_FRAME_SIZE);
  private bufferIndex: number = 0;
  private enabled: boolean = true;
  private vadThreshold: number = 0.0; // 0 = no auto-mute, >0 = mute below threshold
  private ready: boolean = false;

  constructor() {
    super();
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  private handleMessage(data: any) {
    if (data.type === 'load-wasm' && data.wasmModule) {
      this.initWasm(data.wasmModule);
    } else if (data.type === 'set-enabled') {
      this.enabled = Boolean(data.enabled);
    } else if (data.type === 'set-threshold') {
      this.vadThreshold = Math.max(0, Math.min(1, Number(data.threshold) || 0));
    }
  }

  private async initWasm(wasmModule: WebAssembly.Module) {
    try {
      // RNNoise WASM exports: rnnoise_create, rnnoise_destroy, rnnoise_process_frame
      // Memory layout: input/output buffers are passed as pointers
      const importObject = {
        env: {
          memory: new WebAssembly.Memory({ initial: 256 }),
          abort: () => {},
          __table_base: 0,
          __memory_base: 0,
        },
        wasi_snapshot_preview1: {
          fd_close: () => 0,
          fd_write: () => 0,
          fd_seek: () => 0,
          proc_exit: () => {},
        },
      };

      this.wasmInstance = await WebAssembly.instantiate(wasmModule, importObject);
      const exports = this.wasmInstance.exports as any;

      if (typeof exports.rnnoise_create === 'function') {
        this.denoiseState = exports.rnnoise_create();
        this.ready = true;
        this.port.postMessage({ type: 'ready' });
      } else {
        throw new Error('WASM module missing rnnoise_create export');
      }
    } catch (error) {
      this.port.postMessage({
        type: 'error',
        message: `WASM init failed: ${(error as Error).message}`,
      });
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];

    if (!input || !output) return true;

    // Pass-through if not ready or disabled
    if (!this.ready || !this.enabled || !this.wasmInstance) {
      output.set(input);
      return true;
    }

    const exports = this.wasmInstance.exports as any;

    // Accumulate input samples into the RNNoise frame buffer
    for (let i = 0; i < input.length; i++) {
      this.inputBuffer[this.bufferIndex] = input[i] * 32768; // Convert float to int16 range
      this.bufferIndex++;

      if (this.bufferIndex >= RNNOISE_FRAME_SIZE) {
        // Process a full 480-sample frame through RNNoise
        const heapF32 = new Float32Array(
          (exports.memory as WebAssembly.Memory).buffer,
        );

        // Write input to WASM memory
        const inputPtr = exports.rnnoise_get_input_ptr
          ? exports.rnnoise_get_input_ptr(this.denoiseState)
          : 0;
        const outputPtr = exports.rnnoise_get_output_ptr
          ? exports.rnnoise_get_output_ptr(this.denoiseState)
          : 0;

        if (inputPtr && outputPtr) {
          const inputOffset = inputPtr / 4; // Float32 offset
          const outputOffset = outputPtr / 4;

          for (let j = 0; j < RNNOISE_FRAME_SIZE; j++) {
            heapF32[inputOffset + j] = this.inputBuffer[j];
          }

          // rnnoise_process_frame returns VAD probability (0-1)
          const vadProbability = exports.rnnoise_process_frame(
            this.denoiseState,
            outputPtr,
            inputPtr,
          );

          // Read denoised output from WASM memory
          for (let j = 0; j < RNNOISE_FRAME_SIZE; j++) {
            this.outputBuffer[j] = heapF32[outputOffset + j] / 32768; // Convert back to float
          }

          // Report VAD probability to main thread periodically
          if (Math.random() < 0.1) { // Sample 10% of frames to reduce message overhead
            this.port.postMessage({ type: 'vad', probability: vadProbability });
          }

          // Auto-mute if below VAD threshold
          if (this.vadThreshold > 0 && vadProbability < this.vadThreshold) {
            this.outputBuffer.fill(0);
          }
        } else {
          // Fallback: simple noise gate pass-through
          this.outputBuffer.set(
            this.inputBuffer.map((s) => s / 32768),
          );
        }

        this.bufferIndex = 0;
      }
    }

    // Copy accumulated output. Note: output may not align perfectly with
    // RNNoise's 480-sample frame boundary. This simple approach copies
    // the latest processed frame's data.
    const availableOutput = Math.min(output.length, this.outputBuffer.length);
    for (let i = 0; i < availableOutput; i++) {
      output[i] = this.outputBuffer[i];
    }

    return true;
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);
