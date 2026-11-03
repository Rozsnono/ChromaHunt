/**
 * Object storage abstraction. Production uses the file sharer uploader API (or plain WebDAV); tests swap in an in-memory driver.
 * Storage keys and credentials never leave the server.
 */
import { env } from '../env';
import { FileSharerStorage } from './filesharer';
import { FsStorage } from './fs';
import { WebDavStorage } from './webdav';

export interface StoredObject {
  body: ReadableStream<Uint8Array>;
  size: number | null;
  contentType: string;
}

export interface StorageDriver {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  /** Returns null when the object does not exist. */
  get(key: string): Promise<StoredObject | null>;
  /** Reads a whole object into memory (used by the verifier). Null when missing. */
  read(key: string): Promise<Uint8Array | null>;
  /** Idempotent: a missing object is not an error. */
  remove(key: string): Promise<void>;
}

let driver: StorageDriver | undefined;

export function storage(): StorageDriver {
  if (!driver) {
    const kind = env().STORAGE_DRIVER;
    driver = kind === 'fs' ? new FsStorage(env().LOCAL_STORAGE_DIR) : kind === 'webdav' ? new WebDavStorage() : new FileSharerStorage();
  }
  return driver;
}

/** Test seam. */
export function setStorageDriver(next: StorageDriver | undefined): void {
  driver = next;
}
