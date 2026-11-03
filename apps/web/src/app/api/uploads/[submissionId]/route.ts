import { requireUser } from '@/server/auth';
import { AppError } from '@/server/errors';
import { handle, ok } from '@/server/http';
import { receiveUpload } from '@/server/services/uploads';

/**
 * PUT /api/uploads/:submissionId - streams the photo to storage.
 * Requires the bearer access token AND the single-use upload token in `X-Upload-Token`
 * (a header instead of the URL, so it does not end up in access logs).
 */
export const PUT = handle<{ submissionId: string }>(async (req, { requestId, params }) => {
  const user = await requireUser(req);
  const token = req.headers.get('x-upload-token');
  if (!token) throw new AppError('UPLOAD_TOKEN_INVALID', 401);
  return ok(requestId, await receiveUpload(user, params.submissionId, token, req));
});
