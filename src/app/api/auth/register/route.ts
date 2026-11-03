import { registerSchema } from '@/shared';
import { hmacHash } from '@/server/crypto';
import { clientIp, handle, ok, readJson } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { registerUser } from '@/server/services/auth';

/** POST /api/auth/register - e-mail + password registration with mandatory privacy acceptance. */
export const POST = handle(async (req, { requestId }) => {
  await enforceRateLimit(`register:${hmacHash(clientIp(req))}`, 10, 3600);
  const body = await readJson(req, registerSchema);
  const { acceptedPrivacy: _accepted, ...input } = body;
  return ok(requestId, await registerUser(input), { status: 201 });
});
