import { calendarQuerySchema } from '@/shared';
import { requireUser } from '@/server/auth';
import { handle, ok, readQuery } from '@/server/http';
import { getCalendar } from '@/server/services/gallery';

/** GET /api/groups/:id/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD - accepted photos within the retention window. */
export const GET = handle<{ id: string }>(async (req, { requestId, params }) => {
  const user = await requireUser(req);
  const { from, to } = readQuery(req, calendarQuerySchema);
  return ok(requestId, await getCalendar(user, params.id, from, to));
});
