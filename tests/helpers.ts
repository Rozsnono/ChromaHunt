/** Shared helpers for integration tests (real routes + services, in-memory MongoDB and storage). */
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import mongoose from 'mongoose';
import { hexToLab } from '@/shared';
import { connectDb } from '@/server/db';
import { ColorPalette, User, type UserDoc } from '@/server/models';
import { hashPassword } from '@/server/password';
import { setStorageDriver, type StorageDriver } from '@/server/storage/driver';
import { signAccessToken } from '@/server/tokens';

export const PASSWORD = 'Password123!!';
let passwordHash: string | undefined;

export interface MemoryStorage extends StorageDriver {
  objects: Map<string, Uint8Array>;
  failRemove: boolean;
  failPut: boolean;
}

export function installMemoryStorage(): MemoryStorage {
  const store: MemoryStorage = {
    objects: new Map(),
    failRemove: false,
    failPut: false,
    async put(key, data) {
      if (store.failPut) throw new Error('storage down');
      store.objects.set(key, data);
    },
    async get(key) {
      const data = store.objects.get(key);
      if (!data) return null;
      return { body: new Response(Buffer.from(data)).body as ReadableStream<Uint8Array>, size: data.byteLength, contentType: 'image/jpeg' };
    },
    async read(key) {
      return store.objects.get(key) ?? null;
    },
    async remove(key) {
      if (store.failRemove) throw new Error('storage down');
      store.objects.delete(key);
    },
  };
  setStorageDriver(store);
  return store;
}

/** Empties every collection but keeps the indexes. */
export async function resetDb(): Promise<void> {
  await connectDb();
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export async function initModels(): Promise<void> {
  await connectDb();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}

let counter = 0;
export async function makeUser(overrides: Partial<UserDoc> = {}): Promise<UserDoc> {
  passwordHash ??= await hashPassword(PASSWORD);
  counter++;
  const doc = await User.create({
    email: `user${counter}-${Date.now()}@example.test`,
    passwordHash,
    displayName: `User ${counter}`,
    termsAcceptedAt: new Date(),
    privacyPolicyVersion: '1',
    ...overrides,
  });
  return doc.toObject();
}

export async function tokenFor(user: UserDoc, deviceId = 'device-test-0001'): Promise<string> {
  return signAccessToken({ userId: String(user._id), deviceId, mustChangePassword: user.mustChangePassword });
}

export async function seedPalette(colors: Array<[string, string]> = [['Red', '#cc2222']]) {
  const docs = [];
  for (const [name, hex] of colors) docs.push(await ColorPalette.create({ name, hex, lab: [...hexToLab(hex)], isActive: true }));
  return docs.map((d) => d.toObject());
}

export async function solidJpeg(hex: string, size = 200): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: hex } }).jpeg().toBuffer();
}

type RouteHandler = (req: NextRequest, ctx: { params: Promise<never> }) => Promise<Response>;

export interface ApiInit {
  method?: string;
  token?: string;
  body?: unknown;
  raw?: Uint8Array;
  headers?: Record<string, string>;
  cookie?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
}

export interface ApiResult {
  status: number;
  headers: Headers;
  json: { success: boolean; data: any; error: { code: string; message: string; details: Record<string, unknown> } | null; meta: { requestId: string } };
  response: Response;
}

/** Invokes a Next.js route handler directly with a synthetic request. */
export async function api(handler: unknown, path: string, init: ApiInit = {}): Promise<ApiResult> {
  const url = new URL(`http://localhost:3000${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.cookie) headers.cookie = init.cookie;
  let body: BodyInit | undefined;
  if (init.raw) {
    body = Buffer.from(init.raw);
    headers['content-type'] ??= 'image/jpeg';
  } else if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers['content-type'] = 'application/json';
  }
  const method = init.method ?? (body ? 'POST' : 'GET');
  const req = new NextRequest(url, { method, headers, body });
  const response = await (handler as RouteHandler)(req, { params: Promise.resolve(init.params ?? {}) as Promise<never> });
  const text = await response.clone().text();
  let json = null as unknown as ApiResult['json'];
  try {
    json = JSON.parse(text);
  } catch {
    /* binary body */
  }
  return { status: response.status, headers: response.headers, json, response };
}

import { randomUUID } from 'node:crypto';
import type { GroupSettingsPatch } from '@/shared';
import { DailyAssignment, GroupMembership } from '@/server/models';
import { createGroup } from '@/server/services/groups';
import * as intentRoute from '@/app/api/groups/[id]/uploads/intent/route';
import * as putRoute from '@/app/api/uploads/[submissionId]/route';
import * as finalizeRoute from '@/app/api/submissions/[id]/finalize/route';

/** Creates a group (the admin gets the first colour drawn immediately) and adds members. */
export async function makeGroup(admin: UserDoc, members: UserDoc[] = [], settings: GroupSettingsPatch = {}) {
  const group = await createGroup(admin, { name: 'Test group', settings });
  let offset = 1;
  for (const m of members) {
    await GroupMembership.create({ groupId: group.id, userId: m._id, role: 'member', joinedAt: new Date(Date.now() + offset++ * 1000) });
  }
  const assignment = await DailyAssignment.findOne({ groupId: group.id }).lean();
  return { group, groupId: group.id as string, assignment: assignment! };
}

/** Runs the whole upload pipeline (intent -> PUT -> finalize) like the mobile app does. */
export async function uploadPhoto(user: UserDoc, groupId: string, image: Uint8Array, key: string = randomUUID()) {
  const token = await tokenFor(user);
  const intent = await api(intentRoute.POST, `/api/groups/${groupId}/uploads/intent`, {
    token,
    params: { id: groupId },
    body: {
      idempotencyKey: key,
      sizeBytes: image.byteLength,
      contentType: 'image/jpeg',
      capturedAt: new Date().toISOString(),
    },
  });
  if (!intent.json.success) return { intent, put: undefined, finalize: undefined };
  const { submissionId, uploadToken } = intent.json.data as { submissionId: string; uploadToken: string };
  const put = await api(putRoute.PUT, `/api/uploads/${submissionId}`, {
    method: 'PUT',
    token,
    params: { submissionId },
    raw: image,
    headers: { 'x-upload-token': uploadToken },
  });
  if (!put.json.success) return { intent, put, finalize: undefined, submissionId };
  const finalize = await api(finalizeRoute.POST, `/api/submissions/${submissionId}/finalize`, { token, params: { id: submissionId } });
  return { intent, put, finalize, submissionId };
}
