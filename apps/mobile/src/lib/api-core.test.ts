import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, type TokenStore } from './api-core';
import type { Tokens } from './types';

function memoryTokens(initial: Tokens | null): TokenStore & { current: Tokens | null } {
  const store = {
    current: initial,
    load: async () => store.current,
    save: async (t: Tokens) => void (store.current = t),
    clear: async () => void (store.current = null),
  };
  return store;
}

const envelope = (data: unknown) => new Response(JSON.stringify({ success: true, data, error: null, meta: { requestId: 'r' } }), { status: 200 });
const failure = (status: number, code: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ success: false, data: null, error: { code, details: {} }, meta: { requestId: 'r' } }), { status, headers });

const tokens = (n: number): Tokens => ({ accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresIn: 900 });

function client(fetchImpl: typeof fetch, store: TokenStore, onSignedOut = vi.fn()) {
  return { api: new ApiClient({ baseUrl: 'https://api.test', tokens: store, deviceId: async () => 'device-1', onSignedOut, fetchImpl }), onSignedOut };
}

describe('ApiClient', () => {
  it('unwraps the envelope and sends the bearer token', async () => {
    const fetchMock = vi.fn(async () => envelope({ hello: 'world' }));
    const { api } = client(fetchMock as unknown as typeof fetch, memoryTokens(tokens(1)));
    expect(await api.request('/api/me')).toEqual({ hello: 'world' });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
  });

  it('maps error envelopes, Retry-After and network failures', async () => {
    const { api } = client(vi.fn(async () => failure(429, 'RATE_LIMITED', { 'retry-after': '12' })) as unknown as typeof fetch, memoryTokens(null));
    const error = await api.request('/x', { auth: false }).catch((e: ApiError) => e);
    expect(error).toMatchObject({ code: 'RATE_LIMITED', status: 429, retryAfterSec: 12, isTransient: true });

    const offline = client(vi.fn(async () => Promise.reject(new TypeError('Network request failed'))) as unknown as typeof fetch, memoryTokens(null));
    expect(await offline.api.request('/x', { auth: false }).catch((e: ApiError) => e)).toMatchObject({ code: 'NETWORK', status: 0, isTransient: true });
  });

  it('refreshes an expired access token once and retries the request', async () => {
    const store = memoryTokens(tokens(1));
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/auth/refresh')) return envelope({ user: {}, tokens: tokens(2) });
      const bearer = (init?.headers as Record<string, string>).Authorization;
      return bearer === 'Bearer access-2' ? envelope({ ok: true }) : failure(401, 'UNAUTHENTICATED');
    });
    const { api } = client(fetchMock as unknown as typeof fetch, store);
    expect(await api.request('/api/me')).toEqual({ ok: true });
    expect(store.current).toEqual(tokens(2));
  });

  it('shares ONE refresh between concurrent requests (the server rotates on every use)', async () => {
    const store = memoryTokens(tokens(1));
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/auth/refresh')) {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 10));
        return envelope({ user: {}, tokens: tokens(2) });
      }
      return (init?.headers as Record<string, string>).Authorization === 'Bearer access-2' ? envelope({ ok: true }) : failure(401, 'UNAUTHENTICATED');
    });
    const { api } = client(fetchMock as unknown as typeof fetch, store);
    const results = await Promise.all([api.request('/a'), api.request('/b'), api.request('/c')]);
    expect(results).toHaveLength(3);
    expect(refreshCalls).toBe(1);
  });

  it('signs out when the refresh token is rejected', async () => {
    const store = memoryTokens(tokens(1));
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/api/auth/refresh') ? failure(401, 'TOKEN_REUSE_DETECTED') : failure(401, 'UNAUTHENTICATED'),
    );
    const { api, onSignedOut } = client(fetchMock as unknown as typeof fetch, store);
    await expect(api.request('/api/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(store.current).toBeNull();
  });

  it('keeps the session when the refresh fails only because the network is down', async () => {
    const store = memoryTokens(tokens(1));
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/auth/refresh')) throw new TypeError('offline');
      return failure(401, 'UNAUTHENTICATED');
    });
    const { api, onSignedOut } = client(fetchMock as unknown as typeof fetch, store);
    await expect(api.request('/api/me')).rejects.toBeInstanceOf(ApiError);
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(store.current).toEqual(tokens(1));
  });

  it('authenticate stores the returned tokens and adds the device id', async () => {
    const store = memoryTokens(null);
    const fetchMock = vi.fn(async () => envelope({ user: { id: 'u' }, tokens: tokens(5) }));
    const { api } = client(fetchMock as unknown as typeof fetch, store);
    await api.authenticate('/api/auth/login', { email: 'a@b.hu', password: 'x' });
    expect(store.current).toEqual(tokens(5));
    const body = JSON.parse(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string));
    expect(body).toMatchObject({ email: 'a@b.hu', deviceId: 'device-1' });
  });

  it('signOut clears tokens locally even if the server call fails', async () => {
    const store = memoryTokens(tokens(1));
    const { api } = client(vi.fn(async () => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch, store);
    await api.signOut();
    expect(store.current).toBeNull();
  });
});
