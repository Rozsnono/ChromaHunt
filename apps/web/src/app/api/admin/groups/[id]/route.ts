import { requirePermission } from '@/server/auth';
import { handle, ok } from '@/server/http';
import { getGroupAdmin } from '@/server/services/admin';

export const GET = handle<{ id: string }>(async (req, { requestId, params }) => {
  await requirePermission(req, 'groups.manage');
  return ok(requestId, await getGroupAdmin(params.id));
});
