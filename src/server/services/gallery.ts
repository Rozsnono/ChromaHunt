/**
 * Read side for group members: today's challenge, calendar gallery, authenticated image
 * delivery and moderation (removal of a submission).
 */
import { Types } from 'mongoose';
import { addDays, isDateString, localDateString } from '@/shared';
import { audit, type Actor } from '../audit';
import { requireMembership } from '../auth';
import { AppError, notFound } from '../errors';
import { DailyAssignment, GroupMembership, Submission, User, type UserDoc } from '../models';
import { storage } from '../storage/driver';
import { flushStorageDeletions, queueStorageDeletion } from './cleanup';
import { getGlobalSettings, resolveSettings } from './settings';

/** Largest date range a calendar request may cover. */
const MAX_CALENDAR_DAYS = 62;

export async function getToday(user: UserDoc, groupId: string) {
  const { group } = await requireMembership(groupId, user);
  const now = new Date();
  const assignment = await DailyAssignment.findOne({ groupId: group._id, drawnAt: { $lte: now } }).sort({ date: -1 }).lean();
  if (!assignment) return { assignment: null, me: null, members: [] };

  const [rows, members] = await Promise.all([
    Submission.aggregate<{ _id: { userId: Types.ObjectId; status: string }; n: number }>([
      { $match: { assignmentId: assignment._id, status: { $in: ['accepted', 'pending_verification', 'rejected'] } } },
      { $group: { _id: { userId: '$userId', status: '$status' }, n: { $sum: 1 } } },
    ]),
    GroupMembership.find({ groupId: group._id }).select('userId').lean(),
  ]);
  const count = (userId: Types.ObjectId, status: string) =>
    rows.find((r) => String(r._id.userId) === String(userId) && r._id.status === status)?.n ?? 0;
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).select('displayName').lean();

  const accepted = count(user._id, 'accepted');
  const pending = count(user._id, 'pending_verification');
  return {
    assignment: {
      id: String(assignment._id),
      date: assignment.date,
      colorHex: assignment.colorHex,
      colorName: assignment.colorName,
      drawnAt: assignment.drawnAt,
      deadlineAt: assignment.deadlineAt,
      requiredPhotos: assignment.requiredPhotos,
      isOpen: assignment.deadlineAt.getTime() > now.getTime(),
    },
    me: {
      accepted,
      pending,
      rejected: count(user._id, 'rejected'),
      remaining: Math.max(0, assignment.requiredPhotos - accepted - pending),
      completed: accepted >= assignment.requiredPhotos,
    },
    members: users.map((u) => ({
      userId: String(u._id),
      displayName: u.displayName,
      accepted: count(u._id, 'accepted'),
      completed: count(u._id, 'accepted') >= assignment.requiredPhotos,
    })),
  };
}

/** Calendar of accepted photos. The range is clamped to the group's retention window. */
export async function getCalendar(user: UserDoc, groupId: string, from: string, to: string) {
  const { group } = await requireMembership(groupId, user);
  if (!isDateString(from) || !isDateString(to) || from > to) throw new AppError('VALIDATION_ERROR', 400);
  const settings = resolveSettings(group, await getGlobalSettings());
  const today = localDateString(new Date(), settings.timezone);
  const earliest = addDays(today, -settings.retentionDays);
  const start = from < earliest ? earliest : from;
  const end = to > today ? today : to;
  if (start > end) return { retentionDays: settings.retentionDays, earliest, days: [] };
  if (new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime() > MAX_CALENDAR_DAYS * 86400000) {
    throw new AppError('VALIDATION_ERROR', 400, { issues: [{ path: 'to', message: 'RANGE_TOO_LARGE' }] });
  }

  const assignments = await DailyAssignment.find({ groupId: group._id, date: { $gte: start, $lte: end } }).sort({ date: -1 }).lean();
  const submissions = await Submission.find({ assignmentId: { $in: assignments.map((a) => a._id) }, status: 'accepted' })
    .sort({ acceptedAt: 1 })
    .lean();
  const users = await User.find({ _id: { $in: [...new Set(submissions.map((s) => String(s.userId)))] } }).select('displayName').lean();
  const names = new Map(users.map((u) => [String(u._id), u.displayName] as const));
  return {
    retentionDays: settings.retentionDays,
    earliest,
    days: assignments.map((a) => ({
      date: a.date,
      colorHex: a.colorHex,
      colorName: a.colorName,
      requiredPhotos: a.requiredPhotos,
      photos: submissions
        .filter((s) => String(s.assignmentId) === String(a._id))
        .map((s) => ({
          id: String(s._id),
          userId: String(s.userId),
          displayName: names.get(String(s.userId)) ?? '?',
          closenessScore: Math.round(s.closenessScore ?? 0),
          uploadedAt: s.uploadedAt,
        })),
    })),
  };
}

/**
 * Streams an image to an authorized viewer: the owner (also while verification is pending)
 * or any active member of the group (accepted photos within the retention window).
 */
export async function openImage(user: UserDoc, submissionId: string) {
  if (!Types.ObjectId.isValid(submissionId)) throw notFound();
  const submission = await Submission.findById(submissionId).lean();
  if (!submission || !submission.storageKey) throw notFound();
  const { group } = await requireMembership(String(submission.groupId), user);
  const isOwner = String(submission.userId) === String(user._id);
  const visible = submission.status === 'accepted' || (isOwner && submission.status === 'pending_verification');
  if (!visible) throw notFound();

  const settings = resolveSettings(group, await getGlobalSettings());
  const cutoff = Date.now() - settings.retentionDays * 86400000;
  if (submission.uploadedAt && submission.uploadedAt.getTime() < cutoff) throw notFound();

  const object = await storage().get(submission.storageKey);
  if (!object) throw notFound();
  return object;
}

/**
 * Moderation: removes a photo (and its storage object). Callers authorize first: the group
 * admin route passes `groupId` so a submission of another group cannot be removed through it.
 */
export async function removeSubmission(submissionId: string, actor: Actor, options: { groupId?: string } = {}) {
  if (!Types.ObjectId.isValid(submissionId)) throw notFound();
  const submission = await Submission.findById(submissionId).lean();
  if (!submission || submission.status === 'deleted') throw notFound();
  if (options.groupId && String(submission.groupId) !== options.groupId) throw notFound();
  const key = submission.storageKey;
  await Submission.updateOne(
    { _id: submission._id },
    { status: 'deleted', storageKey: null, deletedAt: new Date(), deletedReason: 'moderation' },
  );
  if (key) {
    await queueStorageDeletion([key]);
    await flushStorageDeletions([key]);
  }
  await audit({
    actor,
    action: 'submission.removed',
    targetType: 'submission',
    targetId: submissionId,
    metadata: { groupId: String(submission.groupId) },
  });
}
