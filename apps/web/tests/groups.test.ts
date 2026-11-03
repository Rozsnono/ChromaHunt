import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as joinRoute from '@/app/api/groups/join/route';
import * as invitesRoute from '@/app/api/groups/[id]/invites/route';
import * as requestsRoute from '@/app/api/groups/[id]/join-requests/route';
import * as decisionRoute from '@/app/api/groups/[id]/join-requests/[reqId]/decision/route';
import * as todayRoute from '@/app/api/groups/[id]/today/route';
import * as leaveRoute from '@/app/api/groups/[id]/leave/route';
import * as settingsRoute from '@/app/api/groups/[id]/settings/route';
import { Group, GroupMembership, InviteCode, JoinRequest } from '@/server/models';
import { hmacHash } from '@/server/crypto';
import { api, initModels, makeGroup, makeUser, resetDb, seedPalette, tokenFor } from './helpers';

beforeAll(initModels);
beforeEach(async () => {
  await resetDb();
  await seedPalette([['Red', '#cc2222'], ['Blue', '#2244cc']]);
});

async function invite(admin: Awaited<ReturnType<typeof makeUser>>, groupId: string) {
  const res = await api(invitesRoute.POST, `/api/groups/${groupId}/invites`, { token: await tokenFor(admin), params: { id: groupId } });
  return res;
}

