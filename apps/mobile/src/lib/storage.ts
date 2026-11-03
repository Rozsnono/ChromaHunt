/**
 * Platform storage: secrets (tokens, device id, biometric secret) live in the Android Keystore
 * backed SecureStore; harmless preferences (language) in the SQLite key-value store.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';
import type { TokenStore } from './api-core';
import type { Tokens } from './types';

const TOKENS_KEY = 'ch_tokens';
const DEVICE_KEY = 'ch_device_id';

export const tokenStore: TokenStore = {
  async load() {
    try {
      const raw = await SecureStore.getItemAsync(TOKENS_KEY);
      return raw ? (JSON.parse(raw) as Tokens) : null;
    } catch {
      return null; // unreadable keystore entry: behave as signed out
    }
  },
  async save(tokens) {
    await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens));
  },
  async clear() {
    await SecureStore.deleteItemAsync(TOKENS_KEY).catch(() => undefined);
  },
};

let cachedDeviceId: string | null = null;

/** Random per-install id. A new install (or new phone) gets a new id, which re-triggers the biometric offer. */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  let id = await SecureStore.getItemAsync(DEVICE_KEY).catch(() => null);
  if (!id) {
    id = Crypto.randomUUID();
    await SecureStore.setItemAsync(DEVICE_KEY, id);
  }
  cachedDeviceId = id;
  return id;
}

export const prefs = {
  get: (key: string): Promise<string | null> => Storage.getItem(key),
  set: (key: string, value: string): Promise<void> => Storage.setItem(key, value),
  remove: (key: string): Promise<void> => Storage.removeItem(key).then(() => undefined),
};
