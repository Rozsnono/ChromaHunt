import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as register from '@/app/api/auth/register/route';
import * as login from '@/app/api/auth/login/route';
import * as refresh from '@/app/api/auth/refresh/route';
import * as logout from '@/app/api/auth/logout/route';
import * as changePassword from '@/app/api/auth/change-password/route';
import * as enroll from '@/app/api/auth/biometric/enroll/route';
import * as bioLogin from '@/app/api/auth/biometric/login/route';
import * as me from '@/app/api/me/route';
import { BiometricBinding, RefreshToken, User } from '@/server/models';
import { adminResetPassword } from '@/server/services/auth';
import { api, initModels, makeUser, PASSWORD, resetDb } from './helpers';

const device = 'device-aaaaaaaa';
const body = (over: Record<string, unknown> = {}) => ({
  email: 'New.User@Example.test',
  password: PASSWORD,
  displayName: 'New User',
  deviceId: device,
  acceptedPrivacy: true,
  privacyPolicyVersion: '1',
  ...over,
});

beforeAll(initModels);
beforeEach(resetDb);

describe('registration', () => {
  it('creates the account, lowercases the e-mail and logs in immediately', async () => {
    const res = await api(register.POST, '/api/auth/register', { body: body() });
    expect(res.status).toBe(201);
    expect(res.json.success).toBe(true);
    expect(res.json.meta.requestId).toBeTruthy();
    expect(res.json.data.user.email).toBe('new.user@example.test');
    expect(res.json.data.tokens.accessToken).toBeTruthy();
    const stored = await User.findOne({ email: 'new.user@example.test' }).lean();
    expect(stored?.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('requires accepting the privacy policy (checkbox and current version)', async () => {
    expect((await api(register.POST, '/api/auth/register', { body: body({ acceptedPrivacy: false }) })).status).toBe(400);
    const stale = await api(register.POST, '/api/auth/register', { body: body({ privacyPolicyVersion: '0' }) });
    expect(stale.json.error?.code).toBe('PRIVACY_NOT_ACCEPTED');
  });

  it('rejects duplicate e-mails and weak passwords', async () => {
    await api(register.POST, '/api/auth/register', { body: body() });
    expect((await api(register.POST, '/api/auth/register', { body: body() })).json.error?.code).toBe('EMAIL_TAKEN');
    const weak = await api(register.POST, '/api/auth/register', { body: body({ email: 'b@example.test', password: 'short' }) });
    expect(weak.json.error?.code).toBe('VALIDATION_ERROR');
  });
});

describe('login', () => {
  it('gives the same error for unknown e-mail and wrong password', async () => {
    const user = await makeUser();
    const wrong = await api(login.POST, '/api/auth/login', { body: { email: user.email, password: 'nope-nope-nope', deviceId: device } });
    const unknown = await api(login.POST, '/api/auth/login', { body: { email: 'x@example.test', password: 'nope-nope-nope', deviceId: device } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json.error?.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.json.error?.code).toBe('INVALID_CREDENTIALS');
  });

  it('blocks disabled users', async () => {
    const user = await makeUser({ isDisabled: true });
    const res = await api(login.POST, '/api/auth/login', { body: { email: user.email, password: PASSWORD, deviceId: device } });
    expect(res.json.error?.code).toBe('ACCOUNT_DISABLED');
  });

  it('rate limits repeated attempts for one e-mail', async () => {
    const attempt = () =>
      api(login.POST, '/api/auth/login', { body: { email: 'victim@example.test', password: 'wrong-password', deviceId: device } });
    let last = await attempt();
    for (let i = 0; i < 10; i++) last = await attempt();
    expect(last.status).toBe(429);
    expect(last.headers.get('retry-after')).toBeTruthy();
  });
});

describe('refresh tokens', () => {
  async function session() {
    const user = await makeUser();
    const res = await api(login.POST, '/api/auth/login', { body: { email: user.email, password: PASSWORD, deviceId: device } });
    return { user, tokens: res.json.data.tokens as { accessToken: string; refreshToken: string } };
  }

  it('rotates on every use and stores only hashes', async () => {
    const { tokens } = await session();
    const first = await api(refresh.POST, '/api/auth/refresh', { body: { refreshToken: tokens.refreshToken, deviceId: device } });
    expect(first.status).toBe(200);
    expect(first.json.data.tokens.refreshToken).not.toBe(tokens.refreshToken);
    const stored = await RefreshToken.find({}).lean();
    expect(stored.every((t) => t.tokenHash !== tokens.refreshToken)).toBe(true);
    expect(new Set(stored.map((t) => t.familyId)).size).toBe(1);
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const { tokens } = await session();
    const rotated = await api(refresh.POST, '/api/auth/refresh', { body: { refreshToken: tokens.refreshToken, deviceId: device } });
    const reuse = await api(refresh.POST, '/api/auth/refresh', { body: { refreshToken: tokens.refreshToken, deviceId: device } });
    expect(reuse.json.error?.code).toBe('TOKEN_REUSE_DETECTED');
    // The legitimate (newest) token is dead too.
    const afterwards = await api(refresh.POST, '/api/auth/refresh', {
      body: { refreshToken: rotated.json.data.tokens.refreshToken, deviceId: device },
    });
    expect(afterwards.status).toBe(401);
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0);
  });

  it('refuses a token presented from another device', async () => {
    const { tokens } = await session();
    const res = await api(refresh.POST, '/api/auth/refresh', { body: { refreshToken: tokens.refreshToken, deviceId: 'device-bbbbbbbb' } });
    expect(res.status).toBe(401);
  });

  it('logout revokes the family', async () => {
    const { tokens } = await session();
    await api(logout.POST, '/api/auth/logout', { body: { refreshToken: tokens.refreshToken, deviceId: device } });
    const res = await api(refresh.POST, '/api/auth/refresh', { body: { refreshToken: tokens.refreshToken, deviceId: device } });
    expect(res.json.error?.code).toBe('TOKEN_REUSE_DETECTED');
  });
});

describe('password change, admin reset and biometrics', () => {
  it('admin reset forces a password change and revokes sessions and biometrics', async () => {
    const user = await makeUser();
    const first = await api(login.POST, '/api/auth/login', { body: { email: user.email, password: PASSWORD, deviceId: device } });
    const token = first.json.data.tokens.accessToken as string;
    const secret = 'x'.repeat(40);
    await api(enroll.POST, '/api/auth/biometric/enroll', { token, body: { deviceId: device, secret } });
    expect(await BiometricBinding.countDocuments({ userId: user._id })).toBe(1);

    const { temporaryPassword } = await adminResetPassword(String(user._id), { type: 'admin', id: 'admin' });
    expect(await BiometricBinding.countDocuments({ userId: user._id })).toBe(0);
    expect((await api(bioLogin.POST, '/api/auth/biometric/login', { body: { deviceId: device, secret } })).status).toBe(401);
    expect(await RefreshToken.countDocuments({ userId: user._id, revokedAt: null })).toBe(0);

    const again = await api(login.POST, '/api/auth/login', { body: { email: user.email, password: temporaryPassword, deviceId: device } });
    expect(again.json.data.user.mustChangePassword).toBe(true);
    const temp = again.json.data.tokens.accessToken as string;
    // Everything except change-password (and reading the profile) is blocked.
    expect((await api(me.PATCH, '/api/me', { method: 'PATCH', token: temp, body: { displayName: 'Nope' } })).json.error?.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const changed = await api(changePassword.POST, '/api/auth/change-password', {
      token: temp,
      body: { currentPassword: temporaryPassword, newPassword: 'A-brand-new-password-1', deviceId: device },
    });
    expect(changed.status).toBe(200);
    expect(changed.json.data.user.mustChangePassword).toBe(false);
  });

  it('biometric login works with the enrolled device secret only', async () => {
    const user = await makeUser();
    const res = await api(login.POST, '/api/auth/login', { body: { email: user.email, password: PASSWORD, deviceId: device } });
    const secret = 'S'.repeat(40);
    await api(enroll.POST, '/api/auth/biometric/enroll', { token: res.json.data.tokens.accessToken, body: { deviceId: device, secret } });
    const ok = await api(bioLogin.POST, '/api/auth/biometric/login', { body: { deviceId: device, secret } });
    expect(ok.status).toBe(200);
    const wrongDevice = await api(bioLogin.POST, '/api/auth/biometric/login', { body: { deviceId: 'device-cccccccc', secret } });
    expect(wrongDevice.status).toBe(401);
    // Logout removes the binding.
    await api(logout.POST, '/api/auth/logout', { body: { refreshToken: ok.json.data.tokens.refreshToken, deviceId: device } });
    expect((await api(bioLogin.POST, '/api/auth/biometric/login', { body: { deviceId: device, secret } })).status).toBe(401);
  });

  it('changing the password revokes other sessions and biometric bindings', async () => {
    const user = await makeUser();
    const res = await api(login.POST, '/api/auth/login', { body: { email: user.email, password: PASSWORD, deviceId: device } });
    const { accessToken, refreshToken } = res.json.data.tokens;
    await api(enroll.POST, '/api/auth/biometric/enroll', { token: accessToken, body: { deviceId: device, secret: 'Z'.repeat(40) } });
    await api(changePassword.POST, '/api/auth/change-password', {
      token: accessToken,
      body: { currentPassword: PASSWORD, newPassword: 'Another-password-123', deviceId: device },
    });
    expect(await BiometricBinding.countDocuments({ userId: user._id })).toBe(0);
    const old = await api(refresh.POST, '/api/auth/refresh', { body: { refreshToken, deviceId: device } });
    expect(old.status).toBe(401);
  });
});
