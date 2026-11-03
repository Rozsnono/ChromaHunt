import { uploadIntentSchema } from '@chromahunt/shared';
import { requireUser } from '@/server/auth';
import { handle, ok, readJson } from '@/server/http';
import { createUploadIntent } from '@/server/services/uploads';

/** POST /api/groups/:id/uploads/intent - reserves a submission and returns a single-use upload token. */
export const POST = handle<{ id: string }>(async (req, { requestId, params }) => {
  const user = await requireUser(req);
  const { contentType: _type, ...input } = await readJson(req, uploadIntentSchema);
  return ok(requestId, await createUploadIntent(user, params.id, input), { status: 201 });
});
