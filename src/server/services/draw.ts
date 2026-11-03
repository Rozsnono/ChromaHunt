/**
 * Daily colour draw. The cron tick calls `runDailyDraws` every few minutes; for every
 * group whose draw time has passed and that has no assignment for its local date yet, one
 * colour is drawn. The unique index (groupId, date) makes retries and races safe.
 */
import { randomInt } from 'node:crypto';
import { Types } from 'mongoose';
import { addDays, localDateString, zonedTimeToUtc } from '@/shared';
import { audit, SYSTEM_ACTOR } from '../audit';
import { errorFields, log } from '../logger';
import {
  AuditLog,
  ColorPalette,
  DailyAssignment,
  Group,
  GroupMembership,
  Submission,
  type ColorPaletteDoc,
  type DailyAssignmentDoc,
  type GroupDoc,
} from '../models';
import { notify } from '../notifications';
import { getGlobalSettings, resolveSettings } from './settings';

export interface DrawOptions {
  now?: Date;
  /**
   * First draw right after group creation: the deadline counts from `now`, not from the
   * (possibly earlier) scheduled draw time.
   */
  immediate?: boolean;
}

/** Pure cooldown policy: colours used within the cooldown window are excluded. */
export function pickColor<T extends { _id: Types.ObjectId }>(
  active: T[],
  recent: Array<{ colorId: Types.ObjectId; date: string }>,
  cooldownDays: number,
  today: string,
  random: (n: number) => number = randomInt,
): { color: T; relaxed: boolean } | null {
  if (active.length === 0) return null;
  const since = addDays(today, -cooldownDays);
  const blocked = new Set(recent.filter((r) => r.date >= since).map((r) => String(r.colorId)));
  const candidates = active.filter((c) => !blocked.has(String(c._id)));
  if (candidates.length > 0) return { color: candidates[random(candidates.length)] as T, relaxed: false };

  // Palette exhausted: relax the cooldown for the least recently used colour.
  const lastUsed = new Map<string, string>();
  for (const r of recent) {
    const key = String(r.colorId);
    if (!lastUsed.has(key) || r.date > (lastUsed.get(key) as string)) lastUsed.set(key, r.date);
  }
  const oldest = [...active].sort((a, b) =>
    (lastUsed.get(String(a._id)) ?? '0000').localeCompare(lastUsed.get(String(b._id)) ?? '0000'),
  )[0] as T;
  return { color: oldest, relaxed: true };
}

/**
 * Draws the colour for the group's current local date. Returns the existing assignment if
 * the day was already drawn (idempotent), or null when no draw is possible.
 */
export async function drawForGroup(group: GroupDoc, options: DrawOptions = {}): Promise<DailyAssignmentDoc | null> {
  const now = options.now ?? new Date();
  if (group.isArchived) return null;
  const global = await getGlobalSettings();
  const settings = resolveSettings(group, global);
  const date = localDateString(now, settings.timezone);

  const existing = await DailyAssignment.findOne({ groupId: group._id, date }).lean();
  if (existing) return existing;

  const palette: ColorPaletteDoc[] = await ColorPalette.find({ isActive: true }).lean();
  if (palette.length === 0) {
    await alertOncePerDay(group, date, 'draw.palette_empty');
    return null;
  }

  const since = addDays(date, -Math.max(settings.colorCooldownDays, 30));
  const recent = await DailyAssignment.find({ groupId: group._id, date: { $gte: since } })
    .select('colorId date')
    .lean();
  const picked = pickColor(palette, recent, settings.colorCooldownDays, date);
  if (!picked) return null;

  const scheduledAt = zonedTimeToUtc(date, settings.dailyDrawTime, settings.timezone);
  const nextScheduledAt = zonedTimeToUtc(addDays(date, 1), settings.dailyDrawTime, settings.timezone);
  const base = options.immediate ? now : scheduledAt;
  // The deadline never passes the next draw, so two assignments are never open at once.
  const deadlineAt = new Date(Math.min(base.getTime() + settings.deadlineHours * 3600 * 1000, nextScheduledAt.getTime()));

  let assignment: DailyAssignmentDoc;
  try {
    const created = await DailyAssignment.create({
      groupId: group._id,
      date,
      colorId: picked.color._id,
      colorHex: picked.color.hex,
      colorName: picked.color.name,
      colorLab: picked.color.lab,
      drawnAt: now,
      deadlineAt,
      requiredPhotos: settings.requiredPhotosPerDay,
      acceptanceThreshold: settings.acceptanceThreshold,
      scoringEnabled: settings.scoringEnabled,
      missingPhotoPenalty: settings.missingPhotoPenalty,
      minDailyPoints: settings.minDailyPoints,
      timezone: settings.timezone,
      retentionDays: settings.retentionDays,
      cooldownRelaxed: picked.relaxed,
    });
    assignment = created.toObject();
  } catch (error) {
    // Duplicate key: a concurrent run (cron retry) already drew today. Treat as success.
    if ((error as { code?: number }).code === 11000) return DailyAssignment.findOne({ groupId: group._id, date }).lean();
    throw error;
  }

  if (picked.relaxed) {
    await audit({
      actor: SYSTEM_ACTOR,
      action: 'draw.palette_cooldown_relaxed',
      targetType: 'group',
      targetId: String(group._id),
      metadata: { date, colorId: String(picked.color._id) },
    });
    log.warn('PALETTE_COOLDOWN_RELAXED', { groupId: String(group._id), date });
  }
  if (settings.notifyDailyColor) {
    const members = await GroupMembership.find({ groupId: group._id }).select('userId').lean();
    await notify(
      members.map((m) => m.userId),
      'daily_color',
      { group: group.name, color: picked.color.name },
      { groupId: String(group._id), assignmentId: String(assignment._id) },
    );
  }
  return assignment;
}

