import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as intentRoute from '@/app/api/groups/[id]/uploads/intent/route';
import * as putRoute from '@/app/api/uploads/[submissionId]/route';
import * as imageRoute from '@/app/api/submissions/[id]/image/route';
import * as calendarRoute from '@/app/api/groups/[id]/calendar/route';
import * as todayRoute from '@/app/api/groups/[id]/today/route';
import { DailyAssignment, Submission } from '@/server/models';
import {
  api,
  initModels,
  installMemoryStorage,
  makeGroup,
  makeUser,
  resetDb,
  seedPalette,
  solidJpeg,
  tokenFor,
  uploadPhoto,
  type MemoryStorage,
} from './helpers';

let storage: MemoryStorage;
beforeAll(initModels);
beforeEach(async () => {
  await resetDb();
  storage = installMemoryStorage();
  await seedPalette([['Red', '#cc2222']]);
});

async function scene(settings = {}) {
  const admin = await makeUser();
  const member = await makeUser();
  const outsider = await makeUser();
  const g = await makeGroup(admin, [member], settings);
  return { admin, member, outsider, ...g };
}

describe('upload pipeline', () => {
  it('accepts a photo that matches the colour and stores a sanitised JPEG', async () => {
    const { member, groupId } = await scene();
    const result = await uploadPhoto(member, groupId, await solidJpeg('#cc2222'));
    expect(result.finalize?.json.data.status).toBe('accepted');
    expect(result.finalize?.json.data.closenessScore).toBeGreaterThanOrEqual(95);
    expect(storage.objects.size).toBe(1);
    const sub = await Submission.findById(result.submissionId).lean();
    expect(sub?.status).toBe('accepted');
    expect(sub?.exifStripped).toBe(true);
    expect(sub?.storageKey).toContain(`groups/${groupId}/`);
  });

  it('strips EXIF data and downsizes to 1080 px on the server', async () => {
    const { member, groupId } = await scene();
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#cc2222' } })
      .withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-owner' } } })
      .jpeg()
      .toBuffer();
    expect((await sharp(big).metadata()).exif).toBeTruthy();
    const result = await uploadPhoto(member, groupId, big);
    expect(result.finalize?.json.data.status).toBe('accepted');
    const stored = [...storage.objects.values()][0]!;
    const meta = await sharp(stored).metadata();
    expect(meta.exif).toBeUndefined();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1080);
  });

  it('rejects a photo of the wrong colour and deletes it from storage immediately', async () => {
    const { member, groupId } = await scene();
    const result = await uploadPhoto(member, groupId, await solidJpeg('#2244cc'));
    expect(result.finalize?.json.data.status).toBe('rejected');
    expect(result.finalize?.json.data.closenessScore).toBeNull(); // only the fact of rejection is visible
    expect(storage.objects.size).toBe(0);
    expect((await Submission.findById(result.submissionId).lean())?.storageKey).toBeNull();
  });

  it('ignores a forged client score (server recomputes everything)', async () => {
    const { member, groupId } = await scene();
    const token = await tokenFor(member);
    const image = await solidJpeg('#2244cc');
    const intent = await api(intentRoute.POST, `/api/groups/${groupId}/uploads/intent`, {
      token,
      params: { id: groupId },
      body: { idempotencyKey: randomUUID(), sizeBytes: image.length, contentType: 'image/jpeg', capturedAt: new Date().toISOString(), clientColorScore: 100 },
    });
    const { submissionId, uploadToken } = intent.json.data;
    await api(putRoute.PUT, '/x', { method: 'PUT', token, params: { submissionId }, raw: image, headers: { 'x-upload-token': uploadToken } });
    const { verifySubmission } = await import('@/server/services/verification');
    expect((await verifySubmission(submissionId)).status).toBe('rejected');
  });

  it('lets a rejected user retake until the required count is reached', async () => {
    const { member, groupId } = await scene();
    expect((await uploadPhoto(member, groupId, await solidJpeg('#2244cc'))).finalize?.json.data.status).toBe('rejected');
    expect((await uploadPhoto(member, groupId, await solidJpeg('#cc2222'))).finalize?.json.data.status).toBe('accepted');
    const third = await uploadPhoto(member, groupId, await solidJpeg('#cc2222'));
    expect(third.intent.json.error?.code).toBe('QUOTA_REACHED');
  });

  it('supports several photos per day when the group requires them', async () => {
    const { member, groupId } = await scene({ requiredPhotosPerDay: 2 });
    expect((await uploadPhoto(member, groupId, await solidJpeg('#cc2222'))).finalize?.json.data.status).toBe('accepted');
    expect((await uploadPhoto(member, groupId, await solidJpeg('#cc2222'))).finalize?.json.data.status).toBe('accepted');
    expect((await uploadPhoto(member, groupId, await solidJpeg('#cc2222'))).intent.json.error?.code).toBe('QUOTA_REACHED');
  });

  it('upload tokens are single use, bound to the user and the submission', async () => {
    const { member, outsider, groupId } = await scene();
    const token = await tokenFor(member);
    const image = await solidJpeg('#cc2222');
    const intent = await api(intentRoute.POST, `/api/groups/${groupId}/uploads/intent`, {
      token,
      params: { id: groupId },
      body: { idempotencyKey: randomUUID(), sizeBytes: image.length, contentType: 'image/jpeg', capturedAt: new Date().toISOString() },
    });
    const { submissionId, uploadToken } = intent.json.data;
    const put = (t: string, bearer = token) =>
      api(putRoute.PUT, '/x', { method: 'PUT', token: bearer, params: { submissionId }, raw: image, headers: { 'x-upload-token': t } });

    expect((await put(uploadToken, await tokenFor(outsider))).json.error?.code).toBe('UPLOAD_TOKEN_INVALID');
    expect((await put('garbage')).json.error?.code).toBe('UPLOAD_TOKEN_INVALID');
    expect((await put(uploadToken)).status).toBe(200);
    expect((await put(uploadToken)).json.error?.code).toBe('UPLOAD_TOKEN_INVALID'); // replay
  });

  it('is idempotent per key: a retry gets a fresh token, a finished upload gets its state', async () => {
    const { member, groupId } = await scene();
    const token = await tokenFor(member);
    const image = await solidJpeg('#cc2222');
    const key = randomUUID();
    const body = { idempotencyKey: key, sizeBytes: image.length, contentType: 'image/jpeg', capturedAt: new Date().toISOString() };
    const a = await api(intentRoute.POST, `/api/groups/${groupId}/uploads/intent`, { token, params: { id: groupId }, body });
    const b = await api(intentRoute.POST, `/api/groups/${groupId}/uploads/intent`, { token, params: { id: groupId }, body });
    expect(b.json.data.submissionId).toBe(a.json.data.submissionId);
    expect(b.json.data.uploadToken).not.toBe(a.json.data.uploadToken);
    expect(await Submission.countDocuments({})).toBe(1);

    const done = await uploadPhoto(member, groupId, image, key);
    expect(done.intent.json.data.submissionId).toBe(a.json.data.submissionId);
    const final = await api(intentRoute.POST, `/api/groups/${groupId}/uploads/intent`, { token, params: { id: groupId }, body });
    expect(final.json.data.uploadToken).toBeNull();
  });

  it('rejects uploads after the deadline and stores nothing', async () => {
    const { member, groupId, assignment } = await scene();
    const token = await tokenFor(member);
    const image = await solidJpeg('#cc2222');
    const intent = await api(intentRoute.POST, `/api/groups/${groupId}/uploads/intent`, {
      token,
      params: { id: groupId },
      body: { idempotencyKey: randomUUID(), sizeBytes: image.length, contentType: 'image/jpeg', capturedAt: new Date().toISOString() },
    });
    await DailyAssignment.updateOne({ _id: assignment._id }, { deadlineAt: new Date(Date.now() - 1000) });
    const { submissionId, uploadToken } = intent.json.data;
    const put = await api(putRoute.PUT, '/x', { method: 'PUT', token, params: { submissionId }, raw: image, headers: { 'x-upload-token': uploadToken } });
    expect(put.json.error?.code).toBe('DEADLINE_PASSED');
    expect(storage.objects.size).toBe(0);
    expect((await Submission.findById(submissionId).lean())?.status).toBe('rejected');
    // A new intent after the deadline is refused as well.
    expect((await uploadPhoto(member, groupId, image)).intent.json.error?.code).toBe('DEADLINE_PASSED');
  });

  it('rejects files that are not images and oversized bodies', async () => {
    const { member, groupId } = await scene();
    const junk = await uploadPhoto(member, groupId, Buffer.from('definitely not an image'));
    expect(junk.put?.json.error?.code).toBe('INVALID_IMAGE');
    expect(storage.objects.size).toBe(0);

    const huge = Buffer.alloc(5 * 1024 * 1024, 1);
    const token = await tokenFor(member);
    const tooBig = await api(intentRoute.POST, `/api/groups/${groupId}/uploads/intent`, {
      token,
      params: { id: groupId },
      body: { idempotencyKey: randomUUID(), sizeBytes: huge.length, contentType: 'image/jpeg', capturedAt: new Date().toISOString() },
    });
    expect(tooBig.status).toBe(413);
  });

  it('answers 503 when storage is down and lets the client retry with the same token', async () => {
    const { member, groupId } = await scene();
    const token = await tokenFor(member);
    const image = await solidJpeg('#cc2222');
    const intent = await api(intentRoute.POST, `/api/groups/${groupId}/uploads/intent`, {
      token,
      params: { id: groupId },
      body: { idempotencyKey: randomUUID(), sizeBytes: image.length, contentType: 'image/jpeg', capturedAt: new Date().toISOString() },
    });
    const { submissionId, uploadToken } = intent.json.data;
    const put = () => api(putRoute.PUT, '/x', { method: 'PUT', token, params: { submissionId }, raw: image, headers: { 'x-upload-token': uploadToken } });
    storage.failPut = true;
    const down = await put();
    expect(down.status).toBeGreaterThanOrEqual(500);
    storage.failPut = false;
    expect((await put()).status).toBe(200);
  });

  it('non-members cannot request an upload', async () => {
    const { outsider, groupId } = await scene();
    expect((await uploadPhoto(outsider, groupId, await solidJpeg('#cc2222'))).intent.status).toBe(404);
  });
});

