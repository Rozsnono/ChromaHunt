import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/server/env';
import { FileSharerStorage, flatName } from '@/server/storage/filesharer';

/** In-process fake of the uploader API (including the DELETE extension). */
function fakeServer() {
  const files = new Map<string, Uint8Array>();
  const sessions = new Map<string, { filename: string; targetPath: string; chunk?: Uint8Array }>();
  const calls: string[] = [];
  const handler = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url.pathname}`);
    const headers = init?.headers as Record<string, string>;
    if (headers['x-api-key'] !== 'test-api-key-0123456789') return Response.json({ success: false }, { status: 401 });
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    if (url.pathname === '/upload/start') {
      sessions.set('s1', { filename: body.filename, targetPath: body.targetPath ?? '' });
      return Response.json({ success: true, uploadId: 's1' });
    }
    if (url.pathname === '/upload/chunk') {
      const form = init?.body as FormData;
      sessions.get(String(form.get('uploadId')))!.chunk = new Uint8Array(await (form.get('file') as Blob).arrayBuffer());
      return Response.json({ success: true });
    }
    if (url.pathname === '/upload/finish') {
      const s = sessions.get(body.uploadId)!;
      files.set(s.targetPath ? `${s.targetPath}/${s.filename}` : s.filename, s.chunk!);
      return Response.json({ success: true });
    }
    if (url.pathname === '/upload/failed') return Response.json({ success: true });
    const path = url.searchParams.get('path') ?? '';
    if (url.pathname === '/download') return files.has(path) ? new Response(Buffer.from(files.get(path)!), { headers: { 'content-type': 'image/jpeg' } }) : new Response('', { status: 404 });
    if (url.pathname === '/files' && method === 'DELETE') return files.delete(path) ? Response.json({ success: true }) : Response.json({ success: false }, { status: 404 });
    return new Response('', { status: 404 });
  };
  return { files, calls, handler };
}

describe('FileSharerStorage', () => {
  let server: ReturnType<typeof fakeServer>;
  beforeEach(() => {
    process.env.FILESHARER_URL = 'https://uploader.test';
    process.env.FILESHARER_API_KEY = 'test-api-key-0123456789';
    process.env.FILESHARER_BASE_PATH = 'photos';
    process.env.STORAGE_DRIVER = 'filesharer';
    resetEnvCache();
    server = fakeServer();
    vi.stubGlobal('fetch', vi.fn(server.handler));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.STORAGE_DRIVER = 'fs';
    resetEnvCache();
  });

  const key = 'groups/g1/a1/s1.jpg';
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);

  it('maps logical keys to flat, traversal-free file names', () => {
    expect(flatName(key)).toBe('groups__g1__a1__s1.jpg');
    expect(flatName('../../etc/passwd')).not.toContain('/');
  });

  it('uploads in one chunk (start -> chunk -> finish) and reads the object back', async () => {
    const storage = new FileSharerStorage();
    await storage.put(key, bytes, 'image/jpeg');
    expect(server.calls).toEqual(['POST /upload/start', 'POST /upload/chunk', 'POST /upload/finish']);
    expect([...server.files.keys()]).toEqual(['photos/groups__g1__a1__s1.jpg']); // relative to the key folder, no leading slash
    expect([...(await storage.read(key))!]).toEqual([...bytes]);
    expect((await storage.get(key))?.contentType).toBe('image/jpeg');
  });

  it('stores directly in the key folder when no base path is configured', async () => {
    process.env.FILESHARER_BASE_PATH = '';
    resetEnvCache();
    await new FileSharerStorage().put(key, bytes, 'image/jpeg');
    expect([...server.files.keys()]).toEqual(['groups__g1__a1__s1.jpg']);
  });

  it('returns null for missing objects and treats a repeated delete as success', async () => {
    const storage = new FileSharerStorage();
    expect(await storage.read(key)).toBeNull();
    await storage.put(key, bytes, 'image/jpeg');
    await storage.remove(key);
    expect(server.files.size).toBe(0);
    await expect(storage.remove(key)).resolves.toBeUndefined();
  });

  it('aborts the staging session and reports 503 when the chunk upload fails', async () => {
    const base = server.handler;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => (String(input).includes('/upload/chunk') ? new Response('', { status: 500 }) : base(input, init))));
    await expect(new FileSharerStorage().put(key, bytes, 'image/jpeg')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(server.calls).toContain('POST /upload/failed');
    expect(server.files.size).toBe(0);
  });

  it('maps a wrong API key and network failures to 503 without leaking details', async () => {
    process.env.FILESHARER_API_KEY = 'another-key-0123456789';
    resetEnvCache();
    await expect(new FileSharerStorage().read(key)).rejects.toMatchObject({ status: 503 });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    await expect(new FileSharerStorage().remove(key)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});
