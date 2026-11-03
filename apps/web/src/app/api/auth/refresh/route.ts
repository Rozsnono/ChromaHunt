import { refreshSchema } from '@chromahunt/shared';
import { hmacHash } from '@/server/crypto';
import { clientIp, handle, ok, readJson } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { refreshSession } from '@/server/services/auth';

/** POST /api/auth/refresh - rotates the refresh token; reuse of an old token revokes the family. */
export const POST = handle(async (req, { requestId }) => {
  await enforceRateLimit(`refresh:ip:${hmacHash(clientIp(req))}`, 120, 600);
  return ok(requestId, await refreshSession(await readJson(req, refreshSchema)));
});
