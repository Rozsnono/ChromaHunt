/**
 * Request authentication and authorization. Every route calls one of these guards itself,
 * so permissions are enforced server side regardless of what the UI shows.
 */
import type { NextRequest } from 'next/server';
import { objectIdSchema, type Permission } from '@/shared';
import type { Actor } from './audit';
import { env } from './env';
import { forbidden, notFound, unauthenticated } from './errors';
import { Group, GroupMembership, User, type GroupDoc, type GroupMembershipDoc, type UserDoc } from './models';
import { verifyAccessToken, verifyAdminSession } from './tokens';

export const ADMIN_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-ch_admin' : 'ch_admin';

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (!header?.toLowerCase().startsWith('bearer ')) return null;
  return header.slice(7).trim() || null;
}

/** Loads the user behind a bearer access token. Disabled users and expired tokens are rejected. */
export async function requireUser(
  req: NextRequest,
  options: { allowPasswordChangePending?: boolean } = {},
): Promise<UserDoc> {
  const token = bearerToken(req);
  if (!token) throw unauthenticated();
  let claims;
  try {
    claims = await verifyAccessToken(token);
  } catch {
    throw unauthenticated();
  }
  if (!objectIdSchema.safeParse(claims.userId).success) throw unauthenticated();
  const user = await User.findById(claims.userId).lean();
  if (!user) throw unauthenticated();
  if (user.isDisabled) throw forbidden('ACCOUNT_DISABLED');
  if (user.mustChangePassword && !options.allowPasswordChangePending) throw forbidden('PASSWORD_CHANGE_REQUIRED');
  return user;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** CSRF defence for cookie-authenticated, state-changing requests: same-origin only. */
function assertSameOrigin(req: NextRequest): void {
  if (SAFE_METHODS.has(req.method)) return;
  const allowed = new Set([env().APP_ORIGIN, ...env().CORS_ALLOWED_ORIGINS]);
  const origin = req.headers.get('origin');
  if (origin) {
    if (!allowed.has(origin) && origin !== req.nextUrl.origin) throw forbidden();
    return;
  }
  if (req.headers.get('sec-fetch-site') === 'same-origin') return;
  throw forbidden();
}

/** True when the request carries a valid admin panel session cookie. */
export async function hasAdminSession(req: NextRequest): Promise<boolean> {
  const cookie = req.cookies.get(ADMIN_COOKIE)?.value;
  return cookie ? verifyAdminSession(cookie) : false;
}

export async function requireAdminSession(req: NextRequest): Promise<Actor> {
  if (!(await hasAdminSession(req))) throw unauthenticated();
  assertSameOrigin(req);
  return { type: 'admin', id: 'admin' };
}

/**
 * Authorizes an admin API call for one permission string.
 * - The env-password admin session is a superadmin and holds every permission.
 * - Otherwise a bearer access token of a user who holds the permission is accepted (API only;
 *   the web panel itself can only be entered with the admin password).
 */
export async function requirePermission(req: NextRequest, permission: Permission): Promise<Actor> {
  if (await hasAdminSession(req)) {
    assertSameOrigin(req);
    return { type: 'admin', id: 'admin' };
  }
  if (!bearerToken(req)) throw unauthenticated();
  const user = await requireUser(req);
  if (!user.permissions.includes(permission)) throw forbidden();
  return { type: 'user', id: String(user._id) };
}

export interface GroupAccess {
  group: GroupDoc;
  membership: GroupMembershipDoc;
}

/** Requires an active membership in the group (optionally as group admin). */
export async function requireMembership(
  groupId: string,
  user: UserDoc,
  options: { admin?: boolean } = {},
): Promise<GroupAccess> {
  if (!objectIdSchema.safeParse(groupId).success) throw notFound();
  const [group, membership] = await Promise.all([
    Group.findById(groupId).lean(),
    GroupMembership.findOne({ groupId, userId: user._id }).lean(),
  ]);
  // Do not reveal whether the group exists to non-members.
  if (!group || !membership) throw notFound();
  if (options.admin && membership.role !== 'admin') throw forbidden();
  return { group, membership };
}
