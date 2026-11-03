import { requirePermission } from '@/server/auth';
import { handle, ok } from '@/server/http';
import { getStorageStats } from '@/server/services/admin';

/** GET - usage statistics and retention overview. */
export const GET = handle(async (req, { requestId }) => {
  await requirePermission(req, 'storage.manage');
  return ok(requestId, await getStorageStats());
});
