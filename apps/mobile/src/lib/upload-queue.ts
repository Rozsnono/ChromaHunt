/**
 * Persistent offline upload queue (SQLite + files in the app's document directory).
 * Photos captured offline survive app restarts and are uploaded when connectivity returns,
 * but only while the day's deadline has not passed; expired photos are discarded with a notice.
 *
 * Pipeline per photo: intent (idempotency key) -> PUT -> finalize. Every step is safe to repeat.
 */
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as Network from 'expo-network';
import * as SQLite from 'expo-sqlite';
import { api } from './api';
import { ApiError } from './api-core';
import { decide, isExpired, type DropReason } from './queue-rules';

export type QueueState = 'queued' | 'done' | 'dropped';

export interface QueueItem {
  id: string;
  groupId: string;
  assignmentId: string;
  deadlineAt: number;
  fileUri: string;
  capturedAt: string;
  clientScore: number | null;
  idempotencyKey: string;
  state: QueueState;
  attempts: number;
  nextAttemptAt: number;
  /** `accepted` / `rejected` once verified, or the drop reason. */
  outcome: string | null;
  createdAt: number;
}

interface Row {
  id: string;
  group_id: string;
  assignment_id: string;
  deadline_at: number;
  file_uri: string;
  captured_at: string;
  client_score: number | null;
  idempotency_key: string;
  state: QueueState;
  attempts: number;
  next_attempt_at: number;
  outcome: string | null;
  created_at: number;
}

