import { groupSettingsPatchSchema, objectIdSchema } from '@chromahunt/shared';
import { requirePermission } from '@/server/auth';
import { notFound } from '@/server/errors';
import { handle, ok, readJson } from '@/server/http';
import { getGroupAdmin, updateGroupSettingsAdmin } from '@/server/services/admin';

/** PATCH - global admin override of any group setting. */
export const PATCH = handle<{ id: string }>(async (req, { requestId, params }) => {
  const actor = await requirePermission(req, 'groups.manage');
  if (!objectIdSchema.safeParse(params.id).success) throw notFound();
  await updateGroupSettingsAdmin(params.id, await readJson(req, groupSettingsPatchSchema), actor);
  return ok(requestId, await getGroupAdmin(params.id));
});
