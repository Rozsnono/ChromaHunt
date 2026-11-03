/** Signed tokens (HS256 via jose): access, single-use upload and admin session. */
import { SignJWT, jwtVerify } from 'jose';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  ADMIN_SESSION_TTL_SECONDS,
  UPLOAD_TOKEN_TTL_SECONDS,
} from '@chromahunt/shared';
import { env } from './env';

const encoder = new TextEncoder();
const ISSUER = 'chromahunt';

async function sign(
  secret: string,
  audience: string,
  ttlSeconds: number,
  claims: Record<string, unknown>,
  subject: string,
  jti?: string,
): Promise<string> {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`);
  if (jti) jwt.setJti(jti);
  return jwt.sign(encoder.encode(secret));
}

async function verifyToken(secret: string, audience: string, token: string) {
  const { payload } = await jwtVerify(token, encoder.encode(secret), {
    issuer: ISSUER,
    audience,
    algorithms: ['HS256'],
  });
  return payload;
}

export interface AccessClaims {
  userId: string;
  deviceId: string;
  /** User still has to change the temporary password. */
  mustChangePassword: boolean;
}

export function signAccessToken(claims: AccessClaims): Promise<string> {
  return sign(
    env().JWT_ACCESS_SECRET,
    'access',
    ACCESS_TOKEN_TTL_SECONDS,
    { did: claims.deviceId, mcp: claims.mustChangePassword },
    claims.userId,
  );
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const p = await verifyToken(env().JWT_ACCESS_SECRET, 'access', token);
  if (!p.sub) throw new Error('missing subject');
  return { userId: p.sub, deviceId: String(p.did ?? ''), mustChangePassword: p.mcp === true };
}

export interface UploadClaims {
  userId: string;
  submissionId: string;
  jti: string;
}

/** Scoped, short-lived token bound to one user and one submission; consumed on use. */
export function signUploadToken(claims: UploadClaims): Promise<string> {
  return sign(
    env().UPLOAD_TOKEN_SECRET,
    'upload',
    UPLOAD_TOKEN_TTL_SECONDS,
    { sid: claims.submissionId },
    claims.userId,
    claims.jti,
  );
}

export async function verifyUploadToken(token: string): Promise<UploadClaims> {
  const p = await verifyToken(env().UPLOAD_TOKEN_SECRET, 'upload', token);
  if (!p.sub || !p.jti || typeof p.sid !== 'string') throw new Error('malformed upload token');
  return { userId: p.sub, submissionId: p.sid, jti: p.jti };
}

export function signAdminSession(): Promise<string> {
  return sign(env().ADMIN_SESSION_SECRET, 'admin', ADMIN_SESSION_TTL_SECONDS, {}, 'admin');
}

export async function verifyAdminSession(token: string): Promise<boolean> {
  try {
    const p = await verifyToken(env().ADMIN_SESSION_SECRET, 'admin', token);
    return p.sub === 'admin';
  } catch {
    return false;
  }
}
