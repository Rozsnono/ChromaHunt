import Constants from 'expo-constants';

/**
 * Backend base URL from the environment (`EXPO_PUBLIC_API_URL`, exposed through app.config.ts).
 * The fallback is the Android emulator's alias of the development machine and is development only.
 */
export const API_URL: string = (
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  process.env.EXPO_PUBLIC_API_URL ??
  'http://10.0.2.2:3000'
).replace(/\/+$/, '');

export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';
