import { ADMIN_SESSION_TTL_SECONDS, adminLoginSchema } from '@chromahunt/shared';
import { ADMIN_COOKIE, hasAdminSession } from '@/server/auth';
import { hmacHash } from '@/server/crypto';
import { unauthenticated } from '@/server/errors';
import { clientIp, handle, ok, readJson } from '@/server/http';
import { enforceRateLimit } from '@/server/rate-limit';
import { adminLogin } from '@/server/services/admin-auth';

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
};

/** POST /api/admin/session - admin panel login with the environment password. */
export const POST = handle(async (req, { requestId }) => {
  const ip = clientIp(req);
  await enforceRateLimit(`admin-login-attempts:${hmacHash(ip)}`, 30, 900);
  const { password } = await readJson(req, adminLoginSchema);
  const token = await adminLogin(password, ip);
  const response = ok(requestId, { authenticated: true });
  response.cookies.set(ADMIN_COOKIE, token, { ...cookieOptions, maxAge: ADMIN_SESSION_TTL_SECONDS });
  return response;
});

/** GET /api/admin/session - tells the UI whether the cookie is still a valid session. */
export const GET = handle(async (req, { requestId }) => {
  if (!(await hasAdminSession(req))) throw unauthenticated();
  return ok(requestId, { authenticated: true });
});

/** DELETE /api/admin/session - logout. */
export const DELETE = handle(async (_req, { requestId }) => {
  const response = ok(requestId, { authenticated: false });
  response.cookies.set(ADMIN_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  return response;
});
