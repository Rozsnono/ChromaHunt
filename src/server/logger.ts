/**
 * Minimal structured JSON logger. Sensitive keys are redacted so that secrets and personal
 * data (passwords, tokens, e-mail addresses) never reach the logs.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE = /pass|secret|token|authorization|cookie|email|hash|code/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE.test(key) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

function threshold(): number {
  const level = (process.env.LOG_LEVEL as Level | undefined) ?? 'info';
  return process.env.NODE_ENV === 'test' && !process.env.LOG_LEVEL ? 100 : (order[level] ?? 20);
}

function write(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (order[level] < threshold()) return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...(redact(fields) as object) });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

export const log = {
  debug: (message: string, fields?: Record<string, unknown>) => write('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
};

/** Serialises an unknown error for the log without leaking more than name, message and stack. */
export function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { errorName: error.name, errorMessage: error.message, stack: error.stack };
  return { errorMessage: String(error) };
}
