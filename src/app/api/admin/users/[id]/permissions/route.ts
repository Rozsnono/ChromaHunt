import { adminPermissionsSchema, objectIdSchema } from '@/shared';
import { requirePermission } from '@/server/auth';
import { notFound } from '@/server/errors';
import { handle, ok, readJson } from '@/server/http';
import { setUserPermissions } from '@/server/services/admin';

/** PUT - replaces the user's permission strings (permissions.manage). */
export const PUT = handle<{ id: string }>(async (req, { requestId, params }) => {
  const actor = await requirePermission(req, 'permissions.manage');
  if (!objectIdSchema.safeParse(params.id).success) throw notFound();
  const { permissions } = await readJson(req, adminPermissionsSchema);
  return ok(requestId, await setUserPermissions(params.id, permissions, actor));
});
