'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Badge, EmptyState, ErrorNotice, PageHeader, Pagination, SearchInput, Spinner, TableWrap, td, th, Toggle } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/use-api';

interface Entry {
  id: string;
  actorType: 'admin' | 'user' | 'system';
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
interface AuditPage {
  items: Entry[];
  total: number;
  page: number;
  pageSize: number;
}

export default function AuditPageView() {
  const { t, formatDate } = useI18n();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const qs = new URLSearchParams({ page: String(page), ...(action ? { action } : {}), ...(alertsOnly ? { alertsOnly: 'true' } : {}) });
  const { data, error, loading, reload } = useApi<AuditPage>(`/api/admin/audit?${qs}`);
  const tone = (e: Entry) => (e.metadata?.severity === 'alert' ? 'amber' : e.actorType === 'admin' ? 'brand' : e.actorType === 'system' ? 'slate' : 'green');

  return (
    <>
      <PageHeader title={t('nav.audit')} subtitle={t('audit.subtitle')} />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <SearchInput placeholder={t('audit.filter')} value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label={t('audit.filter')} />
        <div className="w-56">
          <Toggle label={t('audit.alertsOnly')} checked={alertsOnly} onChange={(v) => { setAlertsOnly(v); setPage(1); }} />
        </div>
      </div>
      {error && <ErrorNotice code={error.code} onRetry={reload} />}
      {loading && !data && <Spinner />}
      {data && data.items.length === 0 && <EmptyState title={t('common.noResults')} />}
      {data && data.items.length > 0 && (
        <>
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>{t('audit.time')}</th>
                <th className={th}>{t('audit.action')}</th>
                <th className={th}>{t('audit.actor')}</th>
                <th className={th}>{t('audit.target')}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <Fragment key={e.id}>
                  <tr className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => setOpen(open === e.id ? null : e.id)}>
                    <td className={`${td} whitespace-nowrap text-xs text-slate-500`}>{formatDate(e.createdAt)}</td>
                    <td className={td}><Badge tone={tone(e)}>{e.action}</Badge></td>
                    <td className={`${td} font-mono text-xs`}>{e.actorType}:{e.actorId.slice(0, 12)}</td>
                    <td className={`${td} font-mono text-xs`}>{e.targetType ? `${e.targetType}:${(e.targetId ?? '').slice(0, 12)}` : '-'}</td>
                    <td className={td}><ChevronDown className={`size-4 transition-transform ${open === e.id ? 'rotate-180' : ''}`} aria-hidden /></td>
                  </tr>
                  <AnimatePresence>
                    {open === e.id && (
                      <tr>
                        <td colSpan={5} className="bg-slate-50 px-4 py-3 dark:bg-slate-900/60">
                          <motion.pre initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-x-auto text-xs text-slate-600 dark:text-slate-300">
                            {JSON.stringify(e.metadata, null, 2)}
                          </motion.pre>
                        </td>
                      </tr>
                    )}
                  </AnimatePresence>
                </Fragment>
              ))}
            </tbody>
          </TableWrap>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
