import { z } from 'zod';
import { requirePermission } from '@/server/auth';
import { handle, ok, readQuery } from '@/server/http';
import { listUsers } from '@/server/services/admin';

const query = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  disabled: z.enum(['true', 'false']).optional(),
  withPermissions: z.enum(['true', 'false']).optional(),
});

/** GET /api/admin/users?q=&page= - users.manage (permission holders list: permissions.manage). */
export const GET = handle(async (req, { requestId }) => {
  const q = readQuery(req, query);
  await requirePermission(req, q.withPermissions === 'true' ? 'permissions.manage' : 'users.manage');
  return ok(
    requestId,
    await listUsers({
      q: q.q,
      page: q.page,
      disabled: q.disabled === undefined ? undefined : q.disabled === 'true',
      withPermissions: q.withPermissions === 'true',
    }),
  );
});
