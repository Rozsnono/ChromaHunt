import { requireUser } from '@/server/auth';
import { handle, ok } from '@/server/http';
import { finalizeSubmission } from '@/server/services/uploads';

/** POST /api/submissions/:id/finalize - runs the authoritative colour verification (idempotent). */
export const POST = handle<{ id: string }>(async (req, { requestId, params }) =>
  ok(requestId, await finalizeSubmission(await requireUser(req), params.id)));
