#!/bin/bash
# ===========================================================================
# Build RNNoise as a WebAssembly module for NCore noise cancellation
#
# Prerequisites:
#   - Docker (for Emscripten build environment)
#   OR
#   - Emscripten SDK installed (https://emscripten.org/docs/getting_started)
#   - autoconf, automake, libtool
#
# Output:
#   ../../public/audio-processors/rnnoise.wasm
#
# Usage:
#   chmod +x build-rnnoise-wasm.sh
#   ./build-rnnoise-wasm.sh
# ===========================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/../../public/audio-processors"
BUILD_DIR="$SCRIPT_DIR/build"

echo "=== NCore RNNoise WASM Build ==="
echo ""

mkdir -p "$BUILD_DIR" "$OUTPUT_DIR"

# ---------------------------------------------------------------------------
# Step 1: Clone RNNoise
# ---------------------------------------------------------------------------
if [ ! -d "$BUILD_DIR/rnnoise" ]; then
  echo "[1/4] Cloning xiph/rnnoise..."
  git clone --depth 1 https://github.com/xiph/rnnoise.git "$BUILD_DIR/rnnoise"
else
  echo "[1/4] RNNoise source already present."
fi

# ---------------------------------------------------------------------------
# Step 2: Build with Docker (Emscripten)
# ---------------------------------------------------------------------------
echo "[2/4] Building with Emscripten via Docker..."

docker run --rm \
  -v "$BUILD_DIR/rnnoise:/src" \
  -v "$OUTPUT_DIR:/output" \
  -w /src \
  emscripten/emsdk:3.1.51 \
  bash -c '
    set -e
    echo "  -> Running autoreconf..."
    ./autogen.sh || autoreconf -fi

    echo "  -> Configuring for Emscripten..."
    emconfigure ./configure \
      --disable-shared \
      --disable-doc \
      --disable-examples \
      --disable-training \
      CFLAGS="-O3 -ffast-math"

    echo "  -> Building..."
    emmake make clean 2>/dev/null || true
    emmake make -j$(nproc)

    echo "  -> Compiling to WASM..."
    emcc \
      -O3 \
      -s WASM=1 \
      -s EXPORTED_FUNCTIONS="[\"_rnnoise_create\",\"_rnnoise_destroy\",\"_rnnoise_process_frame\",\"_rnnoise_get_frame_size\",\"_malloc\",\"_free\"]" \
      -s EXPORTED_RUNTIME_METHODS="[\"cwrap\",\"setValue\",\"getValue\"]" \
      -s ALLOW_MEMORY_GROWTH=1 \
      -s TOTAL_MEMORY=16MB \
      -s MODULARIZE=1 \
      -s EXPORT_NAME="RNNoiseModule" \
      -s ENVIRONMENT="web,worker" \
      -s FILESYSTEM=0 \
      -s SINGLE_FILE=0 \
      --no-entry \
      .libs/librnnoise.a \
      -o /output/rnnoise.js

    echo "  -> Build complete!"
    ls -la /output/rnnoise.*
  '

echo "[3/4] Verifying output files..."
if [ -f "$OUTPUT_DIR/rnnoise.wasm" ]; then
  WASM_SIZE=$(wc -c < "$OUTPUT_DIR/rnnoise.wasm")
  echo "  rnnoise.wasm: ${WASM_SIZE} bytes"
else
  echo "  ERROR: rnnoise.wasm not found!"
  exit 1
fi

if [ -f "$OUTPUT_DIR/rnnoise.js" ]; then
  JS_SIZE=$(wc -c < "$OUTPUT_DIR/rnnoise.js")
  echo "  rnnoise.js: ${JS_SIZE} bytes"
else
  echo "  WARNING: rnnoise.js not found (may be embedded in WASM)"
fi

# ---------------------------------------------------------------------------
# Step 3: Build the AudioWorklet processor
# ---------------------------------------------------------------------------
echo "[4/4] Note: The AudioWorklet processor at"
echo "  src/lib/rtc/noise/rnnoise-worklet-processor.ts"
echo "  needs to be compiled to standalone JS and placed at:"
echo "  public/audio-processors/rnnoise-worklet-processor.js"
echo ""
echo "  Run: npx esbuild src/lib/rtc/noise/rnnoise-worklet-processor.ts \\"
echo "    --bundle --outfile=public/audio-processors/rnnoise-worklet-processor.js \\"
echo "    --format=iife --platform=browser"
echo ""

echo "=== Done! ==="
echo ""
echo "Output files:"
echo "  $OUTPUT_DIR/rnnoise.wasm"
echo "  $OUTPUT_DIR/rnnoise.js"
echo ""
echo "Next steps:"
echo "  1. The WASM + JS files are now in public/audio-processors/"
echo "  2. Build the AudioWorklet processor JS (see command above)"
echo "  3. Set noiseSuppression engine to 'Advanced (AI)' in NCore settings"
