import { z } from 'zod';
import { requirePermission } from '@/server/auth';
import { handle, ok, readQuery } from '@/server/http';
import { listGroupsAdmin } from '@/server/services/admin';

const query = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  archived: z.enum(['true', 'false']).optional(),
});

export const GET = handle(async (req, { requestId }) => {
  await requirePermission(req, 'groups.manage');
  const q = readQuery(req, query);
  return ok(requestId, await listGroupsAdmin({ q: q.q, page: q.page, archived: q.archived === undefined ? undefined : q.archived === 'true' }));
});
