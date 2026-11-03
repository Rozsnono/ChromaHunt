import type { ExpoConfig } from 'expo/config';

/**
 * Expo configuration. Environment specific values come from the environment, never from code:
 *  - EXPO_PUBLIC_API_URL  base URL of the ChromaHunt backend (https in production)
 *  - GOOGLE_SERVICES_JSON path to the Firebase `google-services.json` (needed for push on Android)
 *  - EAS_PROJECT_ID       project id printed by `eas init` (needed for push tokens)
 */
const config: ExpoConfig = {
  name: 'ChromaHunt',
  slug: 'chromahunt',
  scheme: 'chromahunt',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  android: {
    package: 'hu.chromahunt.app',
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#4f46e5' },
    permissions: ['CAMERA', 'POST_NOTIFICATIONS', 'USE_BIOMETRIC', 'USE_FINGERPRINT'],
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON,
    // Gallery access is intentionally never requested: photos are live capture only.
    blockedPermissions: ['READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO'],
  },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 200, resizeMode: 'contain', backgroundColor: '#4f46e5' }],
    'expo-secure-store',
    'expo-sqlite',
    'expo-localization',
    ['expo-camera', { cameraPermission: 'ChromaHunt needs the camera to photograph the daily color.', recordAudioAndroid: false }],
    ['expo-notifications', { icon: './assets/notification-icon.png', color: '#4f46e5' }],
    ['expo-local-authentication', { faceIDPermission: 'Unlock ChromaHunt with biometrics.' }],
    'expo-background-task',
  ],
  // `eas.projectId` is created by `eas init` (not a secret); push token registration needs it.
  extra: { apiUrl: process.env.EXPO_PUBLIC_API_URL, eas: { projectId: process.env.EAS_PROJECT_ID } },
};

export default config;
