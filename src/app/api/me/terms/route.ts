import { acceptTermsSchema } from '@/shared';
import { requireUser } from '@/server/auth';
import { handle, ok, readJson } from '@/server/http';
import { acceptCurrentTerms } from '@/server/services/auth';

/** POST /api/me/terms - accepts the current privacy policy version (re-acceptance after an update). */
export const POST = handle(async (req, { requestId }) => {
  const user = await requireUser(req, { allowPasswordChangePending: true });
  const { privacyPolicyVersion } = await readJson(req, acceptTermsSchema);
  return ok(requestId, await acceptCurrentTerms(user, privacyPolicyVersion));
});
