/**
 * Scheduled work. An external scheduler (e.g. GitHub Actions / cron-job.org) calls
 * `GET /api/cron/tick` every 5 minutes; Vercel's daily cron is only a fallback. Every step is
 * idempotent, so overlapping or repeated runs are safe.
 */
import { errorFields, log } from '../logger';
import { consume } from '../rate-limit';
import { processPushReceipts } from '../notifications';
import { drainDeletionOutbox } from './cleanup';
import { runDailyDraws, sendDeadlineReminders } from './draw';
import { runRetentionCleanup } from './retention';
import { closeFinishedWeeks, scoreClosedAssignments } from './scoring';
import { verifyStalePending } from './verification';

export type TickReport = Record<string, number | string>;

async function step(report: TickReport, name: string, work: () => Promise<number>): Promise<void> {
  try {
    report[name] = await work();
  } catch (error) {
    log.error('cron step failed', { step: name, ...errorFields(error) });
    report[name] = 'error';
  }
}

export async function runTick(now = new Date()): Promise<TickReport> {
  const report: TickReport = {};
  await step(report, 'draws', () => runDailyDraws(now));
  await step(report, 'reminders', () => sendDeadlineReminders(now));
  await step(report, 'verified', () => verifyStalePending(now));
  await step(report, 'scoredDays', () => scoreClosedAssignments(now));
  await step(report, 'closedWeeks', () => closeFinishedWeeks(now));
  await step(report, 'pushReceipts', () => processPushReceipts());
  await step(report, 'storageOutbox', () => drainDeletionOutbox(now));
  // Retention is heavier: at most once per hour.
  if ((await consume('cron:retention', 1, 3600)).allowed) {
    await step(report, 'retentionDeleted', async () => (await runRetentionCleanup(now)).deleted);
  }
  return report;
}
