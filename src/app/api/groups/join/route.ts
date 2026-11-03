import { joinGroupSchema } from '@/shared';
import { requireUser } from '@/server/auth';
import { handle, ok, readJson } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { redeemInvite } from '@/server/services/groups';

/** POST /api/groups/join - redeems an invite code and files a join request (admin approval needed). */
export const POST = handle(async (req, { requestId }) => {
  const user = await requireUser(req);
  await enforceRateLimit(`invite-redeem:${user._id}`, 10, 900);
  const { code } = await readJson(req, joinGroupSchema);
  return ok(requestId, await redeemInvite(user, code), { status: 201 });
});
