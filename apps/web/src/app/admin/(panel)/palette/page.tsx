'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorNotice, Modal, PageHeader, Spinner, Swatch, TextInput, Toggle, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/use-api';

interface Color {
  id: string;
  name: string;
  hex: string;
  lab: [number, number, number];
  isActive: boolean;
}

export default function PalettePage() {
  const { t, tError } = useI18n();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Color[]>('/api/admin/palette');
  const [editing, setEditing] = useState<Partial<Color> | null>(null);
  const [deleting, setDeleting] = useState<Color | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast('success', success);
      setEditing(null);
      setDeleting(null);
      reload();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'INTERNAL_ERROR';
      toast('error', e instanceof ApiError && e.details.reason === 'COLOR_IN_USE' ? t('palette.inUse') : tError(code));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (c: Color) => run(() => api(`/api/admin/palette/${c.id}`, { method: 'PATCH', body: { isActive: !c.isActive } }), t('common.saved'));
  const active = data?.filter((c) => c.isActive).length ?? 0;

  return (
    <>
      <PageHeader
        title={t('nav.palette')}
        subtitle={t('palette.subtitle', { active, total: data?.length ?? 0 })}
        actions={
          <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setEditing({ name: '', hex: '#6366f1', isActive: true })}>
            {t('palette.add')}
          </Button>
        }
      />
      {error && <ErrorNotice code={error.code} onRetry={reload} />}
      {loading && !data && <Spinner />}
      {data && data.length === 0 && <EmptyState title={t('palette.empty')} />}
      {data && data.length > 0 && active === 0 && <div className="mb-4"><ErrorNotice code="NO_ACTIVE_COLORS" /></div>}
      <motion.ul layout className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence>
          {data?.map((c) => (
            <motion.li key={c.id} layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
              <Card className={c.isActive ? '' : 'opacity-60'}>
                <div className="flex items-center gap-4">
                  <Swatch hex={c.hex} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="font-mono text-xs text-slate-500">{c.hex}</p>
                    <p className="text-[11px] text-slate-400">Lab {c.lab.map((v) => v.toFixed(0)).join(' / ')}</p>
                  </div>
                  <Badge tone={c.isActive ? 'green' : 'slate'}>{c.isActive ? t('common.active') : t('common.inactive')}</Badge>
                </div>
                <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <div className="w-36">
                    <Toggle label={t('palette.active')} checked={c.isActive} onChange={() => toggle(c)} />
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing(c)}>
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button variant="ghost" aria-label={t('common.delete')} onClick={() => setDeleting(c)}>
                      <Trash2 className="size-4 text-red-500" aria-hidden />
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.li>
          ))}
        </AnimatePresence>
      </motion.ul>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? t('palette.edit') : t('palette.add')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={busy}
              onClick={() =>
                editing &&
                run(
                  () =>
                    editing.id
                      ? api(`/api/admin/palette/${editing.id}`, { method: 'PATCH', body: { name: editing.name, hex: editing.hex?.toLowerCase(), isActive: editing.isActive } })
                      : api('/api/admin/palette', { body: { name: editing.name, hex: editing.hex?.toLowerCase(), isActive: editing.isActive ?? true } }),
                  t('common.saved'),
                )
              }
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <TextInput label={t('palette.name')} value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={40} />
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <TextInput label="HEX" value={editing.hex ?? ''} onChange={(e) => setEditing({ ...editing, hex: e.target.value })} placeholder="#rrggbb" maxLength={7} />
              </div>
              <input
                type="color"
                aria-label={t('palette.pick')}
                className="h-10 w-14 cursor-pointer rounded-lg border border-slate-300 bg-transparent p-1 dark:border-slate-700"
                value={/^#[0-9a-fA-F]{6}$/.test(editing.hex ?? '') ? (editing.hex as string) : '#000000'}
                onChange={(e) => setEditing({ ...editing, hex: e.target.value })}
              />
            </div>
            <Toggle label={t('palette.active')} checked={editing.isActive ?? true} onChange={(v) => setEditing({ ...editing, isActive: v })} />
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        busy={busy}
        danger
        title={t('palette.deleteTitle')}
        message={t('palette.deleteMessage', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        onConfirm={() => deleting && run(() => api(`/api/admin/palette/${deleting.id}`, { method: 'DELETE' }), t('palette.deleted'))}
      />
    </>
  );
}
