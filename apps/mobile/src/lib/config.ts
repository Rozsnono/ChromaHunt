import Constants from 'expo-constants';

/** Public URL of the deployed backend (not a secret). */
const PRODUCTION_API_URL = 'https://apichromahunt.vercel.app';

/**
 * Backend base URL from the environment (`EXPO_PUBLIC_API_URL`, exposed through app.config.ts).
 * Without it, debug builds use the Android emulator's alias of the development machine and
 * release builds use the production backend.
 */
export const API_URL: string = (
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  process.env.EXPO_PUBLIC_API_URL ??
  (__DEV__ ? 'http://10.0.2.2:3000' : PRODUCTION_API_URL)
).replace(/\/+$/, '');

export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';
