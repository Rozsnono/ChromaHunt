/**
 * Storage driver for the "Synology WebDAV Chunked Uploader API" (x-api-key header):
 *   upload   POST /upload/start -> POST /upload/chunk (multipart) -> POST /upload/finish
 *   download GET  /download?path=...
 *   delete   DELETE /files?path=...        (200 deleted, 404 already gone)
 *
 * Paths are RELATIVE to the API key's folder (the uploader scopes a key to its folder and
 * rejects anything outside it); `FILESHARER_BASE_PATH` is an optional sub-directory below it.
 *
 * Photos are at most 4 MB, so every upload is one chunk. Logical storage keys
 * (`groups/<g>/<a>/<s>.jpg`) are mapped to flat file names inside one base directory, because the
 * uploader's handling of nested directories is not guaranteed.
 */
import { env } from '../env';
import { AppError } from '../errors';
import { errorFields, log } from '../logger';
import type { StorageDriver, StoredObject } from './driver';

const TIMEOUT_MS = 20_000;

/** `groups/a/b/c.jpg` -> `groups__a__b__c.jpg` (no separators, no traversal). */
export function flatName(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]+/g, '__');
}

export class FileSharerStorage implements StorageDriver {
  private base(): string {
    const url = env().FILESHARER_URL;
    if (!url) throw new Error('FILESHARER_URL is not configured');
    return url.replace(/\/+$/, '');
  }

  /** Sub-directory below the key folder, without slashes at the ends ('' = the key folder itself). */
  private dir(): string {
    return env().FILESHARER_BASE_PATH.replace(/^\/+|\/+$/g, '');
  }

  private path(key: string): string {
    return this.dir() ? `${this.dir()}/${flatName(key)}` : flatName(key);
  }

  private async call(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.base()}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), 'x-api-key': env().FILESHARER_API_KEY ?? '' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      log.error('file sharer request failed', { path: path.split('?')[0], ...errorFields(error) });
      throw unavailable();
    }
  }

  private async json<T>(path: string, body: unknown): Promise<T> {
    const res = await this.call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      log.error('file sharer rejected request', { path, status: res.status });
      throw unavailable();
    }
    return (await res.json()) as T;
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    const filename = flatName(key);
    const targetPath = this.dir() || undefined; // undefined = the key folder
    const start = await this.json<{ uploadId: string }>('/upload/start', { filename, fileSize: data.byteLength, totalChunks: 1, targetPath });
    try {
      const form = new FormData();
      form.append('uploadId', start.uploadId);
      form.append('chunkIndex', '0');
      form.append('totalChunks', '1');
      form.append('filename', filename);
      form.append('file', new Blob([Buffer.from(data)], { type: contentType }), filename);
      const chunk = await this.call('/upload/chunk', { method: 'POST', body: form });
      if (!chunk.ok) throw unavailable();
      await this.json('/upload/finish', { uploadId: start.uploadId, totalChunks: 1, filename, targetPath });
    } catch (error) {
      // Clean the staging directory of the failed session; never mask the original error.
      await this.json('/upload/failed', { uploadId: start.uploadId, filename }).catch(() => undefined);
      throw error;
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    const res = await this.call(`/download?path=${encodeURIComponent(this.path(key))}`, { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok || !res.body) throw unavailable();
    const length = res.headers.get('content-length');
    return { body: res.body, size: length ? Number(length) : null, contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
  }

  async read(key: string): Promise<Uint8Array | null> {
    const object = await this.get(key);
    return object ? new Uint8Array(await new Response(object.body).arrayBuffer()) : null;
  }

  async remove(key: string): Promise<void> {
    const res = await this.call(`/files?path=${encodeURIComponent(this.path(key))}`, { method: 'DELETE' });
    if (res.ok || res.status === 404) return; // already gone
    // 403 (outside the key folder) and 409 (a folder) are configuration errors worth an alert, not a retry loop.
    log.error('file sharer delete rejected', { status: res.status });
    throw unavailable();
  }
}

function unavailable(): AppError {
  return new AppError('SERVICE_UNAVAILABLE', 503, {}, { 'Retry-After': '30' });
}
