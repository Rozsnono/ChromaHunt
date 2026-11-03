import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as session from '@/app/api/admin/session/route';
import * as palette from '@/app/api/admin/palette/route';
import * as paletteItem from '@/app/api/admin/palette/[id]/route';
import * as users from '@/app/api/admin/users/route';
import * as userItem from '@/app/api/admin/users/[id]/route';
import * as userReset from '@/app/api/admin/users/[id]/reset-password/route';
import * as userPerms from '@/app/api/admin/users/[id]/permissions/route';
import * as groupArchive from '@/app/api/admin/groups/[id]/archive/route';
import * as groupReassign from '@/app/api/admin/groups/[id]/reassign-admin/route';
import * as groupSettings from '@/app/api/admin/groups/[id]/settings/route';
import * as settings from '@/app/api/admin/settings/route';
import * as auditRoute from '@/app/api/admin/audit/route';
import * as storageStats from '@/app/api/admin/storage/route';
import * as login from '@/app/api/auth/login/route';
import * as refresh from '@/app/api/auth/refresh/route';
import { proxy } from '@/proxy';
import { NextRequest } from 'next/server';
import { ADMIN_COOKIE } from '@/server/auth';
import { signAdminSession } from '@/server/tokens';
import { AuditLog, ColorPalette, Group, GroupMembership, User } from '@/server/models';
import { api, initModels, makeGroup, makeUser, PASSWORD, resetDb, seedPalette } from './helpers';

beforeAll(initModels);
beforeEach(resetDb);

const adminPassword = () => process.env.ADMIN_PASSWORD as string;
const ip = (n: number) => ({ 'x-forwarded-for': `10.0.0.${n}` });

describe('admin login', () => {
  it('sets a hardened session cookie on success', async () => {
    const res = await api(session.POST, '/api/admin/session', { body: { password: adminPassword() }, headers: ip(1) });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`${ADMIN_COOKIE}=`);
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('samesite=strict');
    expect(await AuditLog.countDocuments({ action: 'admin.login' })).toBe(1);
  });

  it('rejects a wrong password and locks the IP out after repeated failures', async () => {
    const attempt = (password: string, n = 2) => api(session.POST, '/api/admin/session', { body: { password }, headers: ip(n) });
    for (let i = 0; i < 5; i++) expect((await attempt('wrong-password-1')).status).toBe(401);
    const locked = await attempt(adminPassword()); // even the right password is refused while locked
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).toBeTruthy();
    // Another IP is not affected.
    expect((await attempt(adminPassword(), 3)).status).toBe(200);
  });

  it('never stores raw IP addresses', async () => {
    await api(session.POST, '/api/admin/session', { body: { password: 'wrong-password-1' }, headers: ip(9) });
    const dump = JSON.stringify(await AuditLog.find({}).lean());
    expect(dump).not.toContain('10.0.0.9');
  });

  it('logout clears the cookie and the session endpoint reflects the login state', async () => {
    const cookie = `${ADMIN_COOKIE}=${await signAdminSession()}`;
    expect((await api(session.GET, '/x', { cookie })).status).toBe(200);
    expect((await api(session.GET, '/x')).status).toBe(401);
    const out = await api(session.DELETE, '/x', { method: 'DELETE', cookie, headers: { origin: 'http://localhost:3000' } });
    expect(out.headers.get('set-cookie') ?? '').toMatch(/max-age=0/i);
  });
});

