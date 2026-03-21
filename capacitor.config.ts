import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nyptid.ncore',
  appName: 'NCore',
  // Mobile builds use dist-mobile so desktop update binaries are excluded.
  webDir: process.env.CAPACITOR_WEB_DIR ?? 'dist'
};

export default config;
