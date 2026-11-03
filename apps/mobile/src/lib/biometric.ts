/**
 * Device-bound biometric sign-in. A random secret is generated on the device and kept in the
 * Keystore (SecureStore with `requireAuthentication`, so reading it prompts the biometric
 * check). The server stores only its HMAC. The password always remains the fallback, and the
 * secret is deleted on logout and on every password change.
 */
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { prefs } from './storage';

const SECRET_KEY = 'ch_biometric_secret';
const ENABLED_PREF = 'ch_biometric_enabled';
const OFFERED_PREF = 'ch_biometric_offered';

export async function isBiometricAvailable(): Promise<boolean> {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  return (await prefs.get(ENABLED_PREF)) === '1';
}

/** Whether the enrollment offer was already shown on this device. */
export async function wasOffered(): Promise<boolean> {
  return (await prefs.get(OFFERED_PREF)) === '1';
}

export async function markOffered(): Promise<void> {
  await prefs.set(OFFERED_PREF, '1');
}

/** Creates the device secret behind a biometric prompt; returns it so it can be enrolled on the server. */
export async function createSecret(promptMessage: string): Promise<string | null> {
  const secret = `${Crypto.randomUUID()}${Crypto.randomUUID()}`.replace(/-/g, '');
  try {
    await SecureStore.setItemAsync(SECRET_KEY, secret, { requireAuthentication: true, authenticationPrompt: promptMessage });
    await prefs.set(ENABLED_PREF, '1');
    return secret;
  } catch {
    return null;
  }
}

/** Reads the secret (shows the biometric prompt). Null when cancelled, missing or invalidated. */
export async function readSecret(promptMessage: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SECRET_KEY, { requireAuthentication: true, authenticationPrompt: promptMessage });
  } catch {
    return null;
  }
}

export async function clearSecret(): Promise<void> {
  await SecureStore.deleteItemAsync(SECRET_KEY).catch(() => undefined);
  await prefs.remove(ENABLED_PREF).catch(() => undefined);
}
