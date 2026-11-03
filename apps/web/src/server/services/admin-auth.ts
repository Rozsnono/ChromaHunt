/**
 * Admin panel login: a single password from the environment (`ADMIN_PASSWORD`). Brute force
 * protection: after repeated failures the client IP is locked out for a while, plus a global
 * failure ceiling against distributed guessing. IPs are only stored hashed.
 */
import { audit } from '../audit';
import { hmacHash, safeEqual } from '../crypto';
import { env } from '../env';
import { AppError } from '../errors';
import { consume, peek, rateLimited, resetKey } from '../rate-limit';
import { signAdminSession } from '../tokens';

export const ADMIN_MAX_FAILURES_PER_IP = 5;
export const ADMIN_MAX_FAILURES_GLOBAL = 50;
export const ADMIN_LOCKOUT_SECONDS = 15 * 60;

/** Returns a signed session token, or throws (401 wrong password / 429 locked out). */
export async function adminLogin(password: string, ip: string): Promise<string> {
  const ipKey = `admin-login:ip:${hmacHash(ip)}`;
  const globalKey = 'admin-login:global';

  for (const [key, limit] of [[ipKey, ADMIN_MAX_FAILURES_PER_IP], [globalKey, ADMIN_MAX_FAILURES_GLOBAL]] as const) {
    const state = await peek(key);
    if (state.count >= limit) throw rateLimited(state.retryAfterSec);
  }

  if (!safeEqual(password, env().ADMIN_PASSWORD)) {
    await consume(ipKey, ADMIN_MAX_FAILURES_PER_IP, ADMIN_LOCKOUT_SECONDS);
    await consume(globalKey, ADMIN_MAX_FAILURES_GLOBAL, ADMIN_LOCKOUT_SECONDS);
    await audit({ actor: { type: 'admin', id: 'admin' }, action: 'admin.login_failed' });
    throw new AppError('INVALID_CREDENTIALS', 401);
  }
  await resetKey(ipKey);
  await audit({ actor: { type: 'admin', id: 'admin' }, action: 'admin.login' });
  return signAdminSession();
}
