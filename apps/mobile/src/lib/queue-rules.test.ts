import { describe, expect, it } from 'vitest';
import { ApiError } from './api-core';
import { backoffMs, decide, isExpired } from './queue-rules';

const noJitter = () => 0.5; // exactly x1.0

describe('backoffMs', () => {
  it('doubles up to a 15 minute cap', () => {
    expect([0, 1, 2, 3].map((n) => backoffMs(n, null, noJitter))).toEqual([5000, 10000, 20000, 40000]);
    expect(backoffMs(20, null, noJitter)).toBe(15 * 60_000);
  });
  it('applies +-20% jitter and respects Retry-After', () => {
    expect(backoffMs(0, null, () => 0)).toBe(4000);
    expect(backoffMs(0, null, () => 1)).toBe(6000);
    expect(backoffMs(0, 90, noJitter)).toBe(90_000);
  });
});

describe('decide', () => {
  const now = 1_000_000;
  const farDeadline = now + 3 * 3600_000;
  const err = (code: string, status: number, retry: number | null = null) => new ApiError(code, status, {}, retry);

  it('retries transient failures with backoff', () => {
    expect(decide(err('NETWORK', 0), 0, now, farDeadline, noJitter)).toEqual({ kind: 'retry', delayMs: 5000 });
    expect(decide(err('SERVICE_UNAVAILABLE', 503, 30), 2, now, farDeadline, noJitter)).toEqual({ kind: 'retry', delayMs: 30_000 });
    expect(decide(err('RATE_LIMITED', 429), 1, now, farDeadline, noJitter)).toMatchObject({ kind: 'retry' });
  });

  it('retries quickly when only the one-time upload token was lost', () => {
    expect(decide(err('UPLOAD_TOKEN_INVALID', 401), 3, now, farDeadline)).toEqual({ kind: 'retry', delayMs: 2000 });
  });

  it('gives up on permanent failures with a reason', () => {
    expect(decide(err('DEADLINE_PASSED', 409), 0, now, farDeadline)).toEqual({ kind: 'drop', reason: 'expired' });
    expect(decide(err('QUOTA_REACHED', 409), 0, now, farDeadline)).toEqual({ kind: 'drop', reason: 'complete' });
    expect(decide(err('INVALID_IMAGE', 400), 0, now, farDeadline)).toEqual({ kind: 'drop', reason: 'invalid' });
    expect(decide(err('GROUP_ARCHIVED', 409), 0, now, farDeadline)).toEqual({ kind: 'drop', reason: 'unavailable' });
    expect(decide(err('SOMETHING_ELSE', 418), 0, now, farDeadline)).toEqual({ kind: 'drop', reason: 'invalid' });
  });

  it('pauses (keeps the photo) when the session is gone', () => {
    expect(decide(err('UNAUTHENTICATED', 401), 0, now, farDeadline)).toEqual({ kind: 'pause' });
    expect(decide(err('TOKEN_REUSE_DETECTED', 401), 0, now, farDeadline)).toEqual({ kind: 'pause' });
  });

  it('drops a retry that could only happen after the deadline', () => {
    expect(decide(err('NETWORK', 0), 0, now, now + 3000, noJitter)).toEqual({ kind: 'drop', reason: 'expired' });
  });
});

describe('isExpired', () => {
  it('is true at and after the deadline', () => {
    expect(isExpired(100, 99)).toBe(false);
    expect(isExpired(100, 100)).toBe(true);
  });
});
