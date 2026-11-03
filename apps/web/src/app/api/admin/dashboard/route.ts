import { requirePermission } from '@/server/auth';
import { handle, ok } from '@/server/http';
import { getDashboard } from '@/server/services/admin';

/** GET /api/admin/dashboard - counters and recent alerts. */
export const GET = handle(async (req, { requestId }) => {
  await requirePermission(req, 'audit.view');
  return ok(requestId, await getDashboard());
});
