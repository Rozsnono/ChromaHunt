/**
 * Minimal WebDAV client (PUT / GET / DELETE / MKCOL over fetch with Basic auth) so no extra
 * dependency is needed. Works with Nextcloud/ownCloud and plain nginx/Apache DAV.
 */
import { env } from '../env';
import { AppError } from '../errors';
import { errorFields, log } from '../logger';
import type { StorageDriver, StoredObject } from './driver';

const TIMEOUT_MS = 8000;

export class WebDavStorage implements StorageDriver {
  private readonly ensured = new Set<string>();

  private url(key: string): string {
    const { WEBDAV_BASE_PATH } = env();
    const WEBDAV_URL = this.baseUrl();
    const path = [WEBDAV_BASE_PATH, key]
      .join('/')
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/');
    return `${WEBDAV_URL}/${path}`;
  }

  private baseUrl(): string {
    const url = env().WEBDAV_URL;
    if (!url) throw new Error('WEBDAV_URL is not configured');
    return url.replace(/\/+$/, '');
  }

  private authHeader(): string {
    const { WEBDAV_USERNAME, WEBDAV_PASSWORD } = env();
    return `Basic ${Buffer.from(`${WEBDAV_USERNAME ?? ''}:${WEBDAV_PASSWORD ?? ''}`).toString('base64')}`;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: this.authHeader() },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      log.error('webdav request failed', { method: init.method, ...errorFields(error) });
      throw unavailable();
    }
  }

  /** Creates every missing parent collection of `key` (MKCOL is idempotent: 405 = exists). */
  private async ensureParents(key: string): Promise<void> {
    const segments = [env().WEBDAV_BASE_PATH, ...key.split('/')].join('/').split('/').filter(Boolean);
    segments.pop(); // the object itself
    let current = '';
    for (const segment of segments) {
      current = `${current}/${segment}`;
      if (this.ensured.has(current)) continue;
      const res = await this.request(`${this.baseUrl()}${current
        .split('/')
        .map((s) => (s ? encodeURIComponent(s) : s))
        .join('/')}`, { method: 'MKCOL' });
      if (![201, 301, 405].includes(res.status) && !res.ok) throw unavailable();
      this.ensured.add(current);
    }
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    const send = () =>
      this.request(this.url(key), { method: 'PUT', body: Buffer.from(data), headers: { 'Content-Type': contentType } });
    let res = await send();
    if (res.status === 409 || res.status === 404) {
      await this.ensureParents(key);
      res = await send();
    }
    if (!res.ok) {
      log.error('webdav put rejected', { status: res.status });
      throw unavailable();
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    const res = await this.request(this.url(key), { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok || !res.body) throw unavailable();
    const length = res.headers.get('content-length');
    return {
      body: res.body,
      size: length ? Number(length) : null,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  async read(key: string): Promise<Uint8Array | null> {
    const object = await this.get(key);
    if (!object) return null;
    return new Uint8Array(await new Response(object.body).arrayBuffer());
  }

  async remove(key: string): Promise<void> {
    const res = await this.request(this.url(key), { method: 'DELETE' });
    if (res.status === 404 || res.ok) return;
    log.error('webdav delete rejected', { status: res.status });
    throw unavailable();
  }
}

/** Storage outage: tell the client to retry later (its offline queue keeps the photo). */
function unavailable(): AppError {
  return new AppError('SERVICE_UNAVAILABLE', 503, {}, { 'Retry-After': '30' });
}
