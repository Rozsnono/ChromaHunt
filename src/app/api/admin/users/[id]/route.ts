import { adminUserPatchSchema, objectIdSchema } from '@/shared';
import { requirePermission } from '@/server/auth';
import { notFound } from '@/server/errors';
import { handle, ok, readJson } from '@/server/http';
import { deleteAccount } from '@/server/services/account';
import { getUserDetail, updateUser } from '@/server/services/admin';

const checkId = (id: string) => {
  if (!objectIdSchema.safeParse(id).success) throw notFound();
};

export const GET = handle<{ id: string }>(async (req, { requestId, params }) => {
  await requirePermission(req, 'users.manage');
  checkId(params.id);
  return ok(requestId, await getUserDetail(params.id));
});

/** PATCH - disable/enable a user (disabled users cannot log in; their data stays). */
export const PATCH = handle<{ id: string }>(async (req, { requestId, params }) => {
  const actor = await requirePermission(req, 'users.manage');
  checkId(params.id);
  return ok(requestId, await updateUser(params.id, await readJson(req, adminUserPatchSchema), actor));
});

/** DELETE - permanent account deletion on behalf of a user (same cascade as self deletion). */
export const DELETE = handle<{ id: string }>(async (req, { requestId, params }) => {
  const actor = await requirePermission(req, 'users.manage');
  checkId(params.id);
  return ok(requestId, await deleteAccount(params.id, actor));
});
