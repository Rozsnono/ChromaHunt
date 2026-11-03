/**
 * Groups, membership, invitations and join requests.
 * Rules: closed groups; one admin per group; invites are single-use and valid for 24 hours;
 * every join needs the group admin's approval; groups are archived, never deleted.
 */
import { Types, type ClientSession } from 'mongoose';
import { INVITE_TTL_HOURS, type GroupSettingsPatch } from '@/shared';
import { audit, type Actor } from '../audit';
import { requireMembership } from '../auth';
import { generateInviteCode, hmacHash, normalizeInviteCode } from '../crypto';
import { inTransaction } from '../db';
import { AppError, conflict, forbidden, notFound } from '../errors';
import {
  DailyAssignment,
  Group,
  GroupMembership,
  InviteCode,
  JoinRequest,
  User,
  type GroupDoc,
  type UserDoc,
} from '../models';
import { notify } from '../notifications';
import { flushStorageDeletions, purgeUserContent } from './cleanup';
import { drawForGroup } from './draw';
import { assertWithinLimits, getGlobalSettings, resolveSettings } from './settings';

const actorOf = (user: UserDoc): Actor => ({ type: 'user', id: String(user._id) });

function assertActive(group: GroupDoc): void {
  if (group.isArchived) throw new AppError('GROUP_ARCHIVED', 409);
}

export async function createGroup(user: UserDoc, input: { name: string; settings?: GroupSettingsPatch }) {
  const global = await getGlobalSettings();
  if (input.settings) assertWithinLimits(input.settings, global);
  const group = await Group.create({ name: input.name, settings: input.settings ?? {}, createdBy: user._id });
  await GroupMembership.create({ groupId: group._id, userId: user._id, role: 'admin' });
  await audit({ actor: actorOf(user), action: 'group.created', targetType: 'group', targetId: String(group._id) });
  // The first colour is drawn right away so the new group can start immediately.
  await drawForGroup(group.toObject(), { immediate: true }).catch(() => null);
  return summarizeGroup(group.toObject(), 'admin');
}

async function summarizeGroup(group: GroupDoc, role: 'admin' | 'member') {
  const global = await getGlobalSettings();
  const [memberCount, assignment] = await Promise.all([
    GroupMembership.countDocuments({ groupId: group._id }),
    DailyAssignment.findOne({ groupId: group._id, drawnAt: { $lte: new Date() } }).sort({ date: -1 }).lean(),
  ]);
  return {
    id: String(group._id),
    name: group.name,
    role,
    isArchived: group.isArchived,
    memberCount,
    settings: resolveSettings(group, global),
    latestAssignment: assignment
      ? {
          id: String(assignment._id),
          date: assignment.date,
          colorHex: assignment.colorHex,
          colorName: assignment.colorName,
          deadlineAt: assignment.deadlineAt,
          requiredPhotos: assignment.requiredPhotos,
          isOpen: assignment.deadlineAt.getTime() > Date.now(),
        }
      : null,
  };
}

export async function listGroups(user: UserDoc) {
  const memberships = await GroupMembership.find({ userId: user._id }).lean();
  const groups = await Group.find({ _id: { $in: memberships.map((m) => m.groupId) } }).lean();
  const roleByGroup = new Map(memberships.map((m) => [String(m.groupId), m.role] as const));
  return Promise.all(groups.map((g) => summarizeGroup(g, roleByGroup.get(String(g._id)) ?? 'member')));
}

export async function getGroupDetail(user: UserDoc, groupId: string) {
  const { group, membership } = await requireMembership(groupId, user);
  const members = await GroupMembership.find({ groupId: group._id }).sort({ joinedAt: 1 }).lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).select('displayName').lean();
  const names = new Map(users.map((u) => [String(u._id), u.displayName] as const));
  const pendingJoinRequests =
    membership.role === 'admin' ? await JoinRequest.countDocuments({ groupId: group._id, status: 'pending' }) : undefined;
  return {
    ...(await summarizeGroup(group, membership.role)),
    members: members.map((m) => ({
      userId: String(m.userId),
      displayName: names.get(String(m.userId)) ?? '?',
      role: m.role,
      joinedAt: m.joinedAt,
    })),
    pendingJoinRequests,
  };
}

