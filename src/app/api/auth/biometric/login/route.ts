import { biometricLoginSchema } from '@/shared';
import { hmacHash } from '@/server/crypto';
import { clientIp, handle, ok, readJson } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { biometricLogin } from '@/server/services/auth';

/** POST /api/auth/biometric/login - the app unlocks the secret with biometrics, then calls this. */
export const POST = handle(async (req, { requestId }) => {
  await enforceRateLimit(`biometric:ip:${hmacHash(clientIp(req))}`, 30, 600);
  return ok(requestId, await biometricLogin(await readJson(req, biometricLoginSchema)));
});
