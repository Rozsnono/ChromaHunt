/**
 * Global request proxy (Next.js 16 "proxy", formerly middleware): security headers for every
 * response and a strict CORS allowlist for the API. Native mobile clients send no `Origin`
 * header, so CORS only affects browsers.
 */
import { NextResponse, type NextRequest } from 'next/server';

const DEV = process.env.NODE_ENV !== 'production';

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
    // React's development build needs eval() and the HMR websocket; production does not.
    `script-src 'self' 'unsafe-inline'${DEV ? " 'unsafe-eval'" : ''}; ` +
    `connect-src 'self'${DEV ? ' ws: wss:' : ''}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
};

function allowedOrigins(): string[] {
  return (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function proxy(req: NextRequest): NextResponse {
  const isApi = req.nextUrl.pathname.startsWith('/api/');
  const origin = req.headers.get('origin');
  const corsAllowed = isApi && origin !== null && allowedOrigins().includes(origin);

  // Preflight: answer directly. Disallowed origins get no CORS headers and the browser blocks the call.
  const response =
    isApi && req.method === 'OPTIONS' ? new NextResponse(null, { status: corsAllowed ? 204 : 403 }) : NextResponse.next();

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  if (corsAllowed && origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Upload-Token,X-Request-Id');
    response.headers.set('Access-Control-Max-Age', '600');
    response.headers.append('Vary', 'Origin');
  }
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
