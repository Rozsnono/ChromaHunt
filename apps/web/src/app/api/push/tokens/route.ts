import { z } from 'zod';
import { deviceIdSchema, pushTokenSchema } from '@chromahunt/shared';
import { requireUser } from '@/server/auth';
import { handle, ok, readJson, readQuery } from '@/server/http';
import { User } from '@/server/models';
import { savePushToken } from '@/server/services/auth';

/** GET /api/push/tokens - the devices registered for push (token values are not returned). */
export const GET = handle(async (req, { requestId }) => {
  const user = await requireUser(req);
  return ok(requestId, user.pushTokens.map((t) => ({ deviceId: t.deviceId, createdAt: t.createdAt })));
});

/** POST /api/push/tokens - registers or replaces the Expo push token of a device. */
export const POST = handle(async (req, { requestId }) => {
  const user = await requireUser(req);
  await savePushToken(user, await readJson(req, pushTokenSchema));
  return ok(requestId, { registered: true }, { status: 201 });
});

/** DELETE /api/push/tokens?deviceId=... - unregisters a device (e.g. notifications turned off). */
export const DELETE = handle(async (req, { requestId }) => {
  const user = await requireUser(req);
  const { deviceId } = readQuery(req, z.object({ deviceId: deviceIdSchema }));
  await User.updateOne({ _id: user._id }, { $pull: { pushTokens: { deviceId } } });
  return ok(requestId, { removed: true });
});
