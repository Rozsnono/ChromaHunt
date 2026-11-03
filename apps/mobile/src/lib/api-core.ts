/**
 * Platform independent API client. Handles the response envelope, bearer authentication,
 * single-flight token refresh with one retry, and normalised errors. Storage and the device id
 * are injected so the logic can be unit tested without React Native.
 */
import type { AuthResult, Tokens } from './types';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
    /** Seconds from the `Retry-After` header (429 / 503), if any. */
    public readonly retryAfterSec: number | null = null,
  ) {
    super(code);
    this.name = 'ApiError';
  }

  /** True for failures that are worth retrying later (offline, server hiccup, rate limit). */
  get isTransient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface TokenStore {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  deviceId: () => Promise<string>;
  /** Called when the session can no longer be refreshed (revoked, reused, expired). */
  onSignedOut: () => void;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Send the bearer token (default true). */
  auth?: boolean;
  headers?: Record<string, string>;
  /** Raw request body (e.g. the JPEG bytes). */
  raw?: BodyInit;
  signal?: AbortSignal;
}

interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; details?: Record<string, unknown> } | null;
}

export class ApiClient {
  private refreshing: Promise<boolean> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request<T>(path: string, init: RequestOptions = {}): Promise<T> {
    const first = await this.send<T>(path, init);
    if (first.ok) return first.data;
    // An expired access token: refresh once (shared by concurrent callers) and retry.
    if (init.auth !== false && first.error.status === 401 && first.error.code === 'UNAUTHENTICATED') {
      if (await this.refresh()) {
        const second = await this.send<T>(path, init);
        if (second.ok) return second.data;
        throw second.error;
      }
    }
    throw first.error;
  }

  /** Login-like calls: send credentials, store the returned tokens. */
  async authenticate(path: string, body: Record<string, unknown>): Promise<AuthResult> {
    const result = await this.request<AuthResult>(path, { body: { ...body, deviceId: await this.options.deviceId() }, auth: false });
    await this.options.tokens.save(result.tokens);
    return result;
  }

  async signOut(): Promise<void> {
    const tokens = await this.options.tokens.load();
    await this.options.tokens.clear();
    if (tokens) {
      // Best effort: revokes the token family and the biometric binding on the server.
      await this.send('/api/auth/logout', {
        body: { refreshToken: tokens.refreshToken, deviceId: await this.options.deviceId() },
        auth: false,
      }).catch(() => undefined);
    }
  }

  private async send<T>(path: string, init: RequestOptions): Promise<{ ok: true; data: T } | { ok: false; error: ApiError }> {
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers ?? {}) };
    let body: BodyInit | undefined;
    if (init.raw !== undefined) body = init.raw;
    else if (init.body !== undefined) {
      body = JSON.stringify(init.body);
      headers['Content-Type'] = 'application/json';
    }
    if (init.auth !== false) {
      const tokens = await this.options.tokens.load();
      if (tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.options.baseUrl + path, {
        method: init.method ?? (body !== undefined ? 'POST' : 'GET'),
        headers,
        body,
        signal: init.signal,
      });
    } catch {
      return { ok: false, error: new ApiError('NETWORK', 0) };
    }

    let envelope: Envelope<T> | null = null;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch {
      /* not JSON (proxy error page) */
    }
    if (response.ok && envelope?.success) return { ok: true, data: envelope.data as T };
    const retry = Number(response.headers.get('retry-after'));
    return {
      ok: false,
      error: new ApiError(
        envelope?.error?.code ?? (response.status >= 500 ? 'SERVICE_UNAVAILABLE' : 'UNKNOWN'),
        response.status,
        envelope?.error?.details ?? {},
        Number.isFinite(retry) && retry > 0 ? retry : null,
      ),
    };
  }

  /** Rotates the refresh token. Concurrent callers share one request (the server rotates on every use). */
  private refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const current = await this.options.tokens.load();
    if (!current) {
      this.options.onSignedOut();
      return false;
    }
    const result = await this.send<AuthResult>('/api/auth/refresh', {
      body: { refreshToken: current.refreshToken, deviceId: await this.options.deviceId() },
      auth: false,
    });
    if (result.ok) {
      await this.options.tokens.save(result.data.tokens);
      return true;
    }
    // Offline or a server hiccup must not sign the user out; a definitive rejection does.
    if (!result.error.isTransient) {
      await this.options.tokens.clear();
      this.options.onSignedOut();
    }
    return false;
  }
}
