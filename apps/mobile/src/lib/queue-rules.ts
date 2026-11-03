/**
 * Offline upload queue rules (pure and unit tested): exponential backoff, deadline awareness and
 * the classification of API errors into "retry later", "give up" or "pause (signed out)".
 */
import { ApiError } from './api-core';

export type DropReason = 'expired' | 'complete' | 'invalid' | 'unavailable';

export type Decision =
  | { kind: 'retry'; delayMs: number }
  | { kind: 'drop'; reason: DropReason }
  | { kind: 'pause' };

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 15 * 60_000;

/** 5 s, 10 s, 20 s ... capped at 15 min, +-20% jitter, never shorter than the server's Retry-After. */
export function backoffMs(attempts: number, retryAfterSec: number | null = null, random: () => number = Math.random): number {
  const exponential = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts));
  const jittered = exponential * (0.8 + random() * 0.4);
  return Math.round(Math.max(jittered, (retryAfterSec ?? 0) * 1000));
}

export const isExpired = (deadlineAt: number, now: number): boolean => now >= deadlineAt;

/** Decides what to do with a queued photo after a failed attempt. */
export function decide(error: ApiError, attempts: number, now: number, deadlineAt: number, random: () => number = Math.random): Decision {
  switch (error.code) {
    case 'DEADLINE_PASSED':
    case 'NO_ACTIVE_ASSIGNMENT':
      return { kind: 'drop', reason: 'expired' };
    case 'QUOTA_REACHED':
      return { kind: 'drop', reason: 'complete' };
    case 'INVALID_IMAGE':
    case 'PAYLOAD_TOO_LARGE':
    case 'VALIDATION_ERROR':
      return { kind: 'drop', reason: 'invalid' };
    case 'GROUP_ARCHIVED':
    case 'NOT_FOUND':
    case 'FORBIDDEN':
    case 'ACCOUNT_DISABLED':
      return { kind: 'drop', reason: 'unavailable' };
    case 'UNAUTHENTICATED':
    case 'TOKEN_REUSE_DETECTED':
    case 'PASSWORD_CHANGE_REQUIRED':
      return { kind: 'pause' }; // keep the photo, resume after the next sign-in
    default:
  }
  let delayMs: number;
  if (error.code === 'UPLOAD_TOKEN_INVALID' || error.code === 'CONFLICT') delayMs = 2_000;
  else if (error.isTransient) delayMs = backoffMs(attempts, error.retryAfterSec, random);
  else return { kind: 'drop', reason: 'invalid' };
  // A retry that could only happen after the deadline is pointless.
  return now + delayMs >= deadlineAt ? { kind: 'drop', reason: 'expired' } : { kind: 'retry', delayMs };
}
