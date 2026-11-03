import { rankingQuerySchema } from '@/shared';
import { requireUser } from '@/server/auth';
import { handle, ok, readQuery } from '@/server/http';
import { getGroupRanking } from '@/server/services/scoring';

/** GET /api/groups/:id/ranking?week=YYYY-Www - weekly leaderboard (visible to all members). */
export const GET = handle<{ id: string }>(async (req, { requestId, params }) => {
  const user = await requireUser(req);
  const { week } = readQuery(req, rankingQuerySchema);
  return ok(requestId, await getGroupRanking(user, params.id, week));
});
