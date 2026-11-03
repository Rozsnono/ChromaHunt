import { Types } from 'mongoose';
import { rankingQuerySchema } from '@/shared';
import { requirePermission } from '@/server/auth';
import { notFound } from '@/server/errors';
import { handle, ok, readQuery } from '@/server/http';
import { getRanking } from '@/server/services/scoring';

/** GET - the same weekly leaderboard members see (admin visibility). */
export const GET = handle<{ id: string }>(async (req, { requestId, params }) => {
  await requirePermission(req, 'groups.manage');
  if (!Types.ObjectId.isValid(params.id)) throw notFound();
  const { week } = readQuery(req, rankingQuerySchema);
  return ok(requestId, await getRanking(new Types.ObjectId(params.id), week));
});
