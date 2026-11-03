/**
 * Retention cleanup and housekeeping. Expired photos are deleted from storage and their
 * records are marked `deleted`. Failed deletions are marked `cleanup_pending` and retried on
 * the next run; an alert is logged after repeated failures.
 */
import { audit, SYSTEM_ACTOR } from '../audit';
import { errorFields, log } from '../logger';
import { Group, Submission } from '../models';
import { storage } from '../storage/driver';
import { drainDeletionOutbox } from './cleanup';
import { getGlobalSettings, resolveSettings } from './settings';

const MAX_FAILURES = 5;
const BATCH = 200;

export interface RetentionReport {
  deleted: number;
  failed: number;
  orphansRemoved: number;
  outboxRemoved: number;
}

async function deleteSubmissionObject(id: string, key: string | null, reason: string): Promise<boolean> {
  try {
    if (key) await storage().remove(key);
    await Submission.updateOne(
      { _id: id },
      { status: 'deleted', storageKey: null, deletedAt: new Date(), deletedReason: reason, cleanupState: 'none' },
    );
    return true;
  } catch (error) {
    const updated = await Submission.findOneAndUpdate(
      { _id: id },
      { cleanupState: 'cleanup_pending', $inc: { cleanupFailures: 1 } },
      { returnDocument: 'after' },
    ).lean();
    log.warn('retention cleanup failed for one object', errorFields(error));
    if (updated?.cleanupFailures === MAX_FAILURES) {
      await audit({
        actor: SYSTEM_ACTOR,
        action: 'retention.cleanup_failing',
        targetType: 'submission',
        targetId: id,
        metadata: { severity: 'alert', failures: updated.cleanupFailures },
      });
    }
    return false;
  }
}

export async function runRetentionCleanup(now = new Date(), options: { groupId?: string } = {}): Promise<RetentionReport> {
  const report: RetentionReport = { deleted: 0, failed: 0, orphansRemoved: 0, outboxRemoved: 0 };
  const global = await getGlobalSettings();
  const groups = await Group.find(options.groupId ? { _id: options.groupId } : {}).lean();

  for (const group of groups) {
    const { retentionDays } = resolveSettings(group, global);
    const cutoff = new Date(now.getTime() - retentionDays * 86400000);
    const expired = await Submission.find({
      groupId: group._id,
      status: { $in: ['accepted', 'pending_verification'] },
      uploadedAt: { $lt: cutoff },
    })
      .select('_id storageKey')
      .limit(BATCH)
      .lean();
    const retry = await Submission.find({ groupId: group._id, cleanupState: 'cleanup_pending', status: { $ne: 'deleted' } })
      .select('_id storageKey')
      .limit(BATCH)
      .lean();
    const seen = new Set<string>();
    for (const s of [...expired, ...retry]) {
      if (seen.has(String(s._id))) continue;
      seen.add(String(s._id));
      if (await deleteSubmissionObject(String(s._id), s.storageKey, 'retention')) report.deleted++;
      else report.failed++;
    }
  }

  // Intents that never received their upload (app killed, offline too long).
  const stale = await Submission.find({ status: 'awaiting_upload', createdAt: { $lt: new Date(now.getTime() - 3600_000) } })
    .select('_id groupId assignmentId')
    .limit(BATCH)
    .lean();
  for (const s of stale) {
    // An object may exist if the process died between the storage write and the status update.
    try {
      await storage().remove(`groups/${s.groupId}/${s.assignmentId}/${s._id}.jpg`);
      await Submission.deleteOne({ _id: s._id, status: 'awaiting_upload' });
      report.orphansRemoved++;
    } catch (error) {
      log.warn('could not sweep stale upload intent', errorFields(error));
    }
  }

  report.outboxRemoved = await drainDeletionOutbox(now);
  return report;
}