describe('image delivery and calendar', () => {
  async function acceptedPhoto() {
    const s = await scene();
    const result = await uploadPhoto(s.member, s.groupId, await solidJpeg('#cc2222'));
    return { ...s, submissionId: result.submissionId as string };
  }
  const get = async (user: Awaited<ReturnType<typeof makeUser>>, id: string) =>
    api(imageRoute.GET, `/api/submissions/${id}/image`, { token: await tokenFor(user), params: { id } });

  it('serves accepted images to group members with private caching only', async () => {
    const { admin, member, submissionId } = await acceptedPhoto();
    for (const user of [member, admin]) {
      const res = await get(user, submissionId);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('private, max-age=300');
      expect(res.headers.get('content-type')).toBe('image/jpeg');
    }
  });

  it('hides images from non-members and from unauthenticated callers', async () => {
    const { outsider, submissionId } = await acceptedPhoto();
    expect((await get(outsider, submissionId)).status).toBe(404);
    expect((await api(imageRoute.GET, '/x', { params: { id: submissionId } })).status).toBe(401);
  });

  it('enforces the retention window', async () => {
    const { member, submissionId } = await acceptedPhoto();
    await Submission.updateOne({ _id: submissionId }, { uploadedAt: new Date(Date.now() - 31 * 86400000) });
    expect((await get(member, submissionId)).status).toBe(404);
  });

  it('shows accepted photos in the calendar and never leaks storage keys', async () => {
    const { member, admin, groupId, assignment } = await acceptedPhoto();
    await uploadPhoto(admin, groupId, await solidJpeg('#2244cc')); // rejected: must not appear
    const res = await api(calendarRoute.GET, `/api/groups/${groupId}/calendar`, {
      token: await tokenFor(member),
      params: { id: groupId },
      query: { from: assignment.date, to: assignment.date },
    });
    expect(res.status).toBe(200);
    const day = res.json.data.days[0];
    expect(day.date).toBe(assignment.date);
    expect(day.colorHex).toBe('#cc2222');
    expect(day.photos).toHaveLength(1);
    expect(JSON.stringify(res.json)).not.toContain('storageKey');
    expect(JSON.stringify(res.json)).not.toContain('webdav');
  });

  it('reports progress on the today endpoint', async () => {
    const { member, groupId } = await acceptedPhoto();
    const res = await api(todayRoute.GET, `/api/groups/${groupId}/today`, { token: await tokenFor(member), params: { id: groupId } });
    expect(res.json.data.me).toMatchObject({ accepted: 1, remaining: 0, completed: true });
  });
});
