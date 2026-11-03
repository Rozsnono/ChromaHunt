/**
 * Daily scoring after each deadline, weekly aggregation when the ISO week (in the group's
 * timezone) ends, and the ranking read model. Rankings are computed from point rows at read
 * time, so deleting a user's rows updates every leaderboard immediately.
 */
import { Types } from 'mongoose';
import {
  addDays,
  computeDailyScore,
  isoWeekKey,
  isoWeekMonday,
  localDateString,
  rankEntries,
  weekEndInstant,
} from '@/shared';
import { requireMembership } from '../auth';
import {
  DailyAssignment,
  DailyPoint,
  Group,
  GroupMembership,
  Submission,
  User,
  WeeklyClose,
  WeeklyScore,
  type DailyAssignmentDoc,
  type UserDoc,
} from '../models';
import { getGlobalSettings, resolveSettings } from './settings';

/** Scores one finished day for every member that already belonged to the group at the deadline. */
export async function scoreAssignment(assignment: DailyAssignmentDoc, now = new Date()): Promise<number> {
  let rows = 0;
  if (assignment.scoringEnabled) {
    const members = await GroupMembership.find({ groupId: assignment.groupId, joinedAt: { $lte: assignment.deadlineAt } })
      .select('userId')
      .lean();
    const accepted = await Submission.find({ assignmentId: assignment._id, status: 'accepted' })
      .sort({ acceptedAt: 1 })
      .lean();
    const weekKey = isoWeekKey(assignment.date);
    for (const member of members) {
      const mine = accepted.filter((s) => String(s.userId) === String(member.userId));
      const score = computeDailyScore({
        required: assignment.requiredPhotos,
        acceptedCloseness: mine.map((s) => s.closenessScore ?? 0),
        missingPhotoPenalty: assignment.missingPhotoPenalty,
        minDailyPoints: assignment.minDailyPoints,
      });
      const completing = mine[assignment.requiredPhotos - 1];
      await DailyPoint.updateOne(
        { groupId: assignment.groupId, userId: member.userId, assignmentId: assignment._id },
        {
          $setOnInsert: {
            date: assignment.date,
            weekKey,
            points: score.points,
            completionRatio: score.completionRatio,
            avgCloseness: score.avgCloseness,
            acceptedCount: score.acceptedCount,
            required: assignment.requiredPhotos,
            completionDelayMs: completing?.acceptedAt ? completing.acceptedAt.getTime() - assignment.drawnAt.getTime() : null,
          },
        },
        { upsert: true },
      );
      rows++;
    }
  }
  await DailyAssignment.updateOne({ _id: assignment._id, scoredAt: null }, { scoredAt: now });
  return rows;
}

/** Cron: scores every assignment whose deadline has passed. */
export async function scoreClosedAssignments(now = new Date()): Promise<number> {
  const due = await DailyAssignment.find({ scoredAt: null, deadlineAt: { $lte: now } }).limit(200).lean();
  for (const assignment of due) await scoreAssignment(assignment, now);
  return due.length;
}

interface WeekAggregate {
  userId: Types.ObjectId;
  points: number;
  daysCompleted: number;
  avgCompletionDelayMs: number | null;
  breakdown: Array<{ date: string; points: number }>;
}

async function aggregateWeek(groupId: Types.ObjectId, weekKey: string): Promise<WeekAggregate[]> {
  const rows = await DailyPoint.find({ groupId, weekKey }).sort({ date: 1 }).lean();
  const byUser = new Map<string, typeof rows>();
  for (const row of rows) byUser.set(String(row.userId), [...(byUser.get(String(row.userId)) ?? []), row]);
  return [...byUser.values()].map((days) => {
    const delays = days.map((d) => d.completionDelayMs).filter((d): d is number => d !== null);
    return {
      userId: days[0]!.userId,
      points: days.reduce((sum, d) => sum + d.points, 0),
      daysCompleted: delays.length,
      avgCompletionDelayMs: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null,
      breakdown: days.map((d) => ({ date: d.date, points: d.points })),
    };
  });
}

