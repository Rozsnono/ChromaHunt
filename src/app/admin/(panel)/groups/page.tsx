'use client';
import { Archive, ArchiveRestore, Crown, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { SettingsForm } from '@/components/settings-form';
import {
  Badge, Button, Card, ConfirmModal, Drawer, EmptyState, ErrorNotice, PageHeader, Pagination, SearchInput, SelectInput,
  Spinner, Swatch, TableWrap, td, th, useToast,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/use-api';
import type { GroupSettings, GroupSettingsPatch } from '@/shared';

interface Row {
  id: string;
  name: string;
  isArchived: boolean;
  memberCount: number;
  createdAt: string;
}
interface List {
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
}
interface Detail {
  id: string;
  name: string;
  isArchived: boolean;
  archivedReason: string | null;
  settings: GroupSettings;
  members: Array<{ userId: string; displayName: string; email: string; role: 'admin' | 'member'; joinedAt: string }>;
  recentAssignments: Array<{ date: string; colorHex: string; colorName: string; deadlineAt: string; cooldownRelaxed: boolean }>;
}
interface Ranking {
  enabled: boolean;
  week: string;
  finalized: boolean;
  entries: Array<{ rank: number; userId: string; displayName: string; points: number; daysCompleted: number }>;
}
interface Photo {
  id: string;
  displayName: string;
  date: string;
  colorHex: string;
  closenessScore: number;
  uploadedAt: string;
}

export default function GroupsPageView() {
  const { t, formatDate } = useI18n();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [archived, setArchived] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const qs = new URLSearchParams({ page: String(page), ...(q ? { q } : {}), ...(archived ? { archived } : {}) });
  const list = useApi<List>(`/api/admin/groups?${qs}`);

  return (
    <>
      <PageHeader title={t('nav.groups')} subtitle={t('groups.subtitle')} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SearchInput placeholder={t('groups.search')} aria-label={t('groups.search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <div className="w-44">
          <SelectInput label={t('groups.filter')} value={archived} onChange={(e) => { setArchived(e.target.value); setPage(1); }}>
            <option value="">{t('groups.all')}</option>
            <option value="false">{t('common.active')}</option>
            <option value="true">{t('groups.archivedBadge')}</option>
          </SelectInput>
        </div>
      </div>
      {list.error && <ErrorNotice code={list.error.code} onRetry={list.reload} />}
      {list.loading && !list.data && <Spinner />}
      {list.data && list.data.items.length === 0 && <EmptyState title={t('common.noResults')} />}
      {list.data && list.data.items.length > 0 && (
        <>
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>{t('groups.name')}</th>
                <th className={th}>{t('groups.members')}</th>
                <th className={th}>{t('users.status')}</th>
                <th className={th}>{t('groups.created')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((g) => (
                <tr key={g.id} tabIndex={0} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => setSelected(g.id)} onKeyDown={(e) => e.key === 'Enter' && setSelected(g.id)}>
                  <td className={`${td} font-medium`}>{g.name}</td>
                  <td className={`${td} tabular-nums`}>{g.memberCount}</td>
                  <td className={td}><Badge tone={g.isArchived ? 'amber' : 'green'}>{g.isArchived ? t('groups.archivedBadge') : t('common.active')}</Badge></td>
                  <td className={`${td} whitespace-nowrap text-xs text-slate-500`}>{formatDate(g.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </>
      )}
      <GroupDrawer groupId={selected} onClose={() => setSelected(null)} onChanged={list.reload} />
    </>
  );
}

function GroupDrawer({ groupId, onClose, onChanged }: { groupId: string | null; onClose: () => void; onChanged: () => void }) {
  const { t, tError, formatDate } = useI18n();
  const toast = useToast();
  const detail = useApi<Detail>(groupId ? `/api/admin/groups/${groupId}` : null);
  const ranking = useApi<Ranking>(groupId ? `/api/admin/groups/${groupId}/ranking` : null);
  const photos = useApi<Photo[]>(groupId ? `/api/admin/groups/${groupId}/submissions` : null);
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [newAdmin, setNewAdmin] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState<Photo | null>(null);
  const g = detail.data;

  async function act(fn: () => Promise<unknown>, ok = t('common.saved')) {
    setBusy(true);
    try {
      await fn();
      toast('success', ok);
      detail.reload();
      photos.reload();
      ranking.reload();
      onChanged();
    } catch (e) {
      toast('error', tError(e instanceof ApiError ? e.code : 'INTERNAL_ERROR'));
      throw e;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Drawer open={groupId !== null} onClose={onClose} title={g?.name ?? t('nav.groups')}>
        {detail.error && <ErrorNotice code={detail.error.code} onRetry={detail.reload} />}
        {detail.loading && !g && <Spinner />}
        {g && (
          <>
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge tone={g.isArchived ? 'amber' : 'green'}>{g.isArchived ? t('groups.archivedBadge') : t('common.active')}</Badge>
                {g.archivedReason && <span className="text-xs text-slate-500">{g.archivedReason}</span>}
              </div>
              <Button variant="secondary" icon={g.isArchived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />} onClick={() => (g.isArchived ? act(() => api(`/api/admin/groups/${g.id}/archive`, { body: { archived: false } })).catch(() => undefined) : setConfirmArchive(true))}>
                {g.isArchived ? t('groups.restore') : t('groups.archive')}
              </Button>
            </Card>

            <Card>
              <h3 className="mb-3 text-sm font-semibold">{t('groups.members')} ({g.members.length})</h3>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {g.members.map((m) => (
                  <li key={m.userId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="font-medium">{m.displayName}</span>
                    <span className="text-xs text-slate-500">{m.email}</span>
                    {m.role === 'admin' ? (
                      <Badge tone="brand"><Crown className="mr-1 size-3" aria-hidden />admin</Badge>
                    ) : (
                      <Button variant="ghost" className="ml-auto min-h-8 px-2 py-1 text-xs" onClick={() => setNewAdmin(m.userId)}>{t('groups.makeAdmin')}</Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <h3 className="mb-3 text-sm font-semibold">{t('groups.recentColors')}</h3>
              {g.recentAssignments.length === 0 ? (
                <p className="text-sm text-slate-500">{t('groups.noDraws')}</p>
              ) : (
                <ul className="flex flex-wrap gap-3">
                  {g.recentAssignments.map((a) => (
                    <li key={a.date} className="flex flex-col items-center gap-1 text-[11px] text-slate-500" title={`${a.colorName} · ${formatDate(a.deadlineAt)}`}>
                      <Swatch hex={a.colorHex} size="lg" />
                      {a.date.slice(5)}
                      {a.cooldownRelaxed && <Badge tone="amber">!</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <h3 className="mb-3 text-sm font-semibold">{t('groups.ranking')}</h3>
              {ranking.data && !ranking.data.enabled && <p className="text-sm text-slate-500">{t('groups.scoringOff')}</p>}
              {ranking.data?.enabled && (
                <>
                  <p className="mb-2 text-xs text-slate-500">{ranking.data.week} · {ranking.data.finalized ? t('groups.final') : t('groups.live')}</p>
                  <ol className="space-y-1 text-sm">
                    {ranking.data.entries.map((e) => (
                      <li key={e.userId} className="flex items-center gap-3">
                        <span className="w-6 text-right tabular-nums text-slate-400">{e.rank}.</span>
                        <span className="flex-1">{e.displayName}</span>
                        <span className="tabular-nums font-medium">{e.points}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </Card>

            <Card>
              <h3 className="mb-3 text-sm font-semibold">{t('groups.photos')}</h3>
              {photos.data?.length === 0 && <p className="text-sm text-slate-500">{t('groups.noPhotos')}</p>}
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.data?.map((p) => (
                  <li key={p.id} className="group relative overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/admin/submissions/${p.id}/image`} alt={`${p.displayName} ${p.date}`} loading="lazy" className="aspect-square w-full object-cover" />
                    <div className="flex items-center justify-between gap-1 p-2 text-[11px]">
                      <span className="truncate">{p.displayName}</span>
                      <Swatch hex={p.colorHex} size="sm" />
                    </div>
                    <button aria-label={t('groups.removePhoto')} onClick={() => setRemovePhoto(p)} className="absolute top-1.5 right-1.5 rounded-md bg-red-600 p-1.5 text-white opacity-0 shadow transition-opacity group-hover:opacity-100 focus:opacity-100">
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <h3 className="mb-1 text-sm font-semibold">{t('groups.settings')}</h3>
              <p className="mb-4 text-xs text-slate-500">{t('groups.settingsHint')}</p>
              <SettingsForm key={JSON.stringify(g.settings)} values={g.settings} onSave={(patch: GroupSettingsPatch) => act(() => api(`/api/admin/groups/${g.id}/settings`, { method: 'PATCH', body: patch }))} />
            </Card>
          </>
        )}
      </Drawer>

      <ConfirmModal open={confirmArchive} onClose={() => setConfirmArchive(false)} busy={busy} title={t('groups.archive')} message={t('groups.archiveConfirm')} confirmLabel={t('groups.archive')} danger
        onConfirm={() => g && act(() => api(`/api/admin/groups/${g.id}/archive`, { body: { archived: true } })).then(() => setConfirmArchive(false)).catch(() => undefined)} />
      <ConfirmModal open={newAdmin !== null} onClose={() => setNewAdmin(null)} busy={busy} title={t('groups.makeAdmin')} message={t('groups.reassignConfirm')} confirmLabel={t('common.confirm')}
        onConfirm={() => g && newAdmin && act(() => api(`/api/admin/groups/${g.id}/reassign-admin`, { body: { userId: newAdmin } })).then(() => setNewAdmin(null)).catch(() => undefined)} />
      <ConfirmModal open={removePhoto !== null} onClose={() => setRemovePhoto(null)} busy={busy} danger title={t('groups.removePhoto')} message={t('groups.removePhotoConfirm')} confirmLabel={t('common.delete')}
        onConfirm={() => removePhoto && act(() => api(`/api/admin/submissions/${removePhoto.id}`, { method: 'DELETE' })).then(() => setRemovePhoto(null)).catch(() => undefined)} />
    </>
  );
}
