'use client';
import { Copy, KeyRound, Trash2, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import { PermissionEditor } from '@/components/permission-editor';
import {
  Badge, Button, Card, ConfirmModal, Drawer, EmptyState, ErrorNotice, Modal, PageHeader, Pagination, SearchInput,
  Spinner, TableWrap, TextInput, td, th, useToast,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/use-api';

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  permissions: string[];
  isDisabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}
interface UsersPage {
  items: UserRow[];
  total: number;
  page: number;
  pageSize: number;
}
interface UserDetail extends UserRow {
  locale: string;
  privacyPolicyVersion: string;
  termsAcceptedAt: string;
  acceptedPhotos: number;
  activeSessions: number;
  groups: Array<{ id: string; name: string; role: string; isArchived: boolean }>;
}

export default function UsersPageView() {
  const { t, tError, formatDate } = useI18n();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useApi<UsersPage>(`/api/admin/users?${new URLSearchParams({ page: String(page), ...(q ? { q } : {}) })}`);

  return (
    <>
      <PageHeader title={t('nav.users')} subtitle={t('users.subtitle')} />
      <div className="mb-4">
        <SearchInput placeholder={t('users.search')} aria-label={t('users.search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>
      {list.error && <ErrorNotice code={list.error.code} onRetry={list.reload} />}
      {list.loading && !list.data && <Spinner />}
      {list.data && list.data.items.length === 0 && <EmptyState title={t('common.noResults')} />}
      {list.data && list.data.items.length > 0 && (
        <>
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>{t('users.name')}</th>
                <th className={th}>E-mail</th>
                <th className={th}>{t('users.status')}</th>
                <th className={th}>{t('users.registered')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((u) => (
                <tr key={u.id} tabIndex={0} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => setSelected(u.id)} onKeyDown={(e) => e.key === 'Enter' && setSelected(u.id)}>
                  <td className={`${td} font-medium`}>{u.displayName}</td>
                  <td className={td}>{u.email}</td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={u.isDisabled ? 'red' : 'green'}>{u.isDisabled ? t('users.disabled') : t('common.active')}</Badge>
                      {u.permissions.length > 0 && <Badge tone="brand">{t('users.permCount', { count: u.permissions.length })}</Badge>}
                      {u.mustChangePassword && <Badge tone="amber">{t('users.mustChange')}</Badge>}
                    </div>
                  </td>
                  <td className={`${td} whitespace-nowrap text-xs text-slate-500`}>{formatDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </>
      )}
      <UserDrawer userId={selected} onClose={() => setSelected(null)} onChanged={list.reload} toast={toast} t={t} tError={tError} />
    </>
  );
}

function UserDrawer({ userId, onClose, onChanged, toast, t, tError }: {
  userId: string | null;
  onClose: () => void;
  onChanged: () => void;
  toast: ReturnType<typeof useToast>;
  t: ReturnType<typeof useI18n>['t'];
  tError: ReturnType<typeof useI18n>['tError'];
}) {
  const { formatDate } = useI18n();
  const detail = useApi<UserDetail>(userId ? `/api/admin/users/${userId}` : null);
  const [busy, setBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState('');
  const u = detail.data;

  async function act(fn: () => Promise<unknown>, ok: string, after?: () => void) {
    setBusy(true);
    try {
      await fn();
      toast('success', ok);
      after?.();
      detail.reload();
      onChanged();
    } catch (e) {
      toast('error', tError(e instanceof ApiError ? e.code : 'INTERNAL_ERROR'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Drawer open={userId !== null} onClose={onClose} title={u?.displayName ?? t('nav.users')}>
        {detail.error && <ErrorNotice code={detail.error.code} onRetry={detail.reload} />}
        {detail.loading && !u && <Spinner />}
        {u && (
          <>
            <Card className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{u.email}</span>
                <Badge tone={u.isDisabled ? 'red' : 'green'}>{u.isDisabled ? t('users.disabled') : t('common.active')}</Badge>
                {u.mustChangePassword && <Badge tone="amber">{t('users.mustChange')}</Badge>}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-600 dark:text-slate-300">
                <dt>{t('users.registered')}</dt><dd>{formatDate(u.createdAt)}</dd>
                <dt>{t('users.privacy')}</dt><dd>v{u.privacyPolicyVersion} · {formatDate(u.termsAcceptedAt)}</dd>
                <dt>{t('users.photos')}</dt><dd>{u.acceptedPhotos}</dd>
                <dt>{t('users.sessions')}</dt><dd>{u.activeSessions}</dd>
                <dt>{t('users.locale')}</dt><dd>{u.locale}</dd>
              </dl>
            </Card>

            <Card>
              <h3 className="mb-2 text-sm font-semibold">{t('nav.groups')}</h3>
              {u.groups.length === 0 ? (
                <p className="text-sm text-slate-500">{t('users.noGroups')}</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {u.groups.map((g) => (
                    <li key={g.id} className="flex items-center gap-2">
                      <span>{g.name}</span>
                      <Badge tone={g.role === 'admin' ? 'brand' : 'slate'}>{g.role}</Badge>
                      {g.isArchived && <Badge tone="amber">{t('groups.archivedBadge')}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <h3 className="mb-3 text-sm font-semibold">{t('nav.permissions')}</h3>
              <PermissionEditor key={`${u.id}-${u.permissions.join()}`} userId={u.id} initial={u.permissions} onSaved={() => { detail.reload(); onChanged(); }} />
            </Card>

            <Card className="space-y-3">
              <h3 className="text-sm font-semibold">{t('users.actions')}</h3>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  loading={busy}
                  icon={u.isDisabled ? <UserCheck className="size-4" aria-hidden /> : <UserX className="size-4" aria-hidden />}
                  onClick={() => act(() => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { isDisabled: !u.isDisabled } }), t('common.saved'))}
                >
                  {u.isDisabled ? t('users.enable') : t('users.disable')}
                </Button>
                <Button variant="secondary" icon={<KeyRound className="size-4" aria-hidden />} onClick={() => setConfirmReset(true)}>
                  {t('users.resetPassword')}
                </Button>
                <Button variant="danger" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => { setTyped(''); setDeleting(true); }}>
                  {t('users.delete')}
                </Button>
              </div>
            </Card>
          </>
        )}
      </Drawer>

      <ConfirmModal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        busy={busy}
        title={t('users.resetPassword')}
        message={t('users.resetConfirm')}
        confirmLabel={t('users.resetPassword')}
        onConfirm={() =>
          u &&
          act(
            async () => {
              const r = await api<{ temporaryPassword: string }>(`/api/admin/users/${u.id}/reset-password`, { method: 'POST', body: {} });
              setTempPassword(r.temporaryPassword);
            },
            t('users.resetDone'),
            () => setConfirmReset(false),
          )
        }
      />

      <Modal open={tempPassword !== null} onClose={() => setTempPassword(null)} title={t('users.tempPassword')} footer={<Button onClick={() => setTempPassword(null)}>{t('common.close')}</Button>}>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('users.tempPasswordHint')}</p>
        <div className="flex items-center gap-2 rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
          <code className="flex-1 break-all font-mono text-base select-all">{tempPassword}</code>
          <Button variant="ghost" aria-label={t('common.copy')} onClick={() => tempPassword && navigator.clipboard?.writeText(tempPassword).then(() => toast('info', t('common.copied')))}>
            <Copy className="size-4" aria-hidden />
          </Button>
        </div>
      </Modal>

      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title={t('users.delete')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={!u || typed !== u.email}
              onClick={() => u && act(() => api(`/api/admin/users/${u.id}`, { method: 'DELETE' }), t('users.deleted'), () => { setDeleting(false); onClose(); })}
            >
              {t('users.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('users.deleteWarning')}</p>
        <TextInput label={t('users.typeEmail', { email: u?.email ?? '' })} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </Modal>
    </>
  );
}
