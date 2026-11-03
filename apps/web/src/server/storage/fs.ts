/**
 * Local-disk storage for DEVELOPMENT ONLY (`STORAGE_DRIVER=fs`, refused in production).
 * Lets the whole platform run without a WebDAV server.
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StorageDriver, StoredObject } from './driver';

export class FsStorage implements StorageDriver {
  constructor(private readonly root: string) {}

  /** Resolves a key below the root; path traversal attempts are rejected. */
  private file(key: string): string {
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(path.resolve(this.root) + path.sep)) throw new Error('invalid storage key');
    return resolved;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async read(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.file(key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    const data = await this.read(key);
    if (!data) return null;
    const { size } = await stat(this.file(key));
    return { body: new Response(Buffer.from(data)).body as ReadableStream<Uint8Array>, size, contentType: 'image/jpeg' };
  }

  async remove(key: string): Promise<void> {
    await rm(this.file(key), { force: true });
  }
}
