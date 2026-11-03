'use client';
import { AlertTriangle, Camera, HardDrive, ImageIcon, RefreshCw, UserX, Users, UsersRound } from 'lucide-react';
import { motion } from 'framer-motion';
import { Badge, Button, Card, EmptyState, ErrorNotice, PageHeader, Spinner, StatTile } from '@/components/ui';
import { formatBytes } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/use-api';

interface Dashboard {
  users: number;
  disabledUsers: number;
  groups: number;
  archivedGroups: number;
  acceptedPhotos: number;
  uploadsToday: number;
  storageBytes: number;
  pendingCleanup: number;
  outboxTasks: number;
  alerts: Array<{ id: string; action: string; targetId: string | null; metadata: Record<string, unknown>; createdAt: string }>;
}

export default function DashboardPage() {
  const { t, formatNumber, formatDate } = useI18n();
  const { data, error, loading, reload } = useApi<Dashboard>('/api/admin/dashboard');

  return (
    <>
      <PageHeader
        title={t('nav.dashboard')}
        subtitle={t('dashboard.subtitle')}
        actions={
          <Button variant="secondary" onClick={reload} icon={<RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} aria-hidden />}>
            {t('common.refresh')}
          </Button>
        }
      />
      {error && <ErrorNotice code={error.code} onRetry={reload} />}
      {loading && !data && <Spinner />}
      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatTile label={t('dashboard.users')} value={formatNumber(data.users)} icon={<Users className="size-5" />} sub={t('dashboard.disabled', { count: data.disabledUsers })} />
            <StatTile label={t('dashboard.groups')} value={formatNumber(data.groups)} icon={<UsersRound className="size-5" />} sub={t('dashboard.archived', { count: data.archivedGroups })} />
            <StatTile label={t('dashboard.photos')} value={formatNumber(data.acceptedPhotos)} icon={<ImageIcon className="size-5" />} />
            <StatTile label={t('dashboard.uploadsToday')} value={formatNumber(data.uploadsToday)} icon={<Camera className="size-5" />} />
            <StatTile label={t('dashboard.storage')} value={formatBytes(data.storageBytes)} icon={<HardDrive className="size-5" />} />
            <StatTile
              label={t('dashboard.cleanupQueue')}
              value={formatNumber(data.pendingCleanup + data.outboxTasks)}
              icon={<UserX className="size-5" />}
              sub={t('dashboard.cleanupSub', { pending: data.pendingCleanup, outbox: data.outboxTasks })}
            />
          </div>

          <Card>
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <AlertTriangle className="size-4 text-amber-500" aria-hidden />
              {t('dashboard.alerts')}
            </h2>
            {data.alerts.length === 0 ? (
              <EmptyState title={t('dashboard.noAlerts')} />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.alerts.map((a, i) => (
                  <motion.li key={a.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                    <Badge tone="amber">{a.action}</Badge>
                    {a.targetId && <code className="text-xs text-slate-500">{a.targetId}</code>}
                    <span className="ml-auto text-xs text-slate-500">{formatDate(a.createdAt)}</span>
                  </motion.li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
