import { z } from 'zod';
import { requirePermission } from '@/server/auth';
import { handle, ok, readQuery } from '@/server/http';
import { listAudit } from '@/server/services/admin';

const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  action: z.string().trim().max(60).optional(),
  actorId: z.string().trim().max(40).optional(),
  alertsOnly: z.enum(['true', 'false']).optional(),
});

export const GET = handle(async (req, { requestId }) => {
  await requirePermission(req, 'audit.view');
  const q = readQuery(req, query);
  return ok(requestId, await listAudit({ page: q.page, action: q.action, actorId: q.actorId, alertsOnly: q.alertsOnly === 'true' }));
});
