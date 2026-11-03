/**
 * Environment loader. Validated lazily on first use (so `next build` works without secrets)
 * and fails fast with a readable message listing every missing/invalid variable.
 * Secrets are only ever read from the environment, never from code.
 */
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  UPLOAD_TOKEN_SECRET: z.string().min(32),
  ADMIN_SESSION_SECRET: z.string().min(32),
  TOKEN_PEPPER: z.string().min(32),
  CRON_SECRET: z.string().min(24),
  ADMIN_PASSWORD: z.string().min(12),
  /** `fs` stores photos on the local disk and is meant for development only. */
  STORAGE_DRIVER: z.enum(['filesharer', 'webdav', 'fs']).default('filesharer'),
  LOCAL_STORAGE_DIR: z.string().default('.data/storage'),
  FILESHARER_URL: z.url().optional(),
  FILESHARER_API_KEY: z.string().min(16).optional(),
  /** Optional sub-directory below the API key's folder (relative; empty = the key folder). */
  FILESHARER_BASE_PATH: z.string().default(''),
  WEBDAV_URL: z.url().optional(),
  WEBDAV_USERNAME: z.string().min(1).optional(),
  WEBDAV_PASSWORD: z.string().min(1).optional(),
  WEBDAV_BASE_PATH: z.string().default('chromahunt'),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  APP_ORIGIN: z.url().default('http://localhost:3000'),
  PRIVACY_POLICY_VERSION: z.string().min(1).default('1'),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
}).superRefine((value, ctx) => {
  if (value.STORAGE_DRIVER === 'filesharer') {
    for (const key of ['FILESHARER_URL', 'FILESHARER_API_KEY'] as const) {
      if (!value[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required when STORAGE_DRIVER=filesharer' });
    }
  }
  if (value.STORAGE_DRIVER === 'webdav') {
    for (const key of ['WEBDAV_URL', 'WEBDAV_USERNAME', 'WEBDAV_PASSWORD'] as const) {
      if (!value[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required when STORAGE_DRIVER=webdav' });
    }
  }
  if (value.STORAGE_DRIVER === 'fs' && value.NODE_ENV === 'production') {
    ctx.addIssue({ code: 'custom', path: ['STORAGE_DRIVER'], message: 'the fs driver is development only' });
  }
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forget the cached environment after changing `process.env`. */
export function resetEnvCache(): void {
  cached = undefined;
}
