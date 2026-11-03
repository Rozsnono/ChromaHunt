import { logoutSchema } from '@/shared';
import { hmacHash } from '@/server/crypto';
import { clientIp, handle, ok, readJson } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { logoutSession } from '@/server/services/auth';

/** POST /api/auth/logout - revokes the token family and the device's biometric binding. */
export const POST = handle(async (req, { requestId }) => {
  await enforceRateLimit(`logout:ip:${hmacHash(clientIp(req))}`, 60, 600);
  await logoutSession(await readJson(req, logoutSchema));
  return ok(requestId, { loggedOut: true });
});
