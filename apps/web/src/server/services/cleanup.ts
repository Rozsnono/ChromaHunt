/**
 * Storage cleanup helpers. A MongoDB transaction cannot include WebDAV, so objects that must
 * disappear are first recorded in an outbox (`StorageDeletionTask`) in the same transaction as
 * the database change, then deleted right after commit and retried by the cron tick.
 */
import type { ClientSession, Types } from 'mongoose';
import { audit, SYSTEM_ACTOR } from '../audit';
import { errorFields, log } from '../logger';
import { DailyPoint, JoinRequest, StorageDeletionTask, Submission, WeeklyScore } from '../models';
import { storage } from '../storage/driver';

const MAX_ATTEMPTS = 5;

export async function queueStorageDeletion(keys: string[], session?: ClientSession): Promise<void> {
  if (keys.length === 0) return;
  await StorageDeletionTask.bulkWrite(
    keys.map((storageKey) => ({
      updateOne: { filter: { storageKey }, update: { $setOnInsert: { storageKey, nextAttemptAt: new Date() } }, upsert: true },
    })),
    { session },
  );
}

/** Tries to delete one queued object; success removes the task, failure schedules a retry. */
async function attempt(storageKey: string): Promise<boolean> {
  try {
    await storage().remove(storageKey);
    await StorageDeletionTask.deleteOne({ storageKey });
    return true;
  } catch (error) {
    const task = await StorageDeletionTask.findOneAndUpdate(
      { storageKey },
      {
        $inc: { attempts: 1 },
        lastError: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
        nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000),
      },
      { returnDocument: 'after' },
    ).lean();
    log.warn('storage deletion failed', { attempts: task?.attempts, ...errorFields(error) });
    if (task?.attempts === MAX_ATTEMPTS) {
      await audit({
        actor: SYSTEM_ACTOR,
        action: 'storage.cleanup_failing',
        targetType: 'storage',
        metadata: { severity: 'alert', attempts: task.attempts },
      });
    }
    return false;
  }
}

/** Deletes the given queued keys now (called right after a transaction commits). */
export async function flushStorageDeletions(keys: string[]): Promise<void> {
  for (const key of keys) await attempt(key);
}

/** Cron: retries due outbox tasks. Returns how many objects were removed. */
export async function drainDeletionOutbox(now = new Date(), limit = 100): Promise<number> {
  const tasks = await StorageDeletionTask.find({ nextAttemptAt: { $lte: now } }).limit(limit).lean();
  let removed = 0;
  for (const task of tasks) if (await attempt(task.storageKey)) removed++;
  return removed;
}

/**
 * Removes a user's photos, points and pending join requests, either within one group
 * (leaving / being removed) or everywhere (`groupId` undefined). Returns the queued keys.
 */
export async function purgeUserContent(
  userId: Types.ObjectId,
  options: { groupId?: Types.ObjectId; session?: ClientSession } = {},
): Promise<string[]> {
  const { groupId, session } = options;
  const scope = groupId ? { userId, groupId } : { userId };
  const submissions = await Submission.find({ ...scope, storageKey: { $ne: null } })
    .select('storageKey')
    .session(session ?? null)
    .lean();
  const keys = submissions.map((s) => s.storageKey as string);
  await queueStorageDeletion(keys, session);
  await Submission.deleteMany(scope, { session });
  await DailyPoint.deleteMany(scope, { session });
  await WeeklyScore.deleteMany(scope, { session });
  await JoinRequest.deleteMany({ ...scope, status: 'pending' }, { session });
  return keys;
}
