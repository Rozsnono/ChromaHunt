import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { isoWeekKey, localDateString } from '@chromahunt/shared';
import { DailyAssignment, DailyPoint, GroupMembership, Submission, WeeklyClose, WeeklyScore } from '@/server/models';
import { closeFinishedWeeks, getRanking, scoreClosedAssignments } from '@/server/services/scoring';
import { initModels, makeGroup, makeUser, resetDb, seedPalette } from './helpers';

beforeAll(initModels);
beforeEach(resetDb);

/** A finished day with two required photos, scoring enabled. */
async function pastDay(groupId: string, date: string, drawnAt: Date) {
  const [color] = await seedPaletteOnce();
  return DailyAssignment.create({
    groupId,
    date,
    colorId: color!._id,
    colorHex: color!.hex,
    colorName: color!.name,
    colorLab: color!.lab,
    drawnAt,
    deadlineAt: new Date(drawnAt.getTime() + 24 * 3600 * 1000),
    requiredPhotos: 2,
    acceptanceThreshold: 55,
    scoringEnabled: true,
    missingPhotoPenalty: 10,
    minDailyPoints: -10,
    timezone: 'Europe/Budapest',
    retentionDays: 30,
  });
}
let palette: Awaited<ReturnType<typeof seedPalette>> | undefined;
async function seedPaletteOnce() {
  palette ??= await seedPalette();
  return palette;
}
beforeEach(() => {
  palette = undefined;
});

async function accept(userId: Types.ObjectId, assignment: { _id: Types.ObjectId; groupId: Types.ObjectId; drawnAt: Date }, closeness: number, minutesAfterDraw: number) {
  await Submission.create({
    groupId: assignment.groupId,
    userId,
    assignmentId: assignment._id,
    status: 'accepted',
    idempotencyKey: `${userId}-${Math.random()}`,
    capturedAt: new Date(),
    closenessScore: closeness,
    acceptedAt: new Date(assignment.drawnAt.getTime() + minutesAfterDraw * 60000),
  });
}

describe('daily scoring and weekly ranking', () => {
  it('scores every member once, including those who did nothing', async () => {
    await seedPaletteOnce();
    const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
    const { groupId } = await makeGroup(a, [b, c], { scoringEnabled: true, requiredPhotosPerDay: 2 });
    await DailyAssignment.deleteMany({});
    await GroupMembership.updateMany({}, { joinedAt: new Date(0) }); // members predate the finished day
    const drawnAt = new Date(Date.now() - 3 * 86400000);
    const day = await pastDay(groupId, '2030-01-07', drawnAt);

    await accept(a._id, day, 80, 30);
    await accept(a._id, day, 60, 45); // completed: avg 70
    await accept(b._id, day, 90, 10); // half done: 0.5*90 - 10 = 35
    // c: nothing -> -20 floored to -10

    expect(await scoreClosedAssignments()).toBe(1);
    const points = Object.fromEntries((await DailyPoint.find({}).lean()).map((p) => [String(p.userId), p]));
    expect(points[String(a._id)]?.points).toBe(70);
    expect(points[String(a._id)]?.completionDelayMs).toBe(45 * 60000);
    expect(points[String(b._id)]?.points).toBe(35);
    expect(points[String(b._id)]?.completionDelayMs).toBeNull();
    expect(points[String(c._id)]?.points).toBe(-10);

    // Idempotent: a second run neither duplicates nor changes rows.
    await DailyAssignment.updateOne({ _id: day._id }, { scoredAt: null });
    await scoreClosedAssignments();
    expect(await DailyPoint.countDocuments({})).toBe(3);
  });

  it('does not score groups with scoring disabled', async () => {
    await seedPaletteOnce();
    const a = await makeUser();
    const { groupId } = await makeGroup(a);
    await DailyAssignment.deleteMany({});
    const day = await pastDay(groupId, '2030-01-07', new Date(Date.now() - 3 * 86400000));
    await DailyAssignment.updateOne({ _id: day._id }, { scoringEnabled: false });
    await scoreClosedAssignments();
    expect(await DailyPoint.countDocuments({})).toBe(0);
    expect((await DailyAssignment.findById(day._id).lean())?.scoredAt).not.toBeNull();
  });

  it('ranks by points, then faster completion, then user id, and closes finished weeks', async () => {
    await seedPaletteOnce();
    const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
    const { groupId } = await makeGroup(a, [b, c], { scoringEnabled: true, requiredPhotosPerDay: 1 });
    await DailyAssignment.deleteMany({});
    await GroupMembership.updateMany({}, { joinedAt: new Date(0) });
    const drawnAt = new Date(Date.now() - 14 * 86400000); // two weeks ago: its week is finished
    const date = localDateString(drawnAt, 'Europe/Budapest');
    const day = await pastDay(groupId, date, drawnAt);
    await DailyAssignment.updateOne({ _id: day._id }, { requiredPhotos: 1 });
    await accept(a._id, day, 80, 50);
    await accept(b._id, day, 80, 20); // same points as a, but faster
    await accept(c._id, day, 95, 120);

    await scoreClosedAssignments();
    const week = isoWeekKey(date);
    const live = await getRanking(new Types.ObjectId(groupId), week);
    expect(live?.finalized).toBe(false);
    expect(live?.entries.map((e) => e.userId)).toEqual([String(c._id), String(b._id), String(a._id)]);

    expect(await closeFinishedWeeks()).toBe(1);
    expect(await WeeklyClose.countDocuments({})).toBe(1);
    expect(await WeeklyScore.countDocuments({})).toBe(3);
    const closed = await getRanking(new Types.ObjectId(groupId), week);
    expect(closed?.finalized).toBe(true);
    expect(closed?.entries.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(closed?.entries[0]?.points).toBe(95);
    expect(await closeFinishedWeeks()).toBe(0); // already closed
  });

  it('reports scoring as disabled instead of an empty list', async () => {
    await seedPaletteOnce();
    const a = await makeUser();
    const { groupId } = await makeGroup(a);
    expect((await getRanking(new Types.ObjectId(groupId)))?.enabled).toBe(false);
  });
});