describe('admin operations are audited', () => {
  const cookie = async () => ({ cookie: `${ADMIN_COOKIE}=${await signAdminSession()}`, headers: { origin: 'http://localhost:3000' } });

  it('palette CRUD precomputes CIELAB, protects used colours and logs every change', async () => {
    const auth = await cookie();
    const created = await api(palette.POST, '/x', { ...auth, body: { name: 'Teal', hex: '#008080' } });
    expect(created.status).toBe(201);
    const color = await ColorPalette.findById(created.json.data.id).lean();
    expect(color?.lab[0]).toBeGreaterThan(40);
    expect((await api(palette.POST, '/x', { ...auth, body: { name: 'Dup', hex: '#008080' } })).status).toBe(409);
    expect((await api(palette.POST, '/x', { ...auth, body: { name: 'Bad', hex: 'teal' } })).status).toBe(400);

    const patched = await api(paletteItem.PATCH, '/x', { ...auth, method: 'PATCH', params: { id: created.json.data.id }, body: { hex: '#ff0000', isActive: false } });
    expect(patched.json.data.isActive).toBe(false);
    expect(patched.json.data.lab[1]).toBeGreaterThan(60); // red has a high a*

    // A colour that was drawn stays in the history.
    const admin = await makeUser();
    await makeGroup(admin); // draws the only active colour...
    await seedPalette([['Used', '#123456']]);
    await ColorPalette.updateMany({ name: { $ne: 'Used' } }, { isActive: false });
    const g = await makeGroup(admin);
    const used = await ColorPalette.findOne({ name: 'Used' }).lean();
    expect(g.assignment.colorId).toEqual(used!._id);
    expect((await api(paletteItem.DELETE, '/x', { ...auth, method: 'DELETE', params: { id: String(used!._id) } })).status).toBe(409);
    expect((await api(paletteItem.DELETE, '/x', { ...auth, method: 'DELETE', params: { id: created.json.data.id } })).status).toBe(200);

    const actions = (await AuditLog.find({ actorId: 'admin' }).lean()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['palette.created', 'palette.updated', 'palette.deleted']));
  });

  it('disabling a user logs them out everywhere and blocks login; enabling restores it', async () => {
    const auth = await cookie();
    const user = await makeUser();
    const first = await api(login.POST, '/api/auth/login', { body: { email: user.email, password: PASSWORD, deviceId: 'device-zzzzzzzz' } });
    const refreshToken = first.json.data.tokens.refreshToken;
    await api(userItem.PATCH, '/x', { ...auth, method: 'PATCH', params: { id: String(user._id) }, body: { isDisabled: true } });
    expect((await api(refresh.POST, '/x', { body: { refreshToken, deviceId: 'device-zzzzzzzz' } })).status).toBeGreaterThanOrEqual(401);
    expect((await api(login.POST, '/x', { body: { email: user.email, password: PASSWORD, deviceId: 'device-zzzzzzzz' } })).json.error?.code).toBe('ACCOUNT_DISABLED');
    await api(userItem.PATCH, '/x', { ...auth, method: 'PATCH', params: { id: String(user._id) }, body: { isDisabled: false } });
    expect((await api(login.POST, '/x', { body: { email: user.email, password: PASSWORD, deviceId: 'device-zzzzzzzz' } })).status).toBe(200);
    const actions = (await AuditLog.find({}).lean()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['user.disabled', 'user.enabled']));
  });

  it('password reset returns a temporary password once and never logs it', async () => {
    const auth = await cookie();
    const user = await makeUser();
    const res = await api(userReset.POST, '/x', { ...auth, params: { id: String(user._id) } });
    const temp = res.json.data.temporaryPassword as string;
    expect(temp.length).toBeGreaterThanOrEqual(16);
    expect(JSON.stringify(await AuditLog.find({}).lean())).not.toContain(temp);
    expect((await User.findById(user._id).lean())?.mustChangePassword).toBe(true);
  });

  it('permissions can be edited, validated and appear in the audit trail with before/after', async () => {
    const auth = await cookie();
    const user = await makeUser();
    const set = await api(userPerms.PUT, '/x', { ...auth, method: 'PUT', params: { id: String(user._id) }, body: { permissions: ['palette.manage', 'palette.manage', 'audit.view'] } });
    expect(set.json.data.permissions).toEqual(['palette.manage', 'audit.view']);
    expect((await api(userPerms.PUT, '/x', { ...auth, method: 'PUT', params: { id: String(user._id) }, body: { permissions: ['root'] } })).status).toBe(400);
    const entry = await AuditLog.findOne({ action: 'user.permissions_changed' }).lean();
    expect(entry?.metadata).toMatchObject({ to: ['palette.manage', 'audit.view'] });
    const list = await api(users.GET, '/x', { ...auth, query: { withPermissions: 'true' } });
    expect(list.json.data.items).toHaveLength(1);
  });

  it('archives, restores and reassigns groups; archived groups accept no new draws', async () => {
    await seedPalette();
    const auth = await cookie();
    const admin = await makeUser();
    const member = await makeUser();
    const { groupId } = await makeGroup(admin, [member]);
    await api(groupArchive.POST, '/x', { ...auth, params: { id: groupId }, body: { archived: true } });
    expect((await Group.findById(groupId).lean())?.isArchived).toBe(true);
    await api(groupArchive.POST, '/x', { ...auth, params: { id: groupId }, body: { archived: false } });
    await api(groupReassign.POST, '/x', { ...auth, params: { id: groupId }, body: { userId: String(member._id) } });
    expect((await GroupMembership.findOne({ groupId, userId: member._id }).lean())?.role).toBe('admin');
    expect((await GroupMembership.findOne({ groupId, userId: admin._id }).lean())?.role).toBe('member');
    expect((await api(groupReassign.POST, '/x', { ...auth, params: { id: groupId }, body: { userId: String((await makeUser())._id) } })).status).toBe(400);
    await api(groupSettings.PATCH, '/x', { ...auth, method: 'PATCH', params: { id: groupId }, body: { timezone: 'America/New_York' } });
    expect(await AuditLog.countDocuments({ action: 'group.timezone_changed' })).toBe(1);
  });

  it('global minimum threshold overrides lower group values', async () => {
    await seedPalette();
    const auth = await cookie();
    const admin = await makeUser();
    const { groupId } = await makeGroup(admin, [], { acceptanceThreshold: 40 });
    await api(settings.PATCH, '/x', { ...auth, method: 'PATCH', body: { minAcceptanceThreshold: 60 } });
    const detail = await api((await import('@/app/api/groups/[id]/route')).GET, '/x', { token: await (await import('./helpers')).tokenFor(admin), params: { id: groupId } });
    expect(detail.json.data.settings.acceptanceThreshold).toBe(60);
    expect((await api(settings.GET, '/x', auth)).json.data.minAcceptanceThreshold).toBe(60);
  });

  it('lists the audit trail with filters and reports storage statistics', async () => {
    const auth = await cookie();
    await AuditLog.create({ actorType: 'system', actorId: 'system', action: 'draw.palette_empty', metadata: { severity: 'alert' } });
    await AuditLog.create({ actorType: 'admin', actorId: 'admin', action: 'palette.created' });
    // Legacy/minimised rows without a metadata field must still serialise as an object (regression).
    await AuditLog.collection.insertOne({ actorType: 'admin', actorId: 'admin', action: 'legacy.entry', createdAt: new Date() });
    const all = await api(auditRoute.GET, '/x', auth);
    expect(all.json.data.total).toBe(3);
    expect(all.json.data.items.every((i: { metadata: unknown }) => typeof i.metadata === 'object' && i.metadata !== null)).toBe(true);
    expect((await api(auditRoute.GET, '/x', { ...auth, query: { alertsOnly: 'true' } })).json.data.total).toBe(1);
    expect((await api(auditRoute.GET, '/x', { ...auth, query: { action: 'palette.' } })).json.data.total).toBe(1);
    const stats = await api(storageStats.GET, '/x', auth);
    expect(stats.json.data).toMatchObject({ totalBytes: 0, totalPhotos: 0 });
  });
});

