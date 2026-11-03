import { requireMembership, requireUser } from '@/server/auth';
import { handle, ok } from '@/server/http';
import { removeSubmission } from '@/server/services/gallery';

/** DELETE /api/groups/:id/submissions/:sid - group admin moderation (e.g. personal data in a photo). */
export const DELETE = handle<{ id: string; sid: string }>(async (req, { requestId, params }) => {
  const user = await requireUser(req);
  await requireMembership(params.id, user, { admin: true });
  await removeSubmission(params.sid, { type: 'user', id: String(user._id) }, { groupId: params.id });
  return ok(requestId, { removed: true });
});
