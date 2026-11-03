import { requireUser } from '@/server/auth';
import { handle, ok } from '@/server/http';
import { listJoinRequests } from '@/server/services/groups';

/** GET /api/groups/:id/join-requests - pending requests (group admin only). */
export const GET = handle<{ id: string }>(async (req, { requestId, params }) =>
  ok(requestId, await listJoinRequests(await requireUser(req), params.id)));
