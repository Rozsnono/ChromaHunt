/** Calendar grid helpers (pure, unit tested). Weeks start on Monday. */

export interface MonthCell {
  /** `YYYY-MM-DD`, or null for the padding cells before/after the month. */
  date: string | null;
  day: number | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function monthKey(year: number, month: number): string {
  return `${year}-${pad(month)}`;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function monthRange(year: number, month: number): { from: string; to: string } {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${monthKey(year, month)}-01`, to: `${monthKey(year, month)}-${pad(last)}` };
}

/** Rows of 7 cells, Monday first, padded with empty cells. */
export function buildMonthGrid(year: number, month: number): MonthCell[][] {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sunday
  const offset = (first + 6) % 7; // Monday = 0
  const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: MonthCell[] = [];
  for (let i = 0; i < offset; i++) cells.push({ date: null, day: null });
  for (let d = 1; d <= total; d++) cells.push({ date: `${monthKey(year, month)}-${pad(d)}`, day: d });
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null });
  const rows: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}
