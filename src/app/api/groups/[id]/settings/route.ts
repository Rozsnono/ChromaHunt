import { groupSettingsPatchSchema } from '@/shared';
import { requireUser } from '@/server/auth';
import { handle, ok, readJson } from '@/server/http';
import { updateGroupSettings } from '@/server/services/groups';

/** PATCH /api/groups/:id/settings - group admin only; limited by the global minimums/maximums. */
export const PATCH = handle<{ id: string }>(async (req, { requestId, params }) => {
  const user = await requireUser(req);
  return ok(requestId, await updateGroupSettings(user, params.id, await readJson(req, groupSettingsPatchSchema)));
});
