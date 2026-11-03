import { env } from '@/server/env';
import { handle, ok } from '@/server/http';
import { getGlobalSettings } from '@/server/services/settings';

/** GET /api/meta - public instance information needed before sign-in. */
export const GET = handle(async (_req, { requestId }) => {
  const global = await getGlobalSettings();
  return ok(requestId, { privacyPolicyVersion: env().PRIVACY_POLICY_VERSION, registrationOpen: global.registrationOpen });
});
