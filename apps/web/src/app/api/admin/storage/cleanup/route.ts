import { audit } from '@/server/audit';
import { requirePermission } from '@/server/auth';
import { handle, ok } from '@/server/http';
import { runRetentionCleanup } from '@/server/services/retention';

/** POST - manual retention cleanup (same job as the scheduled one). */
export const POST = handle(async (req, { requestId }) => {
  const actor = await requirePermission(req, 'storage.manage');
  const report = await runRetentionCleanup();
  await audit({ actor, action: 'storage.cleanup_triggered', targetType: 'storage', metadata: { ...report } });
  return ok(requestId, report);
});
