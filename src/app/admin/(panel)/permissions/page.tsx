'use client';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { PERMISSIONS } from '@/shared';
import { PermissionEditor } from '@/components/permission-editor';
import { Badge, Card, Drawer, EmptyState, ErrorNotice, PageHeader, SearchInput, Spinner, TableWrap, td, th } from '@/components/ui';
import { useI18n, type Key } from '@/lib/i18n';
import { useApi } from '@/lib/use-api';

interface Row {
  id: string;
  email: string;
  displayName: string;
  permissions: string[];
}
interface List {
  items: Row[];
  total: number;
}

export default function PermissionsPageView() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);
  const holders = useApi<List>('/api/admin/users?withPermissions=true');
  // The search always asks for a user list the admin may edit (permissions.manage).
  const search = useApi<List>(q.trim().length >= 2 ? `/api/admin/users?q=${encodeURIComponent(q.trim())}` : null);

  const rows = q.trim().length >= 2 ? search.data?.items : holders.data?.items;
  const loading = q.trim().length >= 2 ? search.loading : holders.loading;
  const error = holders.error ?? search.error;

  return (
    <>
      <PageHeader title={t('nav.permissions')} subtitle={t('permissions.subtitle')} />
      <Card className="mb-6">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><ShieldCheck className="size-4 text-brand-600" aria-hidden />{t('permissions.catalog')}</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {PERMISSIONS.map((p) => (
            <li key={p} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
              <p className="font-medium">{t(`perm.${p}` as Key)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t(`perm.${p}.desc` as Key)}</p>
              <code className="text-[11px] text-slate-400">{p}</code>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">{t('permissions.note')}</p>
      </Card>
      <div className="mb-4">
        <SearchInput placeholder={t('permissions.search')} aria-label={t('permissions.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <ErrorNotice code={error.code} />}
      {loading && !rows && <Spinner />}
      {rows && rows.length === 0 && <EmptyState title={q ? t('common.noResults') : t('permissions.none')} />}
      {rows && rows.length > 0 && (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>{t('users.name')}</th>
              <th className={th}>E-mail</th>
              <th className={th}>{t('nav.permissions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} tabIndex={0} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => setSelected(u)} onKeyDown={(e) => e.key === 'Enter' && setSelected(u)}>
                <td className={`${td} font-medium`}>{u.displayName}</td>
                <td className={td}>{u.email}</td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1">
                    {u.permissions.length === 0 ? <span className="text-slate-400">-</span> : u.permissions.map((p) => <Badge key={p} tone="brand">{p}</Badge>)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <Drawer open={selected !== null} onClose={() => setSelected(null)} title={selected?.displayName ?? ''}>
        {selected && (
          <PermissionEditor
            key={selected.id}
            userId={selected.id}
            initial={selected.permissions}
            onSaved={() => {
              holders.reload();
              search.reload();
              setSelected(null);
            }}
          />
        )}
      </Drawer>
    </>
  );
}