/** Cron: persists the weekly aggregate for weeks that have ended and are fully scored. */
export async function closeFinishedWeeks(now = new Date()): Promise<number> {
  const global = await getGlobalSettings();
  const recentFrom = addDays(localDateString(now, 'UTC'), -35);
  const pairs = await DailyPoint.aggregate<{ _id: { groupId: Types.ObjectId; weekKey: string } }>([
    { $match: { date: { $gte: recentFrom } } },
    { $group: { _id: { groupId: '$groupId', weekKey: '$weekKey' } } },
  ]);
  let closed = 0;
  for (const { _id } of pairs) {
    const group = await Group.findById(_id.groupId).lean();
    if (!group || (await WeeklyClose.exists({ groupId: _id.groupId, weekKey: _id.weekKey }))) continue;
    const settings = resolveSettings(group, global);
    if (weekEndInstant(_id.weekKey, settings.timezone).getTime() > now.getTime()) continue;
    const monday = isoWeekMonday(_id.weekKey);
    const unscored = await DailyAssignment.exists({
      groupId: _id.groupId,
      date: { $gte: monday, $lte: addDays(monday, 6) },
      scoredAt: null,
    });
    if (unscored) continue;
    for (const entry of await aggregateWeek(_id.groupId, _id.weekKey)) {
      await WeeklyScore.updateOne(
        { groupId: _id.groupId, userId: entry.userId, weekKey: _id.weekKey },
        { $set: { ...entry, finalizedAt: now } },
        { upsert: true },
      );
    }
    await WeeklyClose.updateOne({ groupId: _id.groupId, weekKey: _id.weekKey }, { $setOnInsert: { closedAt: now } }, { upsert: true });
    closed++;
  }
  return closed;
}

/** Leaderboard of one ISO week (default: the current week in the group's timezone). */
export async function getRanking(groupId: Types.ObjectId, weekKey?: string) {
  const group = await Group.findById(groupId).lean();
  if (!group) return null;
  const settings = resolveSettings(group, await getGlobalSettings());
  const week = weekKey ?? isoWeekKey(localDateString(new Date(), settings.timezone));
  if (!settings.scoringEnabled) return { enabled: false, week, finalized: false, entries: [] };

  const closed = await WeeklyClose.exists({ groupId, weekKey: week });
  const aggregates: WeekAggregate[] = closed
    ? (await WeeklyScore.find({ groupId, weekKey: week }).lean()).map((s) => ({
        userId: s.userId,
        points: s.points,
        daysCompleted: s.daysCompleted,
        avgCompletionDelayMs: s.avgCompletionDelayMs,
        breakdown: s.breakdown,
      }))
    : await aggregateWeek(groupId, week);

  // Every current member appears, also with zero points.
  const members = await GroupMembership.find({ groupId }).select('userId').lean();
  const known = new Set(aggregates.map((a) => String(a.userId)));
  const all = [
    ...aggregates,
    ...members
      .filter((m) => !known.has(String(m.userId)))
      .map((m) => ({ userId: m.userId, points: 0, daysCompleted: 0, avgCompletionDelayMs: null, breakdown: [] })),
  ].filter((a) => members.some((m) => String(m.userId) === String(a.userId)));

  const ranked = rankEntries(all.map((a) => ({ userId: String(a.userId), points: a.points, avgCompletionDelayMs: a.avgCompletionDelayMs })));
  const users = await User.find({ _id: { $in: all.map((a) => a.userId) } }).select('displayName').lean();
  const names = new Map(users.map((u) => [String(u._id), u.displayName] as const));
  const byId = new Map(all.map((a) => [String(a.userId), a] as const));
  return {
    enabled: true,
    week,
    finalized: Boolean(closed),
    entries: ranked.map((r) => ({
      rank: r.rank,
      userId: r.userId,
      displayName: names.get(r.userId) ?? '?',
      points: r.points,
      daysCompleted: byId.get(r.userId)?.daysCompleted ?? 0,
      breakdown: byId.get(r.userId)?.breakdown ?? [],
    })),
  };
}

export async function getGroupRanking(user: UserDoc, groupId: string, week?: string) {
  const { group } = await requireMembership(groupId, user);
  return getRanking(group._id, week);
}
