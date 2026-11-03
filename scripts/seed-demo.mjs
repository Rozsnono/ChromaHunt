/**
 * Seeds a running dev instance with demo data through the public API (palette, users, a group
 * with approved members and accepted photos). Development only.
 * Usage: ADMIN_PASSWORD=... node scripts/seed-demo.mjs [baseUrl]    (default http://localhost:3000)
 */
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

const base = process.argv[2] ?? 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; // the admin password of the instance you seed (never hard-coded)
if (!ADMIN_PASSWORD) throw new Error('Set ADMIN_PASSWORD to the admin password of the target instance.');
const USER_PASSWORD = 'Demo-password-123';

async function call(path, { method, body, token, cookie, raw, headers = {} } = {}) {
  method ??= body || raw ? 'POST' : 'GET';
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie, Origin: base } : {}),
      ...headers,
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

const login = await call('/api/admin/session', { body: { password: ADMIN_PASSWORD } });
if (login.status !== 200) throw new Error(`Admin login failed: ${login.status}`);
const cookie = login.headers.get('set-cookie').split(';')[0];

const palette = [
  ['Piros', '#d32f2f'], ['Narancs', '#f57c00'], ['Sárga', '#fbc02d'], ['Zöld', '#388e3c'], ['Türkiz', '#00897b'],
  ['Kék', '#1976d2'], ['Lila', '#7b1fa2'], ['Rózsaszín', '#e91e63'], ['Barna', '#6d4c41'], ['Szürke', '#757575'],
];
for (const [name, hex] of palette) await call('/api/admin/palette', { cookie, body: { name, hex } });

const names = ['Anna', 'Bence', 'Csilla', 'Dávid', 'Eszter'];
const users = [];
for (const [i, displayName] of names.entries()) {
  const body = { email: `${displayName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()}@demo.test`, password: USER_PASSWORD, displayName, locale: 'hu', deviceId: `demo-device-${i}-xxxx`, acceptedPrivacy: true, privacyPolicyVersion: '1' };
  let r = await call('/api/auth/register', { body });
  if (r.status !== 201) r = await call('/api/auth/login', { body: { email: body.email, password: USER_PASSWORD, deviceId: body.deviceId } });
  if (!r.json?.data) throw new Error(`auth failed for ${displayName}: ${r.status} ${JSON.stringify(r.json)}`);
  users.push({ displayName, ...r.json.data.user, token: r.json.data.tokens.accessToken });
}

const [owner, ...others] = users;
const group = await call('/api/groups', { token: owner.token, body: { name: 'Pécsi színvadászok', settings: { scoringEnabled: true, requiredPhotosPerDay: 1 } } });
const groupId = group.json.data.id;
for (const member of others) {
  const invite = await call(`/api/groups/${groupId}/invites`, { token: owner.token, method: 'POST' });
  const join = await call('/api/groups/join', { token: member.token, body: { code: invite.json.data.code } });
  await call(`/api/groups/${groupId}/join-requests/${join.json.data.requestId}/decision`, { token: owner.token, body: { decision: 'approve' } });
}

const today = await call(`/api/groups/${groupId}/today`, { token: owner.token });
const color = today.json.data.assignment.colorHex;
for (const [i, member] of users.slice(0, 4).entries()) {
  // A slightly different shade per member, all close to the assigned colour.
  const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: color } })
    .modulate({ brightness: 1 + (i - 1.5) * 0.04 })
    .jpeg()
    .toBuffer();
  const intent = await call(`/api/groups/${groupId}/uploads/intent`, {
    token: member.token,
    body: { idempotencyKey: randomUUID(), sizeBytes: jpeg.length, contentType: 'image/jpeg', capturedAt: new Date().toISOString() },
  });
  const { submissionId, uploadToken } = intent.json.data;
  await call(`/api/uploads/${submissionId}`, { method: 'PUT', token: member.token, raw: jpeg, headers: { 'Content-Type': 'image/jpeg', 'X-Upload-Token': uploadToken } });
  const fin = await call(`/api/submissions/${submissionId}/finalize`, { token: member.token, method: 'POST' });
  console.log(member.displayName, '->', fin.json.data.status);
}

await call(`/api/admin/users/${others[0].id}/permissions`, { cookie, method: 'PUT', body: { permissions: ['palette.manage', 'audit.view'] } });
console.log(`Done. Admin panel: ${base}/admin`);
console.log(`Demo users: <name>@demo.test / ${USER_PASSWORD}`);