describe('invitations', () => {
  it('returns the code once, stores only its hash and expires it after 24 hours', async () => {
    const admin = await makeUser();
    const { groupId } = await makeGroup(admin);
    const res = await invite(admin, groupId);
    expect(res.status).toBe(201);
    const { code, qrPayload, expiresAt } = res.json.data;
    expect(code).toMatch(/^[0-9A-Z]{8}$/);
    expect(qrPayload).toContain(code);
    const hours = (new Date(expiresAt).getTime() - Date.now()) / 3600000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    const stored = await InviteCode.findOne({}).lean();
    expect(stored?.codeHash).toBe(hmacHash(code));
    expect(JSON.stringify(stored)).not.toContain(code);
  });

  it('is single use even when many users redeem at the same time', async () => {
    const admin = await makeUser();
    const { groupId } = await makeGroup(admin);
    const { code } = (await invite(admin, groupId)).json.data;
    const users = await Promise.all(Array.from({ length: 8 }, () => makeUser()));
    const results = await Promise.all(
      users.map(async (u) => api(joinRoute.POST, '/api/groups/join', { token: await tokenFor(u), body: { code } })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const losers = results.filter((r) => r.status !== 201);
    expect(losers).toHaveLength(7);
    expect(new Set(losers.map((r) => r.json.error?.code))).toEqual(new Set(['INVITE_INVALID']));
    expect(await JoinRequest.countDocuments({ groupId })).toBe(1);
  });

  it('answers unknown, expired and used codes identically', async () => {
    const admin = await makeUser();
    const { groupId } = await makeGroup(admin);
    const user = await makeUser();
    const token = await tokenFor(user);
    const unknown = await api(joinRoute.POST, '/api/groups/join', { token, body: { code: 'ZZZZZZZZ' } });

    const { code } = (await invite(admin, groupId)).json.data;
    await InviteCode.updateOne({ codeHash: hmacHash(code) }, { expiresAt: new Date(Date.now() - 1000) });
    const expired = await api(joinRoute.POST, '/api/groups/join', { token, body: { code } });
    expect(unknown.json.error?.code).toBe('INVITE_INVALID');
    expect(expired.json.error).toEqual(unknown.json.error);
    expect(expired.status).toBe(unknown.status);
  });

  it('accepts codes typed in lowercase with separators', async () => {
    const admin = await makeUser();
    const { groupId } = await makeGroup(admin);
    const { code } = (await invite(admin, groupId)).json.data;
    const typed = `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase();
    const res = await api(joinRoute.POST, '/api/groups/join', { token: await tokenFor(await makeUser()), body: { code: typed } });
    expect(res.status).toBe(201);
  });

  it('only the group admin can create invites', async () => {
    const admin = await makeUser();
    const member = await makeUser();
    const { groupId } = await makeGroup(admin, [member]);
    expect((await invite(member, groupId)).status).toBe(403);
    expect((await invite(await makeUser(), groupId)).status).toBe(404); // outsiders do not learn the group exists
  });
});

describe('join approval', () => {
  it('requires the admin to approve; approval creates the membership', async () => {
    const admin = await makeUser();
    const { groupId } = await makeGroup(admin);
    const joiner = await makeUser();
    const { code } = (await invite(admin, groupId)).json.data;
    const join = await api(joinRoute.POST, '/api/groups/join', { token: await tokenFor(joiner), body: { code } });
    expect(await GroupMembership.exists({ groupId, userId: joiner._id })).toBeNull();
    expect(
      (await api(todayRoute.GET, `/api/groups/${groupId}/today`, { token: await tokenFor(joiner), params: { id: groupId } })).status,
    ).toBe(404);

    const adminToken = await tokenFor(admin);
    const list = await api(requestsRoute.GET, `/api/groups/${groupId}/join-requests`, { token: adminToken, params: { id: groupId } });
    expect(list.json.data).toHaveLength(1);
    const decision = await api(decisionRoute.POST, '/x', {
      token: adminToken,
      params: { id: groupId, reqId: join.json.data.requestId },
      body: { decision: 'approve' },
    });
    expect(decision.json.data.status).toBe('approved');
    expect(await GroupMembership.exists({ groupId, userId: joiner._id })).not.toBeNull();
    // A decided request cannot be decided again.
    const again = await api(decisionRoute.POST, '/x', {
      token: adminToken,
      params: { id: groupId, reqId: join.json.data.requestId },
      body: { decision: 'reject' },
    });
    expect(again.status).toBe(409);
  });

  it('a rejected joiner never becomes a member and members cannot decide', async () => {
    const admin = await makeUser();
    const member = await makeUser();
    const { groupId } = await makeGroup(admin, [member]);
    const joiner = await makeUser();
    const { code } = (await invite(admin, groupId)).json.data;
    const join = await api(joinRoute.POST, '/api/groups/join', { token: await tokenFor(joiner), body: { code } });
    const asMember = await api(decisionRoute.POST, '/x', {
      token: await tokenFor(member),
      params: { id: groupId, reqId: join.json.data.requestId },
      body: { decision: 'approve' },
    });
    expect(asMember.status).toBe(403);
    await api(decisionRoute.POST, '/x', {
      token: await tokenFor(admin),
      params: { id: groupId, reqId: join.json.data.requestId },
      body: { decision: 'reject' },
    });
    expect(await GroupMembership.exists({ groupId, userId: joiner._id })).toBeNull();
  });
});

describe('admin transfer', () => {
  it('passes the admin role to the oldest member when the admin leaves', async () => {
    const admin = await makeUser();
    const oldest = await makeUser();
    const newer = await makeUser();
    const { groupId } = await makeGroup(admin, [oldest, newer]);
    const res = await api(leaveRoute.POST, '/x', { token: await tokenFor(admin), params: { id: groupId } });
    expect(res.status).toBe(200);
    expect((await GroupMembership.findOne({ groupId, userId: oldest._id }).lean())?.role).toBe('admin');
    expect((await GroupMembership.findOne({ groupId, userId: newer._id }).lean())?.role).toBe('member');
    expect((await Group.findById(groupId).lean())?.isArchived).toBe(false);
  });

  it('archives the group when the last member leaves', async () => {
    const admin = await makeUser();
    const { groupId } = await makeGroup(admin);
    await api(leaveRoute.POST, '/x', { token: await tokenFor(admin), params: { id: groupId } });
    const group = await Group.findById(groupId).lean();
    expect(group?.isArchived).toBe(true);
    expect(group?.archivedReason).toBe('no_members');
  });
});

describe('group settings', () => {
  it('enforces the global minimum threshold for group admins', async () => {
    const admin = await makeUser();
    const { groupId } = await makeGroup(admin);
    const token = await tokenFor(admin);
    const tooLow = await api(settingsRoute.PATCH, '/x', { method: 'PATCH', token, params: { id: groupId }, body: { acceptanceThreshold: 5 } });
    expect(tooLow.status).toBe(400);
    const ok = await api(settingsRoute.PATCH, '/x', { method: 'PATCH', token, params: { id: groupId }, body: { acceptanceThreshold: 70, requiredPhotosPerDay: 2 } });
    expect(ok.status).toBe(200);
    expect(ok.json.data.settings.acceptanceThreshold).toBe(70);
    expect(ok.json.data.settings.requiredPhotosPerDay).toBe(2);
  });

  it('rejects unknown fields and invalid timezones', async () => {
    const admin = await makeUser();
    const { groupId } = await makeGroup(admin);
    const token = await tokenFor(admin);
    for (const body of [{ hacker: true }, { timezone: 'Mars/Base' }, { dailyDrawTime: '25:99' }]) {
      const res = await api(settingsRoute.PATCH, '/x', { method: 'PATCH', token, params: { id: groupId }, body });
      expect(res.status).toBe(400);
    }
  });
});
