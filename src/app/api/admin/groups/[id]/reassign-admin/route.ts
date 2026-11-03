import { adminReassignSchema, objectIdSchema } from '@/shared';
import { requirePermission } from '@/server/auth';
import { notFound } from '@/server/errors';
import { handle, ok, readJson } from '@/server/http';
import { reassignGroupAdmin } from '@/server/services/admin';

export const POST = handle<{ id: string }>(async (req, { requestId, params }) => {
  const actor = await requirePermission(req, 'groups.manage');
  if (!objectIdSchema.safeParse(params.id).success) throw notFound();
  const { userId } = await readJson(req, adminReassignSchema);
  await reassignGroupAdmin(params.id, userId, actor);
  return ok(requestId, { reassigned: true });
});
