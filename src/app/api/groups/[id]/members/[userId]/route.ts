import { requireUser } from '@/server/auth';
import { handle, ok } from '@/server/http';
import { kickMember } from '@/server/services/groups';

/** DELETE /api/groups/:id/members/:userId - group admin removes a member (and their photos). */
export const DELETE = handle<{ id: string; userId: string }>(async (req, { requestId, params }) => {
  await kickMember(await requireUser(req), params.id, params.userId);
  return ok(requestId, { removed: true });
});
