/**
 * Point scoring. All functions are pure so they can be unit tested and reused by the
 * daily scoring job, the weekly aggregation and the ranking view.
 */

export interface DailyScoreInput {
  /** Photos the group requires per day (>= 1). */
  required: number;
  /** Closeness scores (0-100) of the user's accepted photos for the day. */
  acceptedCloseness: readonly number[];
  /** Points deducted for every missing photo. */
  missingPhotoPenalty: number;
  /** Lower bound (<= 0) of the daily result. */
  minDailyPoints: number;
}

export interface DailyScore {
  points: number;
  completionRatio: number;
  avgCloseness: number;
  acceptedCount: number;
  missing: number;
}

/**
 * Daily points = round(completionRatio * avgCloseness - missing * penalty), floored at
 * `minDailyPoints`.
 *
 * - Only the best `required` photos count (extra accepted photos give no bonus).
 * - completionRatio = counted photos / required.
 * - avgCloseness = mean closeness of the counted photos (0 when there are none).
 * - A day without any accepted photo therefore yields `-penalty * required`, floored.
 */
export function computeDailyScore(input: DailyScoreInput): DailyScore {
  const required = Math.max(1, Math.floor(input.required));
  const counted = [...input.acceptedCloseness].sort((a, b) => b - a).slice(0, required);
  const completionRatio = counted.length / required;
  const avgCloseness = counted.length === 0 ? 0 : counted.reduce((a, b) => a + b, 0) / counted.length;
  const missing = required - counted.length;
  const raw = completionRatio * avgCloseness - missing * input.missingPhotoPenalty;
  return {
    points: Math.max(input.minDailyPoints, Math.round(raw)),
    completionRatio,
    avgCloseness,
    acceptedCount: counted.length,
    missing,
  };
}

export interface RankingEntry {
  userId: string;
  points: number;
  /** Mean delay (ms) between the draw and the completing photo; null if never completed. */
  avgCompletionDelayMs: number | null;
}

export interface RankedEntry extends RankingEntry {
  rank: number;
}

/**
 * Orders the leaderboard: points (desc), then the faster average completion (asc, users who
 * never completed a day come last), then userId (asc) for a stable order. Ranks are sequential.
 */
export function rankEntries(entries: readonly RankingEntry[]): RankedEntry[] {
  const sorted = [...entries].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const da = a.avgCompletionDelayMs ?? Number.POSITIVE_INFINITY;
    const db = b.avgCompletionDelayMs ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da < db ? -1 : 1;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
  return sorted.map((entry, index) => ({ ...entry, rank: index + 1 }));
}
