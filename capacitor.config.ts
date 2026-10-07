import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.confusedgame.flicksoccer',
  appName: 'Super Soccer Deluxo',
  webDir: 'dist',
  backgroundColor: '#0d2416',
  server: {
    // Serve from https://localhost so secure-context APIs (audio, storage) behave like the web.
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'never',
    backgroundColor: '#0d2416',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0d2416',
  },
};

export default config;
