/**
 * Route handler plumbing: uniform response envelope, error mapping, request ids, body
 * parsing with size limits. Every handler follows: validate -> authorize -> execute -> respond.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { connectDb } from './db';
import { AppError } from './errors';
import { errorFields, log } from './logger';

export interface HandlerContext<P> {
  params: P;
  requestId: string;
}

type Handler<P> = (req: NextRequest, ctx: HandlerContext<P>) => Promise<Response>;

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

function envelope(requestId: string, body: { data?: unknown; error?: unknown }) {
  return {
    success: !body.error,
    data: body.error ? null : (body.data ?? null),
    error: body.error ?? null,
    meta: { requestId },
  };
}

export function ok(requestId: string, data: unknown, init?: { status?: number; headers?: HeadersInit }): NextResponse {
  return NextResponse.json(envelope(requestId, { data }), {
    status: init?.status ?? 200,
    headers: { 'Cache-Control': 'no-store', ...(init?.headers as Record<string, string> | undefined) },
  });
}

export function fail(requestId: string, error: AppError): NextResponse {
  return NextResponse.json(
    envelope(requestId, { error: { code: error.code, message: `error.${error.code}`, details: error.details } }),
    { status: error.status, headers: { 'Cache-Control': 'no-store', ...error.headers } },
  );
}

/** Translates any thrown value to an AppError; unexpected errors become a generic 500. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    // Only paths and issue codes are returned; submitted values are never echoed back.
    const issues = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return new AppError('VALIDATION_ERROR', 400, { issues });
  }
  const code = (error as { code?: number }).code;
  if (code === 11000) return new AppError('CONFLICT', 409);
  const name = (error as { name?: string }).name ?? '';
  // Operational failures get a coarse, non-sensitive reason so a broken deployment is diagnosable
  // from the response alone (details stay in the server log): no variable names, hosts or values.
  if (error instanceof Error && error.message.startsWith('Invalid environment configuration')) {
    return new AppError('SERVICE_UNAVAILABLE', 503, { reason: 'CONFIG' });
  }
  if (/^Mongo|^Mongoose/.test(name)) {
    return new AppError('SERVICE_UNAVAILABLE', 503, { reason: 'DATABASE' }, { 'Retry-After': '10' });
  }
  return new AppError('INTERNAL_ERROR', 500);
}

/**
 * Wraps a route handler: assigns a request id, connects to the database, converts errors to
 * the envelope and logs one line per request without any personal data.
 */
export function handle<P = Record<string, never>>(handler: Handler<P>) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    const started = Date.now();
    const incoming = req.headers.get('x-request-id');
    const requestId = incoming && REQUEST_ID_RE.test(incoming) ? incoming : crypto.randomUUID();
    const path = new URL(req.url).pathname;
    let status = 200;
    try {
      await connectDb();
      const params = (await ctx.params) ?? ({} as P);
      const response = await handler(req, { params, requestId });
      status = response.status;
      response.headers.set('X-Request-Id', requestId);
      return response;
    } catch (error) {
      const appError = toAppError(error);
      status = appError.status;
      if (appError.status >= 500) {
        log.error('request failed', { requestId, method: req.method, path, ...errorFields(error) });
      }
      const response = fail(requestId, appError);
      response.headers.set('X-Request-Id', requestId);
      return response;
    } finally {
      log.info('request', { requestId, method: req.method, path, status, ms: Date.now() - started });
    }
  };
}

const DEFAULT_BODY_LIMIT = 64 * 1024;

/** Reads a JSON body with a hard size limit and validates it with the given Zod schema. */
export async function readJson<T>(req: NextRequest, schema: ZodType<T>, maxBytes = DEFAULT_BODY_LIMIT): Promise<T> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new AppError('PAYLOAD_TOO_LARGE', 413);
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw new AppError('PAYLOAD_TOO_LARGE', 413);
  let raw: unknown;
  try {
    raw = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new AppError('VALIDATION_ERROR', 400, { issues: [{ path: '', message: 'INVALID_JSON' }] });
  }
  return schema.parse(raw);
}

/** Validates URL search parameters with a Zod schema. */
export function readQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(new URL(req.url).searchParams));
}

/** Best-effort client IP (the platform sets `x-forwarded-for`). */
export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}
