/**
 * Account deletion: immediate and permanent.
 *
 * Inside one MongoDB transaction: admin rights of owned groups are transferred (or the group
 * is archived when empty), photos are queued for storage deletion (outbox), and the user,
 * sessions, memberships, points and bindings are removed. Audit entries stay but are
 * anonymised. Storage objects are deleted right after commit (and retried by the cron tick if
 * WebDAV is down), because a database transaction cannot include WebDAV.
 */
import { Types } from 'mongoose';
import { audit, type Actor } from '../audit';
import { inTransaction } from '../db';
import { AppError, notFound } from '../errors';
import {
  AuditLog,
  BiometricBinding,
  DailyPoint,
  GroupMembership,
  InviteCode,
  JoinRequest,
  RefreshToken,
  User,
  WeeklyScore,
  Group,
} from '../models';
import { notify } from '../notifications';
import { verifyPassword } from '../password';
import { flushStorageDeletions, purgeUserContent } from './cleanup';
import { handleAdminDeparture } from './groups';

export interface DeleteAccountResult {
  deleted: true;
  /** Photos that could not be removed from storage yet (the cron tick keeps retrying). */
  storageDeletionsQueued: number;
}

/** Deletes a user and everything they own. `actor` is only used for the audit trail. */
export async function deleteAccount(userId: string, actor: Actor): Promise<DeleteAccountResult> {
  const uid = new Types.ObjectId(userId);
  const memberships = await GroupMembership.find({ userId: uid }).lean();
  const adminGroups = memberships.filter((m) => m.role === 'admin');
  const groupNames = new Map((await Group.find({ _id: { $in: adminGroups.map((m) => m.groupId) } }).select('name').lean()).map((g) => [String(g._id), g.name] as const));

  const outcome = await inTransaction(async (session) => {
    const exists = await User.exists({ _id: uid }).session(session);
    if (!exists) throw notFound();

    const transfers: Array<{ groupId: Types.ObjectId; newAdmin: Types.ObjectId | null }> = [];
    for (const m of adminGroups) {
      // The leaving admin's membership must not be picked as successor.
      transfers.push({ groupId: m.groupId, newAdmin: await handleAdminDeparture(m.groupId, uid, session) });
    }
    const keys = await purgeUserContent(uid, { session });
    await GroupMembership.deleteMany({ userId: uid }, { session });
    await JoinRequest.deleteMany({ userId: uid }, { session });
    await InviteCode.deleteMany({ createdByUserId: uid, usedAt: null }, { session });
    await RefreshToken.deleteMany({ userId: uid }, { session });
    await BiometricBinding.deleteMany({ userId: uid }, { session });
    await DailyPoint.deleteMany({ userId: uid }, { session });
    await WeeklyScore.deleteMany({ userId: uid }, { session });
    // Keep the audit trail but drop the link to the deleted person.
    await AuditLog.updateMany({ actorId: userId }, { actorId: 'deleted-user' }, { session });
    await User.deleteOne({ _id: uid }, { session });
    return { keys, transfers };
  });

  await flushStorageDeletions(outcome.keys);
  for (const t of outcome.transfers) {
    if (t.newAdmin) {
      await notify([t.newAdmin], 'admin_transferred', { group: groupNames.get(String(t.groupId)) ?? '' }, { groupId: String(t.groupId) });
    }
  }
  await audit({
    actor: actor.type === 'user' ? { type: 'user', id: 'deleted-user' } : actor,
    action: 'account.deleted',
    targetType: 'user',
    targetId: 'deleted-user',
    metadata: { groupsTransferredOrArchived: outcome.transfers.length, photosRemoved: outcome.keys.length },
  });
  return { deleted: true, storageDeletionsQueued: outcome.keys.length };
}

/** Self-service deletion requires the current password. */
export async function deleteOwnAccount(user: { _id: Types.ObjectId; passwordHash: string }, password: string) {
  if (!(await verifyPassword(user.passwordHash, password))) throw new AppError('INVALID_CREDENTIALS', 401);
  return deleteAccount(String(user._id), { type: 'user', id: String(user._id) });
}
