import type { NextRequest } from 'next/server';
import { safeEqual } from '@/server/crypto';
import { env } from '@/server/env';
import { unauthenticated } from '@/server/errors';
import { handle, ok } from '@/server/http';
import { runTick } from '@/server/services/tick';

function assertCron(req: NextRequest): void {
  const header = req.headers.get('authorization') ?? '';
  if (!safeEqual(header, `Bearer ${env().CRON_SECRET}`)) throw unauthenticated();
}

/** GET/POST /api/cron/tick - scheduled work (draws, reminders, scoring, retention...). Secret protected. */
export const GET = handle(async (req, { requestId }) => {
  assertCron(req);
  return ok(requestId, await runTick());
});
export const POST = GET;
