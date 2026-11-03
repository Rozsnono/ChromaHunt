import type { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth';
import { handle } from '@/server/http';
import { openImage } from '@/server/services/gallery';

/**
 * GET /api/submissions/:id/image - authenticated image proxy. Storage URLs and credentials are
 * never exposed; membership and the retention window are checked on every request.
 */
export const GET = handle<{ id: string }>(async (req: NextRequest, { params }) => {
  const object = await openImage(await requireUser(req), params.id);
  return new Response(object.body, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      ...(object.size ? { 'Content-Length': String(object.size) } : {}),
    },
  });
});
