(() => {
  // src/lib/rtc/noise/rnnoise-worklet-processor.ts
  var RNNOISE_FRAME_SIZE = 480;
  var RNNoiseProcessor = class extends AudioWorkletProcessor {
    wasmInstance = null;
    denoiseState = 0;
    // Pointer to rnnoise state
    inputBuffer = new Float32Array(RNNOISE_FRAME_SIZE);
    outputBuffer = new Float32Array(RNNOISE_FRAME_SIZE);
    bufferIndex = 0;
    enabled = true;
    vadThreshold = 0;
    // 0 = no auto-mute, >0 = mute below threshold
    ready = false;
    constructor() {
      super();
      this.port.onmessage = (event) => this.handleMessage(event.data);
    }
    handleMessage(data) {
      if (data.type === "load-wasm" && data.wasmModule) {
        this.initWasm(data.wasmModule);
      } else if (data.type === "set-enabled") {
        this.enabled = Boolean(data.enabled);
      } else if (data.type === "set-threshold") {
        this.vadThreshold = Math.max(0, Math.min(1, Number(data.threshold) || 0));
      }
    }
    async initWasm(wasmModule) {
      try {
        const importObject = {
          env: {
            memory: new WebAssembly.Memory({ initial: 256 }),
            abort: () => {
            },
            __table_base: 0,
            __memory_base: 0
          },
          wasi_snapshot_preview1: {
            fd_close: () => 0,
            fd_write: () => 0,
            fd_seek: () => 0,
            proc_exit: () => {
            }
          }
        };
        this.wasmInstance = await WebAssembly.instantiate(wasmModule, importObject);
        const exports = this.wasmInstance.exports;
        if (typeof exports.rnnoise_create === "function") {
          this.denoiseState = exports.rnnoise_create();
          this.ready = true;
          this.port.postMessage({ type: "ready" });
        } else {
          throw new Error("WASM module missing rnnoise_create export");
        }
      } catch (error) {
        this.port.postMessage({
          type: "error",
          message: `WASM init failed: ${error.message}`
        });
      }
    }
    process(inputs, outputs, _parameters) {
      const input = inputs[0]?.[0];
      const output = outputs[0]?.[0];
      if (!input || !output) return true;
      if (!this.ready || !this.enabled || !this.wasmInstance) {
        output.set(input);
        return true;
      }
      const exports = this.wasmInstance.exports;
      for (let i = 0; i < input.length; i++) {
        this.inputBuffer[this.bufferIndex] = input[i] * 32768;
        this.bufferIndex++;
        if (this.bufferIndex >= RNNOISE_FRAME_SIZE) {
          const heapF32 = new Float32Array(
            exports.memory.buffer
          );
          const inputPtr = exports.rnnoise_get_input_ptr ? exports.rnnoise_get_input_ptr(this.denoiseState) : 0;
          const outputPtr = exports.rnnoise_get_output_ptr ? exports.rnnoise_get_output_ptr(this.denoiseState) : 0;
          if (inputPtr && outputPtr) {
            const inputOffset = inputPtr / 4;
            const outputOffset = outputPtr / 4;
            for (let j = 0; j < RNNOISE_FRAME_SIZE; j++) {
              heapF32[inputOffset + j] = this.inputBuffer[j];
            }
            const vadProbability = exports.rnnoise_process_frame(
              this.denoiseState,
              outputPtr,
              inputPtr
            );
            for (let j = 0; j < RNNOISE_FRAME_SIZE; j++) {
              this.outputBuffer[j] = heapF32[outputOffset + j] / 32768;
            }
            if (Math.random() < 0.1) {
              this.port.postMessage({ type: "vad", probability: vadProbability });
            }
            if (this.vadThreshold > 0 && vadProbability < this.vadThreshold) {
              this.outputBuffer.fill(0);
            }
          } else {
            this.outputBuffer.set(
              this.inputBuffer.map((s) => s / 32768)
            );
          }
          this.bufferIndex = 0;
        }
      }
      const availableOutput = Math.min(output.length, this.outputBuffer.length);
      for (let i = 0; i < availableOutput; i++) {
        output[i] = this.outputBuffer[i];
      }
      return true;
    }
  };
  registerProcessor("rnnoise-processor", RNNoiseProcessor);
})();
