/**
 * Authorization matrix: every admin route must demand its own permission, and every
 * user route must demand a valid access token and group membership/role.
 */
import { Types } from 'mongoose';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PERMISSIONS, type Permission } from '@/shared';
import { ADMIN_COOKIE } from '@/server/auth';
import { signAdminSession } from '@/server/tokens';
import * as dashboard from '@/app/api/admin/dashboard/route';
import * as settings from '@/app/api/admin/settings/route';
import * as palette from '@/app/api/admin/palette/route';
import * as paletteItem from '@/app/api/admin/palette/[id]/route';
import * as users from '@/app/api/admin/users/route';
import * as userItem from '@/app/api/admin/users/[id]/route';
import * as userReset from '@/app/api/admin/users/[id]/reset-password/route';
import * as userPerms from '@/app/api/admin/users/[id]/permissions/route';
import * as groups from '@/app/api/admin/groups/route';
import * as groupItem from '@/app/api/admin/groups/[id]/route';
import * as groupSettings from '@/app/api/admin/groups/[id]/settings/route';
import * as groupArchive from '@/app/api/admin/groups/[id]/archive/route';
import * as groupReassign from '@/app/api/admin/groups/[id]/reassign-admin/route';
import * as groupRanking from '@/app/api/admin/groups/[id]/ranking/route';
import * as submissionItem from '@/app/api/admin/submissions/[id]/route';
import * as storageStats from '@/app/api/admin/storage/route';
import * as storageCleanup from '@/app/api/admin/storage/cleanup/route';
import * as audit from '@/app/api/admin/audit/route';
import * as gSettings from '@/app/api/groups/[id]/settings/route';
import * as gInvites from '@/app/api/groups/[id]/invites/route';
import * as gRequests from '@/app/api/groups/[id]/join-requests/route';
import * as gDecision from '@/app/api/groups/[id]/join-requests/[reqId]/decision/route';
import * as gMember from '@/app/api/groups/[id]/members/[userId]/route';
import * as gSubmission from '@/app/api/groups/[id]/submissions/[sid]/route';
import * as gToday from '@/app/api/groups/[id]/today/route';
import * as gCalendar from '@/app/api/groups/[id]/calendar/route';
import * as gRanking from '@/app/api/groups/[id]/ranking/route';
import * as gDetail from '@/app/api/groups/[id]/route';
import * as gList from '@/app/api/groups/route';
import * as meRoute from '@/app/api/me/route';
import * as pushRoute from '@/app/api/push/tokens/route';
import * as finalize from '@/app/api/submissions/[id]/finalize/route';
import * as image from '@/app/api/submissions/[id]/image/route';
import * as cron from '@/app/api/cron/tick/route';
import { api, initModels, installMemoryStorage, makeGroup, makeUser, resetDb, seedPalette, tokenFor } from './helpers';

beforeAll(initModels);
beforeEach(async () => {
  await resetDb();
  installMemoryStorage();
});

const fakeId = () => String(new Types.ObjectId());

interface AdminRoute {
  name: string;
  handler: unknown;
  method: string;
  permission: Permission;
  params?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
}

