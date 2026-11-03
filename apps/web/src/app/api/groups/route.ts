import { createGroupSchema } from '@chromahunt/shared';
import { requireUser } from '@/server/auth';
import { handle, ok, readJson } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { createGroup, listGroups } from '@/server/services/groups';

/** GET /api/groups - groups the user belongs to. */
export const GET = handle(async (req, { requestId }) => ok(requestId, await listGroups(await requireUser(req))));

/** POST /api/groups - any registered user may create a group and becomes its admin. */
export const POST = handle(async (req, { requestId }) => {
  const user = await requireUser(req);
  await enforceRateLimit(`create-group:${user._id}`, 10, 3600);
  return ok(requestId, await createGroup(user, await readJson(req, createGroupSchema)), { status: 201 });
});
