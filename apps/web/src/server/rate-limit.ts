/**
 * Fixed-window rate limiter backed by MongoDB (no extra infrastructure, works on serverless).
 * The counter update is a single atomic pipeline upsert; the TTL index removes stale windows.
 */
import { AppError } from './errors';
import { RateLimit } from './models';

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSec: number;
}

async function bump(key: string, windowSec: number): Promise<{ count: number; resetAt: Date }> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSec * 1000);
  const run = () =>
    RateLimit.findOneAndUpdate(
      { key },
      [
        {
          $set: {
            count: {
              $cond: [{ $gt: [{ $ifNull: ['$resetAt', new Date(0)] }, now] }, { $add: [{ $ifNull: ['$count', 0] }, 1] }, 1],
            },
            resetAt: {
              $cond: [{ $gt: [{ $ifNull: ['$resetAt', new Date(0)] }, now] }, '$resetAt', resetAt],
            },
          },
        },
      ],
      { upsert: true, returnDocument: 'after', updatePipeline: true },
    ).lean();
  let doc;
  try {
    doc = await run();
  } catch (error) {
    // Two concurrent upserts for the same new key: the loser retries as a plain update.
    if ((error as { code?: number }).code !== 11000) throw error;
    doc = await run();
  }
  if (!doc) throw new Error('rate limit upsert returned no document');
  return { count: doc.count, resetAt: doc.resetAt };
}

/** Counts one hit and reports whether it is within `limit` for the current window. */
export async function consume(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const { count, resetAt } = await bump(key, windowSec);
  return {
    allowed: count <= limit,
    count,
    retryAfterSec: Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000)),
  };
}

/** Like `consume`, but throws `RATE_LIMITED` (HTTP 429 + Retry-After) when exceeded. */
export async function enforceRateLimit(key: string, limit: number, windowSec: number): Promise<void> {
  const result = await consume(key, limit, windowSec);
  if (!result.allowed) throw rateLimited(result.retryAfterSec);
}

export function rateLimited(retryAfterSec: number): AppError {
  return new AppError('RATE_LIMITED', 429, { retryAfterSec }, { 'Retry-After': String(retryAfterSec) });
}

/** Current count of an active window without counting a hit. */
export async function peek(key: string): Promise<{ count: number; retryAfterSec: number }> {
  const doc = await RateLimit.findOne({ key, resetAt: { $gt: new Date() } }).lean();
  if (!doc) return { count: 0, retryAfterSec: 0 };
  return { count: doc.count, retryAfterSec: Math.max(1, Math.ceil((doc.resetAt.getTime() - Date.now()) / 1000)) };
}

export async function resetKey(key: string): Promise<void> {
  await RateLimit.deleteOne({ key });
}
