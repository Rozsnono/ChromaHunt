import { deleteAccountSchema, profileUpdateSchema } from '@/shared';
import { requireUser } from '@/server/auth';
import { handle, ok, readJson } from '@/server/http';
import { User } from '@/server/models';
import { enforceRateLimit } from '@/server/rate-limit';
import { toPublicUser } from '@/server/services/auth';
import { deleteOwnAccount } from '@/server/services/account';

/** GET /api/me - current user (also while a forced password change is pending). */
export const GET = handle(async (req, { requestId }) => {
  const user = await requireUser(req, { allowPasswordChangePending: true });
  return ok(requestId, toPublicUser(user));
});

/** PATCH /api/me - display name and locale. */
export const PATCH = handle(async (req, { requestId }) => {
  const user = await requireUser(req);
  const patch = await readJson(req, profileUpdateSchema);
  const updated = await User.findByIdAndUpdate(user._id, patch, { returnDocument: 'after', runValidators: true }).lean();
  return ok(requestId, toPublicUser(updated ?? user));
});

/** DELETE /api/me - immediate, permanent account deletion (requires the current password). */
export const DELETE = handle(async (req, { requestId }) => {
  const user = await requireUser(req, { allowPasswordChangePending: true });
  await enforceRateLimit(`delete-account:${user._id}`, 5, 900);
  const { password } = await readJson(req, deleteAccountSchema);
  return ok(requestId, await deleteOwnAccount(user, password));
});
