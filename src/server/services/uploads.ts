/**
 * Upload gateway. Flow (all server checks use server time):
 *   1. POST /groups/:id/uploads/intent  -> creates the Submission (`awaiting_upload`) and a
 *      single-use, time-limited upload token bound to user + submission. Idempotent per key.
 *   2. PUT  /uploads/:submissionId      -> validates the token, sanitises the image (EXIF
 *      stripped, orientation applied, max 1080 px) and streams it to storage with the
 *      server's WebDAV credentials. The app never sees storage credentials or URLs.
 *   3. POST /submissions/:id/finalize   -> authoritative colour verification.
 */
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Types } from 'mongoose';
import {
  IMAGE_JPEG_QUALITY,
  IMAGE_MAX_EDGE_PX,
  MAX_UPLOAD_BYTES,
  type SubmissionStatus,
} from '@/shared';
import { requireMembership } from '../auth';
import { sha256Hex } from '../crypto';
import { AppError } from '../errors';
import { errorFields, log } from '../logger';
import { DailyAssignment, Submission, type DailyAssignmentDoc, type UserDoc } from '../models';
import { enforceRateLimit } from '../rate-limit';
import { storage } from '../storage/driver';
import { signUploadToken, verifyUploadToken } from '../tokens';
import { getGlobalSettings, globalLimits } from './settings';
import { toView, verifySubmission } from './verification';

/** An `awaiting_upload` intent older than this no longer blocks a new attempt. */
const INTENT_STALE_MS = 15 * 60 * 1000;
const MIN_EDGE_PX = 64;

export interface UploadIntentInput {
  idempotencyKey: string;
  sizeBytes: number;
  capturedAt: string;
  clientColorScore?: number;
  clientSha256?: string;
}

/** The assignment currently accepting photos: drawn already, deadline not reached. */
export async function findOpenAssignment(groupId: Types.ObjectId, now = new Date()): Promise<DailyAssignmentDoc> {
  const latest = await DailyAssignment.findOne({ groupId, drawnAt: { $lte: now } }).sort({ date: -1 }).lean();
  if (!latest) throw new AppError('NO_ACTIVE_ASSIGNMENT', 409);
  if (latest.deadlineAt.getTime() <= now.getTime()) throw new AppError('DEADLINE_PASSED', 409);
  return latest;
}

const storageKeyFor = (groupId: Types.ObjectId, assignmentId: Types.ObjectId, submissionId: Types.ObjectId) =>
  `groups/${groupId}/${assignmentId}/${submissionId}.jpg`;

async function issueToken(submission: { _id: Types.ObjectId }, userId: Types.ObjectId, jti: string) {
  const uploadToken = await signUploadToken({ userId: String(userId), submissionId: String(submission._id), jti });
  return { submissionId: String(submission._id), uploadToken, uploadPath: `/api/uploads/${submission._id}` };
}