export async function updateGroupSettings(user: UserDoc, groupId: string, patch: GroupSettingsPatch) {
  const { group } = await requireMembership(groupId, user, { admin: true });
  assertActive(group);
  assertWithinLimits(patch, await getGlobalSettings());
  const set = Object.fromEntries(Object.entries(patch).map(([k, v]) => [`settings.${k}`, v]));
  const updated = await Group.findByIdAndUpdate(group._id, { $set: set }, { returnDocument: 'after', runValidators: true }).lean();
  if (!updated) throw notFound();
  if (patch.timezone && patch.timezone !== resolveSettings(group, await getGlobalSettings()).timezone) {
    await audit({ actor: actorOf(user), action: 'group.timezone_changed', targetType: 'group', targetId: groupId, metadata: { timezone: patch.timezone } });
  }
  return summarizeGroup(updated, 'admin');
}

/** Generates an invitation. The plaintext code is returned once and only its HMAC is stored. */
export async function createInvite(user: UserDoc, groupId: string) {
  const { group } = await requireMembership(groupId, user, { admin: true });
  assertActive(group);
  const code = generateInviteCode();
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600 * 1000);
  await InviteCode.create({ groupId: group._id, codeHash: hmacHash(code), expiresAt, createdByUserId: user._id });
  return { code, qrPayload: `chromahunt://join?code=${code}`, expiresAt, groupName: group.name };
}

/**
 * Redeems an invite code and files a join request for admin approval. The code is consumed
 * with one atomic conditional update, so of two simultaneous redeemers only one wins; every
 * failure reason is reported as the same `INVITE_INVALID`.
 */
export async function redeemInvite(user: UserDoc, rawCode: string) {
  const codeHash = hmacHash(normalizeInviteCode(rawCode));
  const invite = await InviteCode.findOne({ codeHash }).lean();
  const now = new Date();
  if (!invite || invite.usedAt || invite.expiresAt <= now) throw new AppError('INVITE_INVALID', 400);

  const [group, membership, pending] = await Promise.all([
    Group.findById(invite.groupId).lean(),
    GroupMembership.exists({ groupId: invite.groupId, userId: user._id }),
    JoinRequest.exists({ groupId: invite.groupId, userId: user._id, status: 'pending' }),
  ]);
  if (!group || group.isArchived) throw new AppError('INVITE_INVALID', 400);
  if (membership) throw new AppError('ALREADY_MEMBER', 409);
  if (pending) throw new AppError('JOIN_REQUEST_PENDING', 409);

  const consumed = await InviteCode.findOneAndUpdate(
    { _id: invite._id, usedAt: null, expiresAt: { $gt: now } },
    { usedAt: now, usedByUserId: user._id },
    { returnDocument: 'after' },
  ).lean();
  if (!consumed) throw new AppError('INVITE_INVALID', 400);

  const request = await JoinRequest.create({ groupId: group._id, userId: user._id, inviteCodeId: invite._id });
  const admin = await GroupMembership.findOne({ groupId: group._id, role: 'admin' }).lean();
  if (admin) await notify([admin.userId], 'join_request', { group: group.name, name: user.displayName }, { groupId: String(group._id) });
  return { requestId: String(request._id), groupName: group.name, status: 'pending' as const };
}

export async function listJoinRequests(user: UserDoc, groupId: string) {
  const { group } = await requireMembership(groupId, user, { admin: true });
  const requests = await JoinRequest.find({ groupId: group._id, status: 'pending' }).sort({ createdAt: 1 }).lean();
  const users = await User.find({ _id: { $in: requests.map((r) => r.userId) } }).select('displayName').lean();
  const names = new Map(users.map((u) => [String(u._id), u.displayName] as const));
  return requests.map((r) => ({
    id: String(r._id),
    userId: String(r.userId),
    displayName: names.get(String(r.userId)) ?? '?',
    createdAt: r.createdAt,
  }));
}