async function alertOncePerDay(group: GroupDoc, date: string, action: string): Promise<void> {
  const already = await AuditLog.exists({ action, targetId: String(group._id), 'metadata.date': date });
  if (already) return;
  await audit({
    actor: SYSTEM_ACTOR,
    action,
    targetType: 'group',
    targetId: String(group._id),
    metadata: { date, severity: 'alert' },
  });
  log.error('daily draw skipped: no active palette colors', { groupId: String(group._id), date });
}

/** Cron entry point: draws for every group whose draw time has passed today. Returns the number of new draws. */
export async function runDailyDraws(now = new Date()): Promise<number> {
  const global = await getGlobalSettings();
  let drawn = 0;
  for await (const group of Group.find({ isArchived: false }).lean().cursor()) {
    try {
      const settings = resolveSettings(group, global);
      const date = localDateString(now, settings.timezone);
      if (now < zonedTimeToUtc(date, settings.dailyDrawTime, settings.timezone)) continue;
      if (await DailyAssignment.exists({ groupId: group._id, date })) continue;
      if (await drawForGroup(group, { now })) drawn++;
    } catch (error) {
      log.error('daily draw failed for group', { groupId: String(group._id), ...errorFields(error) });
    }
  }
  return drawn;
}

/** Sends the "deadline approaching" push once per assignment, only to members still missing photos. */
export async function sendDeadlineReminders(now = new Date()): Promise<number> {
  let sent = 0;
  const open = await DailyAssignment.find({ deadlineAt: { $gt: now }, drawnAt: { $lte: now }, reminderSentAt: null }).lean();
  const global = await getGlobalSettings();
  for (const assignment of open) {
    const group = await Group.findById(assignment.groupId).lean();
    if (!group || group.isArchived) continue;
    const settings = resolveSettings(group, global);
    if (!settings.notifyDeadline || settings.deadlineReminderHours <= 0) continue;
    const reminderAt = assignment.deadlineAt.getTime() - settings.deadlineReminderHours * 3600 * 1000;
    if (now.getTime() < reminderAt) continue;
    const claimed = await DailyAssignment.findOneAndUpdate({ _id: assignment._id, reminderSentAt: null }, { reminderSentAt: now });
    if (!claimed) continue; // another run sent it
    const members = await GroupMembership.find({ groupId: assignment.groupId }).select('userId').lean();
    const counts = await Submission.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { assignmentId: assignment._id, status: { $in: ['accepted', 'pending_verification'] } } },
      { $group: { _id: '$userId', n: { $sum: 1 } } },
    ]);
    const done = new Set(counts.filter((c) => c.n >= assignment.requiredPhotos).map((c) => String(c._id)));
    const missing = members.map((m) => m.userId).filter((id) => !done.has(String(id)));
    const hours = Math.max(1, Math.round((assignment.deadlineAt.getTime() - now.getTime()) / 3600000));
    await notify(missing, 'deadline_reminder', { group: group.name, color: assignment.colorName, hours }, { groupId: String(group._id) });
    sent++;
  }
  return sent;
}
