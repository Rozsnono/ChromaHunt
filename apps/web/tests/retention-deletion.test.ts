import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import * as deleteMe from '@/app/api/me/route';
import {
  AuditLog,
  DailyPoint,
  Group,
  GroupMembership,
  RefreshToken,
  StorageDeletionTask,
  Submission,
  User,
  WeeklyScore,
} from '@/server/models';
import { deleteAccount } from '@/server/services/account';
import { drainDeletionOutbox } from '@/server/services/cleanup';
import { runRetentionCleanup } from '@/server/services/retention';
import { getRanking } from '@/server/services/scoring';
import { api, initModels, installMemoryStorage, makeGroup, makeUser, PASSWORD, resetDb, seedPalette, solidJpeg, tokenFor, uploadPhoto, type MemoryStorage } from './helpers';

let storage: MemoryStorage;
beforeAll(initModels);
beforeEach(async () => {
  await resetDb();
  storage = installMemoryStorage();
  await seedPalette();
});

describe('retention cleanup', () => {
  async function photo() {
    const admin = await makeUser();
    const member = await makeUser();
    const { groupId } = await makeGroup(admin, [member], { retentionDays: 7 });
    const res = await uploadPhoto(member, groupId, await solidJpeg('#cc2222'));
    return { groupId, submissionId: res.submissionId as string };
  }

  it('deletes expired photos from storage and marks the records deleted; fresh ones stay', async () => {
    const old = await photo();
    const fresh = await photo();
    await Submission.updateOne({ _id: old.submissionId }, { uploadedAt: new Date(Date.now() - 8 * 86400000) });
    const report = await runRetentionCleanup();
    expect(report.deleted).toBe(1);
    const oldDoc = await Submission.findById(old.submissionId).lean();
    expect(oldDoc?.status).toBe('deleted');
    expect(oldDoc?.storageKey).toBeNull();
    expect(storage.objects.size).toBe(1);
    expect((await Submission.findById(fresh.submissionId).lean())?.status).toBe('accepted');
  });

  it('marks failures as cleanup_pending, retries on the next run and alerts after repeated failures', async () => {
    const { submissionId } = await photo();
    await Submission.updateOne({ _id: submissionId }, { uploadedAt: new Date(Date.now() - 8 * 86400000) });
    storage.failRemove = true;
    expect((await runRetentionCleanup()).failed).toBe(1);
    expect((await Submission.findById(submissionId).lean())?.cleanupState).toBe('cleanup_pending');
    expect(storage.objects.size).toBe(1);
    for (let i = 0; i < 4; i++) await runRetentionCleanup();
    expect(await AuditLog.countDocuments({ action: 'retention.cleanup_failing' })).toBe(1);

    storage.failRemove = false;
    expect((await runRetentionCleanup()).deleted).toBe(1);
    expect((await Submission.findById(submissionId).lean())?.status).toBe('deleted');
    expect(storage.objects.size).toBe(0);
  });

  it('sweeps upload intents that never received data', async () => {
    const member = await makeUser();
    const { groupId, assignment } = await makeGroup(member);
    await Submission.create({
      groupId,
      userId: member._id,
      assignmentId: assignment._id,
      idempotencyKey: 'stale-intent-key-0001',
      capturedAt: new Date(),
    });
    await Submission.collection.updateMany({}, { $set: { createdAt: new Date(Date.now() - 2 * 3600000) } });
    expect((await runRetentionCleanup()).orphansRemoved).toBe(1);
    expect(await Submission.countDocuments({})).toBe(0);
  });
});

