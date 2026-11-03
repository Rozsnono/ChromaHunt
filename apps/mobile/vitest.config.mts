import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Only platform-independent logic is unit tested here (api client, queue rules, i18n).
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
