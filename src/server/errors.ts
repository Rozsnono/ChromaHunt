import type { ErrorCode } from '@/shared';

/**
 * Expected, user-facing failure. `code` is machine readable and doubles as the i18n key of
 * the message (`error.<CODE>`), so the server never sends localized text.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
    public readonly headers: Record<string, string> = {},
  ) {
    super(code);
    this.name = 'AppError';
  }
}

export const badRequest = (code: ErrorCode = 'VALIDATION_ERROR', details: Record<string, unknown> = {}) =>
  new AppError(code, 400, details);
export const unauthenticated = (code: ErrorCode = 'UNAUTHENTICATED') => new AppError(code, 401);
export const forbidden = (code: ErrorCode = 'FORBIDDEN') => new AppError(code, 403);
export const notFound = (code: ErrorCode = 'NOT_FOUND') => new AppError(code, 404);
export const conflict = (code: ErrorCode = 'CONFLICT', details: Record<string, unknown> = {}) =>
  new AppError(code, 409, details);
