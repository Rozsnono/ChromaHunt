import { globalSettingsSchema } from '@/shared';
import { requirePermission } from '@/server/auth';
import { handle, ok, readJson } from '@/server/http';
import { updateGlobalSettings } from '@/server/services/admin';
import { getGlobalSettings } from '@/server/services/settings';

const view = (s: Awaited<ReturnType<typeof getGlobalSettings>>) => ({
  defaults: s.defaults,
  minAcceptanceThreshold: s.minAcceptanceThreshold,
  maxRetentionDays: s.maxRetentionDays,
  storageQuotaBytes: s.storageQuotaBytes,
  registrationOpen: s.registrationOpen,
});

/** GET /api/admin/settings - global defaults and limits. */
export const GET = handle(async (req, { requestId }) => {
  await requirePermission(req, 'settings.manage');
  return ok(requestId, view(await getGlobalSettings()));
});

/** PATCH /api/admin/settings - change defaults/limits (audited). */
export const PATCH = handle(async (req, { requestId }) => {
  const actor = await requirePermission(req, 'settings.manage');
  return ok(requestId, view(await updateGlobalSettings(await readJson(req, globalSettingsSchema), actor)));
});
