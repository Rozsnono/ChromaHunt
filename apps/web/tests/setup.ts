/** Per-file test environment: deterministic secrets and the shared in-memory database. */
import { inject } from 'vitest';

Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: inject('mongoUri'),
  JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-000',
  UPLOAD_TOKEN_SECRET: 'test-upload-secret-test-upload-secret-0',
  ADMIN_SESSION_SECRET: 'test-admin-secret-test-admin-secret-00',
  TOKEN_PEPPER: 'test-pepper-test-pepper-test-pepper-0000',
  CRON_SECRET: 'test-cron-secret-test-cron-secret',
  ADMIN_PASSWORD: 'correct-horse-battery-staple',
  STORAGE_DRIVER: 'fs', // tests inject an in-memory driver; the env just has to be valid
  WEBDAV_URL: 'https://webdav.test.invalid/dav',
  WEBDAV_USERNAME: 'dav',
  WEBDAV_PASSWORD: 'dav-pass',
  APP_ORIGIN: 'http://localhost:3000',
  PRIVACY_POLICY_VERSION: '1',
});
