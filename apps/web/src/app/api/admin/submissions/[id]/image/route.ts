import { Types } from 'mongoose';
import { requirePermission } from '@/server/auth';
import { notFound } from '@/server/errors';
import { handle } from '@/server/http';
import { Submission } from '@/server/models';
import { storage } from '@/server/storage/driver';

/** GET - image of any submission for moderation. Still proxied: no storage URL is ever exposed. */
export const GET = handle<{ id: string }>(async (req, { params }) => {
  await requirePermission(req, 'groups.manage');
  if (!Types.ObjectId.isValid(params.id)) throw notFound();
  const submission = await Submission.findById(params.id).lean();
  if (!submission?.storageKey) throw notFound();
  const object = await storage().get(submission.storageKey);
  if (!object) throw notFound();
  return new Response(object.body, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' },
  });
});
