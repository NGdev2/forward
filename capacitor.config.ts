import type { CapacitorConfig } from '@capacitor/cli';

// NOTE: "com.forward.runner" is a placeholder app id. Before publishing to
// Google Play, pick a real reverse-domain application id that you (or your
// org) actually own, e.g. "com.yourcompany.forward", and update it here.
const config: CapacitorConfig = {
  appId: 'com.forward.runner',
  appName: 'Forward',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
