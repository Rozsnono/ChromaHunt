import { requirePermission } from '@/server/auth';
import { handle, ok } from '@/server/http';
import { removeSubmission } from '@/server/services/gallery';

/** DELETE - global admin moderation of any submission. */
export const DELETE = handle<{ id: string }>(async (req, { requestId, params }) => {
  const actor = await requirePermission(req, 'groups.manage');
  await removeSubmission(params.id, actor);
  return ok(requestId, { removed: true });
});
