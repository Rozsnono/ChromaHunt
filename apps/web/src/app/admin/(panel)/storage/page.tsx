'use client';
import { motion } from 'framer-motion';
import { Eraser, HardDrive, ImageIcon, Timer } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, EmptyState, ErrorNotice, PageHeader, Spinner, StatTile, TableWrap, td, th, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/use-api';

interface Stats {
  quotaBytes: number;
  totalBytes: number;
  totalPhotos: number;
  cleanupPending: number;
  deletionOutbox: number;
  oldestPhotoAt: string | null;
  groups: Array<{ groupId: string; name: string; photos: number; bytes: number; retentionDays: number }>;
}
interface Report {
  deleted: number;
  failed: number;
  orphansRemoved: number;
  outboxRemoved: number;
}

export default function StoragePage() {
  const { t, tError, formatNumber, formatDate } = useI18n();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Stats>('/api/admin/storage');
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Report | null>(null);

  async function cleanup() {
    setRunning(true);
    try {
      setReport(await api<Report>('/api/admin/storage/cleanup', { method: 'POST', body: {} }));
      toast('success', t('storage.cleanupDone'));
      reload();
    } catch (e) {
      toast('error', tError(e instanceof ApiError ? e.code : 'INTERNAL_ERROR'));
    } finally {
      setRunning(false);
    }
  }

  const usage = data && data.quotaBytes > 0 ? Math.min(100, (data.totalBytes / data.quotaBytes) * 100) : null;

  return (
    <>
      <PageHeader
        title={t('nav.storage')}
        subtitle={t('storage.subtitle')}
        actions={
          <Button onClick={cleanup} loading={running} icon={<Eraser className="size-4" aria-hidden />}>
            {t('storage.runCleanup')}
          </Button>
        }
      />
      {error && <ErrorNotice code={error.code} onRetry={reload} />}
      {loading && !data && <Spinner />}
      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label={t('storage.used')} value={formatBytes(data.totalBytes)} icon={<HardDrive className="size-5" />} sub={data.quotaBytes ? t('storage.ofQuota', { quota: formatBytes(data.quotaBytes) }) : t('storage.noQuota')} />
            <StatTile label={t('dashboard.photos')} value={formatNumber(data.totalPhotos)} icon={<ImageIcon className="size-5" />} />
            <StatTile label={t('storage.oldest')} value={data.oldestPhotoAt ? formatDate(data.oldestPhotoAt) : '-'} icon={<Timer className="size-5" />} sub={t('dashboard.cleanupSub', { pending: data.cleanupPending, outbox: data.deletionOutbox })} />
          </div>
          {usage !== null && (
            <Card>
              <div className="mb-2 flex justify-between text-sm">
                <span>{t('storage.quotaUsage')}</span>
                <span className="tabular-nums">{usage.toFixed(1)}%</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="progressbar" aria-valuenow={Math.round(usage)} aria-valuemin={0} aria-valuemax={100}>
                <motion.div className={usage > 90 ? 'h-full bg-red-500' : 'h-full bg-brand-600'} initial={{ width: 0 }} animate={{ width: `${usage}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} />
              </div>
            </Card>
          )}
          {report && (
            <Card className="text-sm">
              <h2 className="mb-2 font-semibold">{t('storage.report')}</h2>
              <ul className="grid gap-1 sm:grid-cols-4">
                <li>{t('storage.reportDeleted', { count: report.deleted })}</li>
                <li>{t('storage.reportFailed', { count: report.failed })}</li>
                <li>{t('storage.reportOrphans', { count: report.orphansRemoved })}</li>
                <li>{t('storage.reportOutbox', { count: report.outboxRemoved })}</li>
              </ul>
            </Card>
          )}
          <section>
            <h2 className="mb-3 text-base font-semibold">{t('storage.perGroup')}</h2>
            {data.groups.length === 0 ? (
              <EmptyState title={t('storage.empty')} />
            ) : (
              <TableWrap>
                <thead>
                  <tr>
                    <th className={th}>{t('groups.name')}</th>
                    <th className={th}>{t('dashboard.photos')}</th>
                    <th className={th}>{t('storage.size')}</th>
                    <th className={th}>{t('settings.retentionDays')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.groups.map((g) => (
                    <tr key={g.groupId}>
                      <td className={td}>{g.name}</td>
                      <td className={`${td} tabular-nums`}>{formatNumber(g.photos)}</td>
                      <td className={`${td} tabular-nums`}>{formatBytes(g.bytes)}</td>
                      <td className={`${td} tabular-nums`}>{g.retentionDays}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </section>
        </div>
      )}
    </>
  );
}
