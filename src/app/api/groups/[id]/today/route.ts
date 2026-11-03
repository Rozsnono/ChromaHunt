import { requireUser } from '@/server/auth';
import { handle, ok } from '@/server/http';
import { getToday } from '@/server/services/gallery';

/** GET /api/groups/:id/today - today's colour, deadline and the caller's progress. */
export const GET = handle<{ id: string }>(async (req, { requestId, params }) =>
  ok(requestId, await getToday(await requireUser(req), params.id)));