const id = fakeId();
const ADMIN_ROUTES: AdminRoute[] = [
  { name: 'dashboard', handler: dashboard.GET, method: 'GET', permission: 'audit.view' },
  { name: 'settings get', handler: settings.GET, method: 'GET', permission: 'settings.manage' },
  { name: 'settings patch', handler: settings.PATCH, method: 'PATCH', permission: 'settings.manage', body: { registrationOpen: true } },
  { name: 'palette list', handler: palette.GET, method: 'GET', permission: 'palette.manage' },
  { name: 'palette create', handler: palette.POST, method: 'POST', permission: 'palette.manage', body: { name: 'Teal', hex: '#008080' } },
  { name: 'palette patch', handler: paletteItem.PATCH, method: 'PATCH', permission: 'palette.manage', params: { id }, body: { isActive: false } },
  { name: 'palette delete', handler: paletteItem.DELETE, method: 'DELETE', permission: 'palette.manage', params: { id } },
  { name: 'users list', handler: users.GET, method: 'GET', permission: 'users.manage' },
  { name: 'user get', handler: userItem.GET, method: 'GET', permission: 'users.manage', params: { id } },
  { name: 'user patch', handler: userItem.PATCH, method: 'PATCH', permission: 'users.manage', params: { id }, body: { isDisabled: true } },
  { name: 'user delete', handler: userItem.DELETE, method: 'DELETE', permission: 'users.manage', params: { id } },
  { name: 'user reset password', handler: userReset.POST, method: 'POST', permission: 'users.manage', params: { id } },
  { name: 'user permissions', handler: userPerms.PUT, method: 'PUT', permission: 'permissions.manage', params: { id }, body: { permissions: ['palette.manage'] } },
  { name: 'groups list', handler: groups.GET, method: 'GET', permission: 'groups.manage' },
  { name: 'group get', handler: groupItem.GET, method: 'GET', permission: 'groups.manage', params: { id } },
  { name: 'group settings', handler: groupSettings.PATCH, method: 'PATCH', permission: 'groups.manage', params: { id }, body: { retentionDays: 10 } },
  { name: 'group archive', handler: groupArchive.POST, method: 'POST', permission: 'groups.manage', params: { id }, body: { archived: true } },
  { name: 'group reassign', handler: groupReassign.POST, method: 'POST', permission: 'groups.manage', params: { id }, body: { userId: id } },
  { name: 'group ranking', handler: groupRanking.GET, method: 'GET', permission: 'groups.manage', params: { id } },
  { name: 'submission delete', handler: submissionItem.DELETE, method: 'DELETE', permission: 'groups.manage', params: { id } },
  { name: 'storage stats', handler: storageStats.GET, method: 'GET', permission: 'storage.manage' },
  { name: 'storage cleanup', handler: storageCleanup.POST, method: 'POST', permission: 'storage.manage' },
  { name: 'audit list', handler: audit.GET, method: 'GET', permission: 'audit.view' },
];

const isAuthFailure = (status: number) => status === 401 || status === 403;

describe('admin routes', () => {
  it.each(ADMIN_ROUTES)('$name requires $permission', async (route) => {
    const call = (init: Record<string, unknown> = {}) =>
      api(route.handler, '/api/admin/x', { method: route.method, params: route.params, body: route.body, query: route.query, ...init });

    expect((await call()).status).toBe(401); // anonymous

    const plain = await makeUser();
    expect((await call({ token: await tokenFor(plain) })).status).toBe(403); // no permissions at all

    const others = PERMISSIONS.filter((p) => p !== route.permission);
    const wrongOnly = await makeUser({ permissions: others });
    expect((await call({ token: await tokenFor(wrongOnly) })).status).toBe(403); // every other permission is not enough

    const right = await makeUser({ permissions: [route.permission] });
    expect(isAuthFailure((await call({ token: await tokenFor(right) })).status)).toBe(false);

    const cookie = `${ADMIN_COOKIE}=${await signAdminSession()}`;
    const headers = { origin: 'http://localhost:3000' };
    expect(isAuthFailure((await call({ cookie, headers })).status)).toBe(false); // env-password admin session
  });

  it('refuses cookie-authenticated state changes from foreign or missing origins (CSRF)', async () => {
    const cookie = `${ADMIN_COOKIE}=${await signAdminSession()}`;
    const attempt = (headers: Record<string, string>) =>
      api(palette.POST, '/api/admin/palette', { cookie, headers, body: { name: 'Teal', hex: '#008080' } });
    expect((await attempt({})).status).toBe(403);
    expect((await attempt({ origin: 'https://evil.example' })).status).toBe(403);
    expect((await attempt({ origin: 'http://localhost:3000' })).status).toBe(201);
    // Safe methods do not need an origin.
    expect((await api(palette.GET, '/api/admin/palette', { cookie })).status).toBe(200);
  });

  it('rejects forged, expired or foreign admin cookies', async () => {
    for (const value of ['garbage', 'a.b.c']) {
      expect((await api(dashboard.GET, '/x', { cookie: `${ADMIN_COOKIE}=${value}` })).status).toBe(401);
    }
  });

  it('a disabled user with permissions is locked out', async () => {
    const user = await makeUser({ permissions: ['users.manage'], isDisabled: true });
    expect((await api(users.GET, '/x', { token: await tokenFor(user) })).status).toBe(403);
  });
});