export async function decideJoinRequest(user: UserDoc, groupId: string, requestId: string, decision: 'approve' | 'reject') {
  const { group } = await requireMembership(groupId, user, { admin: true });
  assertActive(group);
  if (!Types.ObjectId.isValid(requestId)) throw notFound();
  const status = decision === 'approve' ? 'approved' : 'rejected';
  const request = await JoinRequest.findOneAndUpdate(
    { _id: requestId, groupId: group._id, status: 'pending' },
    { status, decidedBy: user._id, decidedAt: new Date() },
    { returnDocument: 'after' },
  ).lean();
  if (!request) throw conflict('CONFLICT');
  if (decision === 'approve') {
    await GroupMembership.updateOne(
      { groupId: group._id, userId: request.userId },
      { $setOnInsert: { groupId: group._id, userId: request.userId, role: 'member', joinedAt: new Date() } },
      { upsert: true },
    );
  }
  await notify([request.userId], decision === 'approve' ? 'join_approved' : 'join_rejected', { group: group.name }, { groupId });
  await audit({ actor: actorOf(user), action: `group.join_${status}`, targetType: 'group', targetId: groupId });
  return { id: String(request._id), status };
}

/**
 * Handles the departure of a group's admin: the oldest remaining member becomes admin; with
 * no one left the group is archived. Runs inside the caller's transaction when given a session.
 * Returns the new admin's id (to notify after commit) or null.
 */
export async function handleAdminDeparture(
  groupId: Types.ObjectId,
  leavingUserId: Types.ObjectId,
  session?: ClientSession,
): Promise<Types.ObjectId | null> {
  const successor = await GroupMembership.findOne({ groupId, userId: { $ne: leavingUserId } })
    .sort({ joinedAt: 1, _id: 1 })
    .session(session ?? null)
    .lean();
  if (successor) {
    await GroupMembership.updateOne({ _id: successor._id }, { role: 'admin' }, { session });
    return successor.userId;
  }
  await Group.updateOne({ _id: groupId }, { isArchived: true, archivedAt: new Date(), archivedReason: 'no_members' }, { session });
  return null;
}

/** Removes a member (leave or removal by the admin) including their photos and points in that group. */
export async function removeMember(groupId: string, targetUserId: string, actor: Actor, action: string) {
  const gid = new Types.ObjectId(groupId);
  const uid = new Types.ObjectId(targetUserId);
  const group = await Group.findById(gid).lean();
  if (!group) throw notFound();
  const result = await inTransaction(async (session) => {
    const membership = await GroupMembership.findOneAndDelete({ groupId: gid, userId: uid }, { session }).lean();
    if (!membership) throw notFound();
    const keys = await purgeUserContent(uid, { groupId: gid, session });
    const newAdmin = membership.role === 'admin' ? await handleAdminDeparture(gid, uid, session) : null;
    return { keys, newAdmin, wasAdmin: membership.role === 'admin' };
  });
  await flushStorageDeletions(result.keys);
  if (result.newAdmin) await notify([result.newAdmin], 'admin_transferred', { group: group.name }, { groupId });
  await audit({
    actor,
    action,
    targetType: 'group',
    targetId: groupId,
    metadata: { adminTransferred: Boolean(result.newAdmin), archived: result.wasAdmin && !result.newAdmin },
  });
}

export async function leaveGroup(user: UserDoc, groupId: string): Promise<void> {
  await requireMembership(groupId, user);
  await removeMember(groupId, String(user._id), actorOf(user), 'group.left');
}

export async function kickMember(user: UserDoc, groupId: string, targetUserId: string): Promise<void> {
  await requireMembership(groupId, user, { admin: true });
  if (targetUserId === String(user._id)) throw forbidden();
  await removeMember(groupId, targetUserId, actorOf(user), 'group.member_removed');
}
