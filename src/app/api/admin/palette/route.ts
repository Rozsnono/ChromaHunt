import { paletteColorSchema } from '@/shared';
import { requirePermission } from '@/server/auth';
import { handle, ok, readJson } from '@/server/http';
import { createColor, listPalette } from '@/server/services/admin';

export const GET = handle(async (req, { requestId }) => {
  await requirePermission(req, 'palette.manage');
  return ok(requestId, await listPalette());
});

/** POST /api/admin/palette - adds a colour; CIELAB coordinates are precomputed server side. */
export const POST = handle(async (req, { requestId }) => {
  const actor = await requirePermission(req, 'palette.manage');
  return ok(requestId, await createColor(await readJson(req, paletteColorSchema), actor), { status: 201 });
});
