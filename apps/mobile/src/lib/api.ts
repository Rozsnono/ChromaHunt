/**
 * The app wide API client. A module level singleton, so every screen shares one single-flight
 * token refresh; sign-out events (revoked or expired session) are broadcast to subscribers.
 */
import { ApiClient } from './api-core';
import { API_URL } from './config';
import { getDeviceId, tokenStore } from './storage';

const signedOutListeners = new Set<() => void>();

export const api = new ApiClient({
  baseUrl: API_URL,
  tokens: tokenStore,
  deviceId: getDeviceId,
  onSignedOut: () => signedOutListeners.forEach((listener) => listener()),
});

/** Subscribes to forced sign-outs; returns the unsubscribe function. */
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}
