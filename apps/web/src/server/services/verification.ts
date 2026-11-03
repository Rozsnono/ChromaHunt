/**
 * Authoritative server-side colour verification. The client's own score is never used.
 *
 * The stored (already sanitised) image is downloaded from storage, shrunk to 64x64 (centre
 * crop, mirroring the camera crosshair), clustered with seeded k-means in CIELAB and compared
 * with the assigned colour using CIEDE2000. Rejected photos are deleted from storage at once.
 */
import sharp from 'sharp';
import type { Types } from 'mongoose';
import { evaluateColorMatch } from '@chromahunt/shared';
import { audit, SYSTEM_ACTOR } from '../audit';
import { AppError } from '../errors';
import { errorFields, log } from '../logger';
import { DailyAssignment, Group, Submission, type SubmissionDoc } from '../models';
import { notify } from '../notifications';
import { storage } from '../storage/driver';
import { queueStorageDeletion } from './cleanup';

export const VERIFY_SIZE = 64;
/** Fixed seed: the same image always yields the same score. */
export const VERIFY_SEED = 20240611;

export interface SubmissionView {
  id: string;
  status: SubmissionDoc['status'];
  /** Only exposed for accepted photos; a rejection reveals nothing beyond the fact itself. */
  closenessScore: number | null;
  rejectionReason: string | null;
}

export function toView(s: SubmissionDoc): SubmissionView {
  return {
    id: String(s._id),
    status: s.status,
    closenessScore: s.status === 'accepted' ? Math.round(s.closenessScore ?? 0) : null,
    rejectionReason: s.status === 'rejected' ? s.rejectionReason : null,
  };
}

/** Deletes the stored object of a rejected photo; failures go to the retry outbox. */
async function discardObject(key: string | null): Promise<void> {
  if (!key) return;
  try {
    await storage().remove(key);
  } catch (error) {
    log.warn('could not delete rejected object, queued for retry', errorFields(error));
    await queueStorageDeletion([key]);
  }
}

async function reject(submission: SubmissionDoc, reason: string, scores?: Partial<SubmissionDoc>): Promise<SubmissionDoc | null> {
  const updated = await Submission.findOneAndUpdate(
    { _id: submission._id, status: 'pending_verification' },
    { status: 'rejected', rejectionReason: reason, storageKey: null, ...scores },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) return null; // lost the race: another run already decided
  await discardObject(submission.storageKey);
  const group = await Group.findById(submission.groupId).select('name').lean();
  await notify([submission.userId], 'photo_rejected', { group: group?.name ?? '' }, { groupId: String(submission.groupId), reason });
  return updated;
}

/**
 * Verifies one `pending_verification` submission. Idempotent: an already decided submission
 * is returned unchanged, and only the run that wins the status transition performs side effects.
 */
export async function verifySubmission(submissionId: string | Types.ObjectId): Promise<SubmissionDoc> {
  const submission = await Submission.findById(submissionId).lean();
  if (!submission) throw new AppError('NOT_FOUND', 404);
  if (submission.status !== 'pending_verification') return submission;

  const assignment = await DailyAssignment.findById(submission.assignmentId).lean();
  if (!assignment) {
    return (await reject(submission, 'NO_ACTIVE_ASSIGNMENT')) ?? submission;
  }
  // The server receive time of the upload is authoritative for the deadline.
  if (!submission.uploadedAt || submission.uploadedAt.getTime() > assignment.deadlineAt.getTime()) {
    return (await reject(submission, 'DEADLINE_PASSED')) ?? submission;
  }

  const bytes = submission.storageKey ? await storage().read(submission.storageKey) : null;
  if (!bytes) return (await reject(submission, 'INVALID_IMAGE')) ?? submission;

  let evaluation;
  try {
    const { data, info } = await sharp(bytes, { failOn: 'error', limitInputPixels: 50_000_000 })
      .resize(VERIFY_SIZE, VERIFY_SIZE, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    evaluation = evaluateColorMatch(data, info.width, info.height, assignment.colorHex, { seed: VERIFY_SEED });
  } catch (error) {
    log.warn('image decode failed during verification', errorFields(error));
    return (await reject(submission, 'INVALID_IMAGE')) ?? submission;
  }

  const scores = {
    deltaE: evaluation.deltaE,
    closenessScore: evaluation.closeness,
    dominantHex: evaluation.dominantHex,
    dominanceShare: evaluation.dominanceShare,
  };
  if (evaluation.closeness < assignment.acceptanceThreshold) {
    return (await reject(submission, 'COLOR_MISMATCH', scores)) ?? (await Submission.findById(submission._id).lean()) ?? submission;
  }

  const accepted = await Submission.findOneAndUpdate(
    { _id: submission._id, status: 'pending_verification' },
    { status: 'accepted', acceptedAt: new Date(), ...scores },
    { returnDocument: 'after' },
  ).lean();
  if (!accepted) return (await Submission.findById(submission._id).lean()) ?? submission;
  const group = await Group.findById(submission.groupId).select('name').lean();
  await notify(
    [submission.userId],
    'photo_accepted',
    { group: group?.name ?? '', score: Math.round(evaluation.closeness) },
    { groupId: String(submission.groupId), submissionId: String(submission._id) },
  );
  return accepted;
}

/**
 * Cron safety net: verifies submissions that were uploaded but never finalized by the client
 * (app killed between PUT and finalize).
 */
export async function verifyStalePending(now = new Date(), olderThanMs = 2 * 60 * 1000): Promise<number> {
  const stale = await Submission.find({ status: 'pending_verification', updatedAt: { $lte: new Date(now.getTime() - olderThanMs) } })
    .limit(25)
    .select('_id')
    .lean();
  let done = 0;
  for (const { _id } of stale) {
    try {
      await verifySubmission(_id);
      done++;
    } catch (error) {
      log.warn('stale verification failed', errorFields(error));
    }
  }
  if (stale.length > 0) await audit({ actor: SYSTEM_ACTOR, action: 'verification.stale_processed', metadata: { count: done } });
  return done;
}
