import { changePasswordSchema } from '@chromahunt/shared';
import { requireUser } from '@/server/auth';
import { handle, ok, readJson } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { changePassword } from '@/server/services/auth';

/** POST /api/auth/change-password - also the only call allowed after an admin password reset. */
export const POST = handle(async (req, { requestId }) => {
  const user = await requireUser(req, { allowPasswordChangePending: true });
  await enforceRateLimit(`change-password:${user._id}`, 10, 900);
  return ok(requestId, await changePassword(user, await readJson(req, changePasswordSchema)));
});
