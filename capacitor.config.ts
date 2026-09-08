import type { CapacitorConfig } from '@capacitor/cli';

// The application id is PERMANENT once the first build is uploaded to Google
// Play. Change it here and in android/app/build.gradle (applicationId) before
// that first upload if you want a different one.
const config: CapacitorConfig = {
  appId: 'com.ngdev.forward',
  appName: 'Forward',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