const toItem = (r: Row): QueueItem => ({
  id: r.id,
  groupId: r.group_id,
  assignmentId: r.assignment_id,
  deadlineAt: r.deadline_at,
  fileUri: r.file_uri,
  capturedAt: r.captured_at,
  clientScore: r.client_score,
  idempotencyKey: r.idempotency_key,
  state: r.state,
  attempts: r.attempts,
  nextAttemptAt: r.next_attempt_at,
  outcome: r.outcome,
  createdAt: r.created_at,
});

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
function db(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const database = await SQLite.openDatabaseAsync('uploads.db');
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS uploads (
        id TEXT PRIMARY KEY NOT NULL,
        group_id TEXT NOT NULL,
        assignment_id TEXT NOT NULL,
        deadline_at INTEGER NOT NULL,
        file_uri TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        client_score REAL,
        idempotency_key TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        outcome TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS uploads_state ON uploads (state, next_attempt_at);
    `);
    return database;
  })();
  return dbPromise;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Subscribes to queue changes (used by `useUploadQueue`). */
export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function listQueue(): Promise<QueueItem[]> {
  const rows = await (await db()).getAllAsync<Row>('SELECT * FROM uploads ORDER BY created_at DESC LIMIT 50');
  return rows.map(toItem);
}

function removeFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    /* already gone */
  }
}

export interface EnqueueInput {
  groupId: string;
  assignmentId: string;
  deadlineAt: number;
  /** A processed JPEG (resized, no EXIF) in the cache directory. */
  sourceUri: string;
  capturedAt: string;
  clientScore: number | null;
}

/** Stores the photo durably and schedules it for upload right away. */
export async function enqueuePhoto(input: EnqueueInput): Promise<QueueItem> {
  const id = Crypto.randomUUID();
  const dir = new Directory(Paths.document, 'uploads');
  dir.create({ intermediates: true, idempotent: true });
  const target = new File(dir, `${id}.jpg`);
  // `copy` is asynchronous: the source must not be deleted before it has finished.
  await new File(input.sourceUri).copy(target, { overwrite: true });
  removeFile(input.sourceUri);
  const now = Date.now();
  await (await db()).runAsync(
    `INSERT INTO uploads (id, group_id, assignment_id, deadline_at, file_uri, captured_at, client_score, idempotency_key, state, attempts, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, 0, ?)`,
    [id, input.groupId, input.assignmentId, input.deadlineAt, target.uri, input.capturedAt, input.clientScore, Crypto.randomUUID(), now],
  );
  notify();
  void processQueue();
  return (await listQueue()).find((q) => q.id === id) as QueueItem;
}

interface IntentResult {
  submissionId: string;
  status: string;
  uploadToken: string | null;
}
interface FinalizeResult {
  status: 'accepted' | 'rejected' | 'pending_verification' | 'awaiting_upload' | 'deleted';
}

async function uploadOne(item: QueueItem): Promise<'accepted' | 'rejected'> {
  const blob = await (await fetch(item.fileUri)).blob();
  const intent = await api.request<IntentResult>(`/api/groups/${item.groupId}/uploads/intent`, {
    body: {
      idempotencyKey: item.idempotencyKey,
      sizeBytes: blob.size,
      contentType: 'image/jpeg',
      capturedAt: item.capturedAt,
      ...(item.clientScore === null ? {} : { clientColorScore: Math.round(item.clientScore) }),
    },
  });
  // A token is only handed out while the server still waits for the bytes (resumed retries).
  if (intent.uploadToken) {
    await api.request(`/api/uploads/${intent.submissionId}`, {
      method: 'PUT',
      raw: blob,
      headers: { 'Content-Type': 'image/jpeg', 'X-Upload-Token': intent.uploadToken },
    });
  }
  const result = await api.request<FinalizeResult>(`/api/submissions/${intent.submissionId}/finalize`, { method: 'POST' });
  if (result.status === 'accepted' || result.status === 'rejected') return result.status;
  throw new ApiError('SERVICE_UNAVAILABLE', 503); // still verifying: try again shortly
}

async function finish(id: string, state: QueueState, outcome: string, fileUri: string): Promise<void> {
  await (await db()).runAsync('UPDATE uploads SET state = ?, outcome = ? WHERE id = ?', [state, outcome, id]);
  removeFile(fileUri);
}

let running = false;

/** Uploads every due photo. Safe to call from anywhere and as often as needed (single flight). */
export async function processQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const database = await db();
    const now = Date.now();
    const due = await database.getAllAsync<Row>("SELECT * FROM uploads WHERE state = 'queued' AND next_attempt_at <= ? ORDER BY created_at", [now]);
    for (const row of due) {
      const item = toItem(row);
      if (isExpired(item.deadlineAt, Date.now())) {
        await finish(item.id, 'dropped', 'expired' satisfies DropReason, item.fileUri);
        continue;
      }
      const network = await Network.getNetworkStateAsync().catch(() => null);
      if (network && network.isConnected === false) break; // offline: wait for the connectivity listener
      try {
        await finish(item.id, 'done', await uploadOne(item), item.fileUri);
      } catch (error) {
        const apiError = error instanceof ApiError ? error : new ApiError('NETWORK', 0);
        const decision = decide(apiError, item.attempts, Date.now(), item.deadlineAt);
        if (decision.kind === 'drop') await finish(item.id, 'dropped', decision.reason, item.fileUri);
        else if (decision.kind === 'retry') {
          await database.runAsync('UPDATE uploads SET attempts = attempts + 1, next_attempt_at = ? WHERE id = ?', [Date.now() + decision.delayMs, item.id]);
        } else break; // paused until the next sign-in
      }
      notify();
    }
  } finally {
    running = false;
    notify();
  }
}

/** Removes finished entries older than a day (keeps the list tidy). */
export async function purgeOldItems(): Promise<void> {
  await (await db()).runAsync("DELETE FROM uploads WHERE state != 'queued' AND created_at < ?", [Date.now() - 24 * 3600_000]);
  notify();
}

/** Forgets everything (sign-out / account deletion): photos must not outlive the session. */
export async function clearQueue(): Promise<void> {
  const database = await db();
  const rows = await database.getAllAsync<Row>('SELECT file_uri FROM uploads');
  rows.forEach((r) => removeFile(r.file_uri));
  await database.runAsync('DELETE FROM uploads');
  notify();
}
