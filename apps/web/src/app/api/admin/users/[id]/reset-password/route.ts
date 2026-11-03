import { objectIdSchema } from '@chromahunt/shared';
import { requirePermission } from '@/server/auth';
import { notFound } from '@/server/errors';
import { handle, ok } from '@/server/http';
import { adminResetPassword } from '@/server/services/auth';

/** POST - sets a random temporary password (shown once) and forces a change at the next login. */
export const POST = handle<{ id: string }>(async (req, { requestId, params }) => {
  const actor = await requirePermission(req, 'users.manage');
  if (!objectIdSchema.safeParse(params.id).success) throw notFound();
  return ok(requestId, await adminResetPassword(params.id, actor));
});
