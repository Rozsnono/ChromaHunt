import { joinDecisionSchema } from '@chromahunt/shared';
import { requireUser } from '@/server/auth';
import { handle, ok, readJson } from '@/server/http';
import { decideJoinRequest } from '@/server/services/groups';

/** POST /api/groups/:id/join-requests/:reqId/decision - approve or reject (group admin only). */
export const POST = handle<{ id: string; reqId: string }>(async (req, { requestId, params }) => {
  const user = await requireUser(req);
  const { decision } = await readJson(req, joinDecisionSchema);
  return ok(requestId, await decideJoinRequest(user, params.id, params.reqId, decision));
});
