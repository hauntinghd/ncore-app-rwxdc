import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const appVersion = process.env.npm_package_version || '0.0.0';
const buildTime = new Date().toISOString();
const isElectronBuild = process.env.NCORE_ELECTRON_BUILD === '1';

function stampPwaAssets(): Plugin {
  return {
    name: 'ncore-stamp-pwa-assets',
    writeBundle(options) {
      const outDir = options.dir ? path.resolve(options.dir) : path.resolve('dist');
      const targets = [path.join(outDir, 'sw.js'), path.join(outDir, 'version.json')];
      for (const target of targets) {
        if (!fs.existsSync(target)) continue;
        const raw = fs.readFileSync(target, 'utf8');
        const stamped = raw
          .replaceAll('__APP_VERSION__', appVersion)
          .replaceAll('__BUILD_TIME__', buildTime);
        fs.writeFileSync(target, stamped, 'utf8');
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  // Electron packaged builds need relative assets (file://).
  // Web/PWA builds must use absolute assets so deep links like /app/dm load correctly.
  base: isElectronBuild ? './' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [react(), stampPwaAssets()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Heavy RTC SDKs — only loaded when user joins a call
            if (id.includes('agora-rtc-sdk-ng') || id.includes('agora-extension-ai-denoiser')) {
              return 'vendor-agora';
            }
            if (id.includes('livekit-client')) {
              return 'vendor-livekit';
            }
            if (id.includes('@supabase/supabase-js') || id.includes('@supabase/realtime') || id.includes('@supabase/postgrest') || id.includes('@supabase/gotrue') || id.includes('@supabase/storage')) {
              return 'vendor-supabase';
            }
            if (id.includes('react-router') || id.includes('react-router-dom')) {
              return 'vendor-router';
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('scheduler')) {
              return 'vendor-react';
            }
            if (id.includes('lucide-react') || id.includes('simple-icons')) {
              return 'vendor-icons';
            }
            if (id.includes('jszip')) {
              return 'vendor-jszip';
            }
          }
          // Split RTC abstraction into its own chunk (loaded on demand)
          if (id.includes('src/lib/rtc/')) {
            return 'rtc-core';
          }
          // Split crypto into its own chunk
          if (id.includes('src/lib/crypto/')) {
            return 'crypto';
          }
          return undefined;
        },
      },
    },
  },
});
