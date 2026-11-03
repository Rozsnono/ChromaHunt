import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { addDays, zonedTimeToUtc } from '@/shared';
import { AuditLog, ColorPalette, DailyAssignment, Group } from '@/server/models';
import { drawForGroup, pickColor, runDailyDraws } from '@/server/services/draw';
import { initModels, resetDb, seedPalette } from './helpers';

beforeAll(initModels);
beforeEach(resetDb);

const id = () => new Types.ObjectId();

describe('pickColor (cooldown policy)', () => {
  const colors = [{ _id: id() }, { _id: id() }, { _id: id() }];
  const first = (n: number) => 0 * n;

  it('excludes colours drawn within the cooldown window', () => {
    const recent = [
      { colorId: colors[0]!._id, date: '2026-06-09' },
      { colorId: colors[1]!._id, date: '2026-06-08' },
    ];
    const result = pickColor(colors, recent, 3, '2026-06-10', first);
    expect(result?.relaxed).toBe(false);
    expect(result?.color._id).toBe(colors[2]!._id);
  });

  it('allows a colour again once the cooldown has passed', () => {
    const recent = [{ colorId: colors[0]!._id, date: '2026-06-01' }];
    const result = pickColor([colors[0]!], recent, 3, '2026-06-10', first);
    expect(result?.relaxed).toBe(false);
  });

  it('relaxes the cooldown for the least recently used colour when the palette is exhausted', () => {
    const recent = [
      { colorId: colors[0]!._id, date: '2026-06-09' },
      { colorId: colors[1]!._id, date: '2026-06-07' },
      { colorId: colors[2]!._id, date: '2026-06-08' },
    ];
    const result = pickColor(colors, recent, 5, '2026-06-10', first);
    expect(result?.relaxed).toBe(true);
    expect(result?.color._id).toBe(colors[1]!._id);
  });

  it('returns null for an empty palette', () => {
    expect(pickColor([], [], 3, '2026-06-10')).toBeNull();
  });
});

async function plainGroup(settings: Record<string, unknown> = {}) {
  return (await Group.create({ name: 'Draw group', settings })).toObject();
}

describe('drawForGroup', () => {
  it('creates exactly one assignment per day even under parallel retries', async () => {
    await seedPalette([['A', '#111111'], ['B', '#222222']]);
    const group = await plainGroup();
    const now = new Date('2030-03-05T09:00:00Z');
    const results = await Promise.all(Array.from({ length: 6 }, () => drawForGroup(group, { now })));
    expect(await DailyAssignment.countDocuments({ groupId: group._id })).toBe(1);
    expect(new Set(results.map((r) => String(r?._id))).size).toBe(1);
  });

  it('never repeats a colour within the cooldown window (palette of 4, cooldown 3)', async () => {
    await seedPalette([['A', '#aa0000'], ['B', '#00aa00'], ['C', '#0000aa'], ['D', '#aaaa00']]);
    const group = await plainGroup({ colorCooldownDays: 3 });
    const picked: string[] = [];
    for (let day = 0; day < 12; day++) {
      const now = new Date(Date.UTC(2030, 5, 1 + day, 9, 0));
      picked.push(String((await drawForGroup(group, { now }))!.colorId));
    }
    for (let i = 3; i < picked.length; i++) {
      expect(new Set(picked.slice(i - 3, i + 1)).size).toBe(4);
    }
    expect(await AuditLog.countDocuments({ action: 'draw.palette_cooldown_relaxed' })).toBe(0);
  });

  it('relaxes the cooldown and logs it when every colour is on cooldown', async () => {
    await seedPalette([['A', '#aa0000'], ['B', '#00aa00']]);
    const group = await plainGroup({ colorCooldownDays: 3 });
    const draw = (day: number) => drawForGroup(group, { now: new Date(Date.UTC(2030, 5, 1 + day, 9, 0)) });
    await draw(0);
    await draw(1);
    const third = await draw(2);
    expect(third?.cooldownRelaxed).toBe(true);
    expect(await AuditLog.countDocuments({ action: 'draw.palette_cooldown_relaxed' })).toBe(1);
  });

  it('skips the draw and raises one alert per day when no palette colour is active', async () => {
    await seedPalette([['A', '#aa0000']]);
    await ColorPalette.updateMany({}, { isActive: false });
    const group = await plainGroup();
    const now = new Date('2030-03-05T09:00:00Z');
    expect(await drawForGroup(group, { now })).toBeNull();
    expect(await drawForGroup(group, { now })).toBeNull();
    expect(await DailyAssignment.countDocuments({})).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'draw.palette_empty' })).toBe(1);
  });

  it('sets the deadline from the draw time and never past the next draw', async () => {
    await seedPalette();
    const now = new Date('2030-01-15T08:30:00Z');
    const short = await drawForGroup(await plainGroup({ deadlineHours: 6, dailyDrawTime: '08:00', timezone: 'Europe/Budapest' }), { now });
    expect(short!.deadlineAt.toISOString()).toBe('2030-01-15T13:00:00.000Z'); // 07:00Z draw + 6 h
    const full = await drawForGroup(await plainGroup({ deadlineHours: 24, dailyDrawTime: '08:00', timezone: 'Europe/Budapest' }), { now });
    expect(full!.deadlineAt.toISOString()).toBe('2030-01-16T07:00:00.000Z'); // next 08:00 local
  });

  it('an immediate first draw counts the deadline from now but stays below the next draw', async () => {
    await seedPalette();
    const now = new Date('2030-01-15T12:00:00Z'); // 13:00 local, after the 08:00 draw time
    const a = await drawForGroup(await plainGroup(), { now, immediate: true });
    expect(a!.deadlineAt.toISOString()).toBe('2030-01-16T07:00:00.000Z');
  });

  it('does not draw for archived groups', async () => {
    await seedPalette();
    const group = await plainGroup();
    await Group.updateOne({ _id: group._id }, { isArchived: true });
    expect(await drawForGroup({ ...group, isArchived: true }, { now: new Date() })).toBeNull();
  });
});

describe('runDailyDraws', () => {
  it('draws only for groups whose draw time has passed in their own timezone', async () => {
    await seedPalette();
    const due = await plainGroup({ dailyDrawTime: '08:00', timezone: 'Europe/Budapest' });
    const notYet = await plainGroup({ dailyDrawTime: '08:00', timezone: 'America/New_York' });
    const now = new Date('2030-01-15T09:00:00Z'); // 10:00 Budapest, 04:00 New York
    expect(await runDailyDraws(now)).toBe(1);
    expect(await DailyAssignment.exists({ groupId: due._id })).not.toBeNull();
    expect(await DailyAssignment.exists({ groupId: notYet._id })).toBeNull();
    expect(await runDailyDraws(now)).toBe(0); // idempotent
    expect(addDays('2030-01-15', 1)).toBe('2030-01-16');
    expect(zonedTimeToUtc('2030-01-15', '08:00', 'Europe/Budapest').toISOString()).toBe('2030-01-15T07:00:00.000Z');
  });
});
