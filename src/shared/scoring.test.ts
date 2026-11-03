import { describe, expect, it } from 'vitest';
import { computeDailyScore, rankEntries } from './scoring';

const base = { required: 2, missingPhotoPenalty: 10, minDailyPoints: -10 };

describe('computeDailyScore', () => {
  it('awards completion * average closeness for a full day', () => {
    const s = computeDailyScore({ ...base, acceptedCloseness: [80, 60] });
    expect(s).toMatchObject({ points: 70, completionRatio: 1, avgCloseness: 70, missing: 0 });
  });

  it('scales by completion and subtracts the penalty for missing photos', () => {
    // ratio 0.5 * avg 80 = 40, minus 1 missing * 10 = 30
    expect(computeDailyScore({ ...base, acceptedCloseness: [80] }).points).toBe(30);
  });

  it('floors an empty day at minDailyPoints', () => {
    // -2 * 10 = -20, floored at -10
    expect(computeDailyScore({ ...base, acceptedCloseness: [] }).points).toBe(-10);
  });

  it('counts only the best `required` photos', () => {
    const s = computeDailyScore({ ...base, required: 1, acceptedCloseness: [40, 90, 70] });
    expect(s.points).toBe(90);
    expect(s.acceptedCount).toBe(1);
  });
});

describe('rankEntries', () => {
  it('orders by points, then completion speed, then userId', () => {
    const ranked = rankEntries([
      { userId: 'c', points: 50, avgCompletionDelayMs: 1000 },
      { userId: 'a', points: 50, avgCompletionDelayMs: 2000 },
      { userId: 'b', points: 80, avgCompletionDelayMs: null },
      { userId: 'd', points: 50, avgCompletionDelayMs: 1000 },
      { userId: 'e', points: 50, avgCompletionDelayMs: null },
    ]);
    expect(ranked.map((r) => r.userId)).toEqual(['b', 'c', 'd', 'a', 'e']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });
});
