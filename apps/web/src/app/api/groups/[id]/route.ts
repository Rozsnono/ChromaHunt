import { requireUser } from '@/server/auth';
import { handle, ok } from '@/server/http';
import { getGroupDetail } from '@/server/services/groups';

/** GET /api/groups/:id - members, effective settings and the latest assignment. */
export const GET = handle<{ id: string }>(async (req, { requestId, params }) =>
  ok(requestId, await getGroupDetail(await requireUser(req), params.id)));
