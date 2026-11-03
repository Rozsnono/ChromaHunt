import { describe, expect, it } from 'vitest';
import { buildMonthGrid, monthRange, shiftMonth } from './calendar';

describe('calendar helpers', () => {
  it('builds Monday-first grids with padding', () => {
    const grid = buildMonthGrid(2026, 11); // 1 Nov 2026 is a Sunday
    expect(grid.every((row) => row.length === 7)).toBe(true);
    expect(grid[0]?.slice(0, 6).every((c) => c.date === null)).toBe(true);
    expect(grid[0]?.[6]?.date).toBe('2026-11-01');
    expect(grid.flat().filter((c) => c.date).length).toBe(30);
  });
  it('handles February in leap and normal years', () => {
    expect(buildMonthGrid(2028, 2).flat().filter((c) => c.date).length).toBe(29);
    expect(monthRange(2027, 2)).toEqual({ from: '2027-02-01', to: '2027-02-28' });
  });
  it('shifts months across year boundaries', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 6, 0)).toEqual({ year: 2026, month: 6 });
  });
});
