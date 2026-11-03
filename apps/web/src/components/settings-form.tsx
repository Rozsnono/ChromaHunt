'use client';
/**
 * Editor for the per-group settings. It is used both for the global defaults and for a group
 * override: the form starts from the effective values and sends only the fields that changed.
 */
import { Save } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { GroupSettings, GroupSettingsPatch } from '@chromahunt/shared';
import { useI18n, type Key } from '@/lib/i18n';
import { Button, TextInput, Toggle } from './ui';

type NumberField = { key: keyof GroupSettings; kind: 'number'; min: number; max: number; label: Key; hint?: Key };
type TextField = { key: keyof GroupSettings; kind: 'time' | 'timezone'; label: Key; hint?: Key };
type BoolField = { key: keyof GroupSettings; kind: 'bool'; label: Key };
type Field = NumberField | TextField | BoolField;

const FIELDS: Field[] = [
  { key: 'requiredPhotosPerDay', kind: 'number', min: 1, max: 10, label: 'settings.requiredPhotos' },
  { key: 'dailyDrawTime', kind: 'time', label: 'settings.drawTime', hint: 'settings.drawTimeHint' },
  { key: 'timezone', kind: 'timezone', label: 'settings.timezone' },
  { key: 'deadlineHours', kind: 'number', min: 1, max: 24, label: 'settings.deadlineHours', hint: 'settings.deadlineHint' },
  { key: 'retentionDays', kind: 'number', min: 1, max: 365, label: 'settings.retentionDays' },
  { key: 'colorCooldownDays', kind: 'number', min: 0, max: 30, label: 'settings.cooldownDays', hint: 'settings.cooldownHint' },
  { key: 'acceptanceThreshold', kind: 'number', min: 0, max: 100, label: 'settings.threshold', hint: 'settings.thresholdHint' },
  { key: 'missingPhotoPenalty', kind: 'number', min: 0, max: 100, label: 'settings.penalty' },
  { key: 'minDailyPoints', kind: 'number', min: -100, max: 0, label: 'settings.minPoints' },
  { key: 'deadlineReminderHours', kind: 'number', min: 0, max: 12, label: 'settings.reminderHours', hint: 'settings.reminderHint' },
  { key: 'scoringEnabled', kind: 'bool', label: 'settings.scoring' },
  { key: 'notifyDailyColor', kind: 'bool', label: 'settings.notifyColor' },
  { key: 'notifyDeadline', kind: 'bool', label: 'settings.notifyDeadline' },
];

export function SettingsForm({
  values,
  onSave,
  disabled,
}: {
  values: GroupSettings;
  onSave: (patch: GroupSettingsPatch) => Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<GroupSettings>(values);
  const [busy, setBusy] = useState(false);
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
    } catch {
      return ['Europe/Budapest', 'UTC'];
    }
  }, []);

  const changed = FIELDS.filter((f) => draft[f.key] !== values[f.key]);

  async function save() {
    setBusy(true);
    const patch: Record<string, unknown> = {};
    for (const f of changed) patch[f.key] = draft[f.key];
    try {
      await onSave(patch as GroupSettingsPatch);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.filter((f) => f.kind !== 'bool').map((f) => (
          <TextInput
            key={f.key}
            label={t(f.label)}
            hint={f.hint ? t(f.hint) : undefined}
            disabled={disabled}
            list={f.kind === 'timezone' ? 'zones' : undefined}
            type={f.kind === 'number' ? 'number' : f.kind === 'time' ? 'time' : 'text'}
            inputMode={f.kind === 'number' ? 'numeric' : undefined}
            min={f.kind === 'number' ? f.min : undefined}
            max={f.kind === 'number' ? f.max : undefined}
            value={String(draft[f.key])}
            onChange={(e) => setDraft({ ...draft, [f.key]: f.kind === 'number' ? Number(e.target.value) : e.target.value })}
          />
        ))}
        <datalist id="zones">
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </div>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 px-4 dark:divide-slate-800 dark:border-slate-800">
        {FIELDS.filter((f): f is BoolField => f.kind === 'bool').map((f) => (
          <Toggle key={f.key} label={t(f.label)} disabled={disabled} checked={Boolean(draft[f.key])} onChange={(v) => setDraft({ ...draft, [f.key]: v })} />
        ))}
      </div>
      <div className="flex items-center justify-end gap-3">
        {changed.length > 0 && <span className="text-xs text-slate-500">{t('settings.unsaved', { count: changed.length })}</span>}
        <Button onClick={save} loading={busy} disabled={disabled || changed.length === 0} icon={<Save className="size-4" aria-hidden />}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
