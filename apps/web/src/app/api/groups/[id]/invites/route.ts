import { requireUser } from '@/server/auth';
import { handle, ok } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { createInvite } from '@/server/services/groups';

/** POST /api/groups/:id/invites - one-time code + QR payload, valid for 24 hours (group admin only). */
export const POST = handle<{ id: string }>(async (req, { requestId, params }) => {
  const user = await requireUser(req);
  await enforceRateLimit(`invite-create:${user._id}`, 30, 3600);
  return ok(requestId, await createInvite(user, params.id), { status: 201 });
});
