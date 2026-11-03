import { requireUser } from '@/server/auth';
import { handle, ok } from '@/server/http';
import { leaveGroup } from '@/server/services/groups';

/** POST /api/groups/:id/leave - leaves the group; an admin's role passes to the oldest member. */
export const POST = handle<{ id: string }>(async (req, { requestId, params }) => {
  await leaveGroup(await requireUser(req), params.id);
  return ok(requestId, { left: true });
});