describe('account deletion', () => {
  it('removes the user, photos, points and sessions; transfers admin rights; anonymises the audit trail', async () => {
    const leaving = await makeUser();
    const oldest = await makeUser();
    const newer = await makeUser();
    const { groupId } = await makeGroup(leaving, [oldest, newer], { scoringEnabled: true });
    const solo = await makeGroup(leaving); // a second group where the user is the only member
    await uploadPhoto(leaving, groupId, await solidJpeg('#cc2222'));
    await uploadPhoto(oldest, groupId, await solidJpeg('#cc2222'));
    await RefreshToken.create({ userId: leaving._id, familyId: 'f', tokenHash: 'h', deviceId: 'd', expiresAt: new Date(Date.now() + 1e9) });
    await DailyPoint.create({ groupId, userId: leaving._id, assignmentId: new Types.ObjectId(), date: '2030-01-01', weekKey: '2030-W01', points: 50, completionRatio: 1, avgCloseness: 50, acceptedCount: 1, required: 1 });
    await WeeklyScore.create({ groupId, userId: leaving._id, weekKey: '2030-W01', points: 50, daysCompleted: 1, finalizedAt: new Date() });
    await AuditLog.create({ actorType: 'user', actorId: String(leaving._id), action: 'group.created' });
    expect(storage.objects.size).toBe(2);

    const result = await deleteAccount(String(leaving._id), { type: 'user', id: String(leaving._id) });
    expect(result.deleted).toBe(true);

    expect(await User.exists({ _id: leaving._id })).toBeNull();
    expect(await RefreshToken.countDocuments({ userId: leaving._id })).toBe(0);
    expect(await GroupMembership.countDocuments({ userId: leaving._id })).toBe(0);
    expect(await Submission.countDocuments({ userId: leaving._id })).toBe(0);
    expect(await DailyPoint.countDocuments({ userId: leaving._id })).toBe(0);
    expect(await WeeklyScore.countDocuments({ userId: leaving._id })).toBe(0);
    expect(storage.objects.size).toBe(1); // only the other member's photo remains
    expect(await StorageDeletionTask.countDocuments({})).toBe(0);

    expect((await GroupMembership.findOne({ groupId, userId: oldest._id }).lean())?.role).toBe('admin');
    expect((await Group.findById(solo.groupId).lean())?.isArchived).toBe(true);
    expect(await AuditLog.countDocuments({ actorId: String(leaving._id) })).toBe(0);
    // two real group creations + the manual entry, all anonymised
    expect(await AuditLog.countDocuments({ actorId: 'deleted-user', action: 'group.created' })).toBe(3);
    // The leaderboard no longer contains the deleted user.
    const ranking = await getRanking(new Types.ObjectId(groupId), '2030-W01');
    expect(ranking?.entries.map((e) => e.userId)).not.toContain(String(leaving._id));
  });

  it('keeps a retry task when storage is down and removes the object later', async () => {
    const user = await makeUser();
    const other = await makeUser();
    const { groupId } = await makeGroup(other, [user]);
    await uploadPhoto(user, groupId, await solidJpeg('#cc2222'));
    storage.failRemove = true;
    const result = await deleteAccount(String(user._id), { type: 'user', id: String(user._id) });
    expect(result.deleted).toBe(true);
    expect(await User.exists({ _id: user._id })).toBeNull();
    expect(await StorageDeletionTask.countDocuments({})).toBe(1);
    expect(storage.objects.size).toBe(1);

    storage.failRemove = false;
    await StorageDeletionTask.updateMany({}, { nextAttemptAt: new Date(0) });
    expect(await drainDeletionOutbox()).toBe(1);
    expect(storage.objects.size).toBe(0);
    expect(await StorageDeletionTask.countDocuments({})).toBe(0);
  });

  it('self deletion over the API needs the current password', async () => {
    const user = await makeUser();
    const token = await tokenFor(user);
    const wrong = await api(deleteMe.DELETE, '/api/me', { method: 'DELETE', token, body: { password: 'wrong-password-1' } });
    expect(wrong.status).toBe(401);
    expect(await User.exists({ _id: user._id })).not.toBeNull();
    const ok = await api(deleteMe.DELETE, '/api/me', { method: 'DELETE', token, body: { password: PASSWORD } });
    expect(ok.status).toBe(200);
    expect(await User.exists({ _id: user._id })).toBeNull();
    // The deleted user's token is useless from now on.
    expect((await api(deleteMe.GET, '/api/me', { token })).status).toBe(401);
  });
});
