import { z } from 'zod';
import { objectIdSchema } from '@/shared';
import { requirePermission } from '@/server/auth';
import { notFound } from '@/server/errors';
import { handle, ok, readJson } from '@/server/http';
import { setGroupArchived } from '@/server/services/admin';

/** POST {archived: boolean} - archives (read-only, no new draws) or restores a group. Groups are never deleted. */
export const POST = handle<{ id: string }>(async (req, { requestId, params }) => {
  const actor = await requirePermission(req, 'groups.manage');
  if (!objectIdSchema.safeParse(params.id).success) throw notFound();
  const { archived } = await readJson(req, z.object({ archived: z.boolean() }));
  await setGroupArchived(params.id, archived, actor);
  return ok(requestId, { archived });
});
