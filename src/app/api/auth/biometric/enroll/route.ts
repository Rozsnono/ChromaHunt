import { biometricEnrollSchema } from '@/shared';
import { requireUser } from '@/server/auth';
import { handle, ok, readJson } from '@/server/http';
import { enrollBiometric } from '@/server/services/auth';

/** POST /api/auth/biometric/enroll - binds a random per-device secret to the signed-in user. */
export const POST = handle(async (req, { requestId }) => {
  const user = await requireUser(req);
  await enrollBiometric(user, await readJson(req, biometricEnrollSchema));
  return ok(requestId, { enrolled: true });
});
