'use client';
import { Save } from 'lucide-react';
import { useState } from 'react';
import { PERMISSIONS, type Permission } from '@/shared';
import { api, ApiError } from '@/lib/api';
import { useI18n, type Key } from '@/lib/i18n';
import { Button, useToast } from './ui';

const LABELS: Record<Permission, { name: Key; description: Key }> = {
  'palette.manage': { name: 'perm.palette.manage', description: 'perm.palette.manage.desc' },
  'users.manage': { name: 'perm.users.manage', description: 'perm.users.manage.desc' },
  'groups.manage': { name: 'perm.groups.manage', description: 'perm.groups.manage.desc' },
  'storage.manage': { name: 'perm.storage.manage', description: 'perm.storage.manage.desc' },
  'settings.manage': { name: 'perm.settings.manage', description: 'perm.settings.manage.desc' },
  'permissions.manage': { name: 'perm.permissions.manage', description: 'perm.permissions.manage.desc' },
  'audit.view': { name: 'perm.audit.view', description: 'perm.audit.view.desc' },
};

/** Checkbox list of the dynamic permission strings for one user. */
export function PermissionEditor({ userId, initial, onSaved }: { userId: string; initial: string[]; onSaved?: (permissions: string[]) => void }) {
  const { t, tError } = useI18n();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  const [busy, setBusy] = useState(false);
  const dirty = selected.size !== initial.length || initial.some((p) => !selected.has(p));

  async function save() {
    setBusy(true);
    try {
      const result = await api<{ permissions: string[] }>(`/api/admin/users/${userId}/permissions`, { method: 'PUT', body: { permissions: [...selected] } });
      toast('success', t('permissions.saved'));
      onSaved?.(result.permissions);
    } catch (e) {
      toast('error', tError(e instanceof ApiError ? e.code : 'INTERNAL_ERROR'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {PERMISSIONS.map((p) => (
          <li key={p}>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-brand-600"
                checked={selected.has(p)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(p);
                  else next.delete(p);
                  setSelected(next);
                }}
              />
              <span>
                <span className="block text-sm font-medium">{t(LABELS[p].name)}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{t(LABELS[p].description)}</span>
                <code className="text-[11px] text-slate-400">{p}</code>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button onClick={save} loading={busy} disabled={!dirty} icon={<Save className="size-4" aria-hidden />}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
