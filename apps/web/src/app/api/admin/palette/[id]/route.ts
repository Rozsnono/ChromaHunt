import { objectIdSchema, paletteColorSchema } from '@chromahunt/shared';
import { requirePermission } from '@/server/auth';
import { notFound } from '@/server/errors';
import { handle, ok, readJson } from '@/server/http';
import { deleteColor, updateColor } from '@/server/services/admin';

const patchSchema = paletteColorSchema.partial().strict();

export const PATCH = handle<{ id: string }>(async (req, { requestId, params }) => {
  const actor = await requirePermission(req, 'palette.manage');
  if (!objectIdSchema.safeParse(params.id).success) throw notFound();
  return ok(requestId, await updateColor(params.id, await readJson(req, patchSchema), actor));
});

export const DELETE = handle<{ id: string }>(async (req, { requestId, params }) => {
  const actor = await requirePermission(req, 'palette.manage');
  if (!objectIdSchema.safeParse(params.id).success) throw notFound();
  await deleteColor(params.id, actor);
  return ok(requestId, { deleted: true });
});
