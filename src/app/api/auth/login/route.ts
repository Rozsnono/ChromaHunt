import { loginSchema } from '@/shared';
import { hmacHash } from '@/server/crypto';
import { clientIp, handle, ok, readJson } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { loginUser } from '@/server/services/auth';

/** POST /api/auth/login - rate limited per IP and per e-mail address (both stored hashed). */
export const POST = handle(async (req, { requestId }) => {
  await enforceRateLimit(`login:ip:${hmacHash(clientIp(req))}`, 30, 600);
  const body = await readJson(req, loginSchema);
  await enforceRateLimit(`login:email:${hmacHash(body.email)}`, 10, 900);
  return ok(requestId, await loginUser(body));
});
