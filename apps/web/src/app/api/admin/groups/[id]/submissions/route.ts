import { requirePermission } from '@/server/auth';
import { handle, ok } from '@/server/http';
import { listGroupSubmissions } from '@/server/services/admin';

/** GET - recent accepted photos of a group (for moderation). */
export const GET = handle<{ id: string }>(async (req, { requestId, params }) => {
  await requirePermission(req, 'groups.manage');
  return ok(requestId, await listGroupSubmissions(params.id));
});