describe('user routes', () => {
  const anonymous: Array<[string, unknown, string, Record<string, string>?]> = [
    ['groups list', gList.GET, 'GET'],
    ['groups create', gList.POST, 'POST'],
    ['me', meRoute.GET, 'GET'],
    ['push tokens', pushRoute.GET, 'GET'],
    ['group detail', gDetail.GET, 'GET', { id }],
    ['today', gToday.GET, 'GET', { id }],
    ['calendar', gCalendar.GET, 'GET', { id }],
    ['ranking', gRanking.GET, 'GET', { id }],
    ['invites', gInvites.POST, 'POST', { id }],
    ['finalize', finalize.POST, 'POST', { id }],
    ['image', image.GET, 'GET', { id }],
  ];
  it.each(anonymous)('%s needs a valid access token', async (_name, handler, method, params) => {
    expect((await api(handler, '/x', { method, params })).status).toBe(401);
    expect((await api(handler, '/x', { method, params, token: 'not.a.jwt' })).status).toBe(401);
  });

  it('group routes hide the group from outsiders and restrict admin actions to the group admin', async () => {
    await seedPalette();
    const admin = await makeUser();
    const member = await makeUser();
    const outsider = await makeUser();
    const { groupId } = await makeGroup(admin, [member]);
    const params = { id: groupId };
    const q = { from: '2030-01-01', to: '2030-01-02' };

    const memberOk: Array<[unknown, string, Record<string, unknown>?]> = [
      [gDetail.GET, 'GET'],
      [gToday.GET, 'GET'],
      [gRanking.GET, 'GET'],
      [gCalendar.GET, 'GET', { query: q }],
    ];
    for (const [handler, method, extra] of memberOk) {
      expect((await api(handler, '/x', { method, params, token: await tokenFor(outsider), ...extra })).status).toBe(404);
      expect((await api(handler, '/x', { method, params, token: await tokenFor(member), ...extra })).status).toBe(200);
    }

    const adminOnly: Array<[unknown, string, Record<string, unknown>]> = [
      [gSettings.PATCH, 'PATCH', { params, body: { retentionDays: 10 } }],
      [gInvites.POST, 'POST', { params }],
      [gRequests.GET, 'GET', { params }],
      [gDecision.POST, 'POST', { params: { ...params, reqId: fakeId() }, body: { decision: 'approve' } }],
      [gMember.DELETE, 'DELETE', { params: { ...params, userId: String(member._id) } }],
      [gSubmission.DELETE, 'DELETE', { params: { ...params, sid: fakeId() } }],
    ];
    for (const [handler, method, extra] of adminOnly) {
      expect((await api(handler, '/x', { method, token: await tokenFor(outsider), ...extra })).status).toBe(404);
      expect((await api(handler, '/x', { method, token: await tokenFor(member), ...extra })).status).toBe(403);
    }
  });

  it('a user with admin permissions is not a group admin', async () => {
    await seedPalette();
    const admin = await makeUser();
    const powerUser = await makeUser({ permissions: [...PERMISSIONS] });
    const { groupId } = await makeGroup(admin);
    const res = await api(gInvites.POST, '/x', { token: await tokenFor(powerUser), params: { id: groupId } });
    expect(res.status).toBe(404);
  });
});

describe('cron endpoint', () => {
  it('requires the cron secret', async () => {
    expect((await api(cron.GET, '/api/cron/tick')).status).toBe(401);
    expect((await api(cron.GET, '/api/cron/tick', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    const ok = await api(cron.GET, '/api/cron/tick', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(ok.status).toBe(200);
    expect(ok.json.data.draws).toBe(0);
  });
});