describe('security headers and CORS (proxy)', () => {
  const req = (method: string, origin?: string) =>
    new NextRequest('http://localhost:3000/api/groups', { method, headers: origin ? { origin } : {} });

  it('adds security headers to every response', () => {
    const res = proxy(req('GET'));
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('strict-transport-security')).toContain('max-age');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('only allows configured origins', () => {
    process.env.CORS_ALLOWED_ORIGINS = 'https://admin.example.test';
    const allowed = proxy(req('OPTIONS', 'https://admin.example.test'));
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://admin.example.test');
    const denied = proxy(req('OPTIONS', 'https://evil.example'));
    expect(denied.status).toBe(403);
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    delete process.env.CORS_ALLOWED_ORIGINS;
  });
});

describe('operational error reasons', () => {
  it('maps database and configuration failures to 503 with a coarse reason', async () => {
    const { toAppError } = await import('@/server/http');
    const db = toAppError(Object.assign(new Error('bad auth'), { name: 'MongoServerError' }));
    expect(db).toMatchObject({ status: 503, details: { reason: 'DATABASE' } });
    const config = toAppError(new Error('Invalid environment configuration: MONGODB_URI: Required'));
    expect(config).toMatchObject({ status: 503, details: { reason: 'CONFIG' } });
    expect(JSON.stringify(config.details)).not.toContain('MONGODB_URI');
    expect(toAppError(new Error('boom'))).toMatchObject({ status: 500 });
  });
});