export async function createUploadIntent(user: UserDoc, groupId: string, input: UploadIntentInput) {
  await enforceRateLimit(`upload-intent:${user._id}`, 60, 3600);
  const { group } = await requireMembership(groupId, user);
  if (group.isArchived) throw new AppError('GROUP_ARCHIVED', 409);
  if (input.sizeBytes > MAX_UPLOAD_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', 413);

  const existing = await Submission.findOne({ userId: user._id, idempotencyKey: input.idempotencyKey }).lean();
  if (existing) {
    // Retry of an interrupted upload: hand out a fresh token while it is still awaiting data.
    if (existing.status === 'awaiting_upload') {
      const jti = randomUUID();
      await Submission.updateOne({ _id: existing._id, status: 'awaiting_upload' }, { uploadJti: jti, uploadConsumedAt: null });
      return { ...(await issueToken(existing, user._id, jti)), status: 'awaiting_upload' as SubmissionStatus };
    }
    return { submissionId: String(existing._id), status: existing.status, uploadToken: null, uploadPath: null };
  }

  const assignment = await findOpenAssignment(group._id);
  const active = await Submission.countDocuments({
    userId: user._id,
    assignmentId: assignment._id,
    $or: [
      { status: { $in: ['pending_verification', 'accepted'] } },
      { status: 'awaiting_upload', createdAt: { $gt: new Date(Date.now() - INTENT_STALE_MS) } },
    ],
  });
  if (active >= assignment.requiredPhotos) throw new AppError('QUOTA_REACHED', 409);
  await assertStorageQuota();

  const jti = randomUUID();
  let submission;
  try {
    submission = await Submission.create({
      groupId: group._id,
      userId: user._id,
      assignmentId: assignment._id,
      idempotencyKey: input.idempotencyKey,
      uploadJti: jti,
      clientColorScore: input.clientColorScore ?? null,
      clientSha256: input.clientSha256 ?? null,
      capturedAt: new Date(input.capturedAt),
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new AppError('CONFLICT', 409); // concurrent duplicate intent
    throw error;
  }
  return { ...(await issueToken(submission, user._id, jti)), status: 'awaiting_upload' as SubmissionStatus };
}

async function assertStorageQuota(): Promise<void> {
  const quota = globalLimits(await getGlobalSettings()).storageQuotaBytes;
  if (quota <= 0) return;
  const [row] = await Submission.aggregate<{ total: number }>([
    { $match: { status: { $in: ['pending_verification', 'accepted'] } } },
    { $group: { _id: null, total: { $sum: '$sizeBytes' } } },
  ]);
  if ((row?.total ?? 0) >= quota) throw new AppError('STORAGE_QUOTA_EXCEEDED', 507);
}

/** Reads the request body into memory while enforcing the size limit on the actual bytes. */
export async function readLimitedBody(req: Request, maxBytes = MAX_UPLOAD_BYTES): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new AppError('PAYLOAD_TOO_LARGE', 413);
  if (!req.body) throw new AppError('INVALID_IMAGE', 400);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError('PAYLOAD_TOO_LARGE', 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Re-encodes the photo: orientation applied, EXIF/metadata stripped, longest edge <= 1080 px. */
export async function sanitizeImage(input: Uint8Array) {
  try {
    const image = sharp(input, { failOn: 'error', limitInputPixels: 50_000_000 });
    const meta = await image.metadata();
    if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('unsupported format');
    const { data, info } = await image
      .rotate() // apply EXIF orientation before the metadata is dropped
      .resize({ width: IMAGE_MAX_EDGE_PX, height: IMAGE_MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: IMAGE_JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true }); // sharp drops all metadata unless asked to keep it
    if (info.width < MIN_EDGE_PX || info.height < MIN_EDGE_PX) throw new Error('image too small');
    return { data, width: info.width, height: info.height };
  } catch (error) {
    log.info('invalid image upload', errorFields(error));
    throw new AppError('INVALID_IMAGE', 400);
  }
}

export async function receiveUpload(user: UserDoc, submissionId: string, token: string, req: Request) {
  await enforceRateLimit(`upload:${user._id}`, 60, 3600);
  let claims;
  try {
    claims = await verifyUploadToken(token);
  } catch {
    throw new AppError('UPLOAD_TOKEN_INVALID', 401);
  }
  if (claims.userId !== String(user._id) || claims.submissionId !== submissionId) throw new AppError('UPLOAD_TOKEN_INVALID', 401);
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('image/')) throw new AppError('INVALID_IMAGE', 400);

  // Single use: the token's jti is consumed atomically; a replay finds nothing to update.
  const submission = await Submission.findOneAndUpdate(
    { _id: submissionId, userId: user._id, status: 'awaiting_upload', uploadJti: claims.jti, uploadConsumedAt: null },
    { uploadConsumedAt: new Date() },
    { returnDocument: 'after' },
  ).lean();
  if (!submission) throw new AppError('UPLOAD_TOKEN_INVALID', 401);

  const release = () => Submission.updateOne({ _id: submission._id, status: 'awaiting_upload' }, { uploadConsumedAt: null });
  try {
    const now = new Date();
    const assignment = await DailyAssignment.findById(submission.assignmentId).lean();
    if (!assignment || assignment.deadlineAt.getTime() <= now.getTime()) {
      await Submission.updateOne({ _id: submission._id }, { status: 'rejected', rejectionReason: 'DEADLINE_PASSED', uploadedAt: now });
      throw new AppError('DEADLINE_PASSED', 409);
    }
    const body = await readLimitedBody(req);
    const image = await sanitizeImage(body);
    const key = storageKeyFor(submission.groupId, submission.assignmentId, submission._id);
    await storage().put(key, image.data, 'image/jpeg');
    const saved = await Submission.findOneAndUpdate(
      { _id: submission._id, status: 'awaiting_upload' },
      {
        status: 'pending_verification',
        storageKey: key,
        uploadedAt: now,
        sha256: sha256Hex(image.data),
        width: image.width,
        height: image.height,
        sizeBytes: image.data.byteLength,
        exifStripped: true,
      },
      { returnDocument: 'after' },
    ).lean();
    if (!saved) throw new AppError('UPLOAD_TOKEN_INVALID', 401);
    return toView(saved);
  } catch (error) {
    if (error instanceof AppError && error.code === 'INVALID_IMAGE') {
      await Submission.updateOne({ _id: submission._id }, { status: 'rejected', rejectionReason: 'INVALID_IMAGE', uploadedAt: new Date() });
    } else if (!(error instanceof AppError && error.code === 'DEADLINE_PASSED')) {
      await release(); // storage outage etc.: the client may retry with the same token or a new intent
    }
    throw error;
  }
}

export async function finalizeSubmission(user: UserDoc, submissionId: string) {
  const owned = await Submission.findOne({ _id: submissionId, userId: user._id }).lean();
  if (!owned) throw new AppError('NOT_FOUND', 404);
  if (owned.status === 'awaiting_upload') throw new AppError('UPLOAD_TOKEN_INVALID', 409);
  return toView(await verifySubmission(owned._id));
}
