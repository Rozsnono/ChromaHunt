import { groupSettingsPatchSchema } from '@chromahunt/shared';
import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useI18n, type Key } from '@/i18n';
import { ApiError } from '@/lib/api-core';
import type { GroupSettings } from '@/lib/types';
import { Button, ErrorBanner, TextField } from './ui';
import { useThemeColors } from '@/lib/theme';

type NumericKey = 'requiredPhotosPerDay' | 'deadlineHours' | 'retentionDays' | 'colorCooldownDays' | 'acceptanceThreshold';
const NUMERIC: { key: NumericKey; label: Key }[] = [
  { key: 'requiredPhotosPerDay', label: 'settings.requiredPhotos' },
  { key: 'deadlineHours', label: 'settings.deadlineHours' },
  { key: 'retentionDays', label: 'settings.retentionDays' },
  { key: 'colorCooldownDays', label: 'settings.cooldownDays' },
  { key: 'acceptanceThreshold', label: 'settings.threshold' },
];

/** Group admin editor: sends only the changed fields; the backend enforces the global limits. */
export function GroupSettingsForm({ values, onSave }: { values: GroupSettings; onSave: (patch: Partial<GroupSettings>) => Promise<void> }) {
  const { t, tError } = useI18n();
  const colors = useThemeColors();
  const [draft, setDraft] = useState({
    requiredPhotosPerDay: String(values.requiredPhotosPerDay),
    deadlineHours: String(values.deadlineHours),
    retentionDays: String(values.retentionDays),
    colorCooldownDays: String(values.colorCooldownDays),
    acceptanceThreshold: String(values.acceptanceThreshold),
    dailyDrawTime: values.dailyDrawTime,
    timezone: values.timezone,
    scoringEnabled: values.scoringEnabled,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const patch: Record<string, unknown> = {};
    for (const { key } of NUMERIC) if (Number(draft[key]) !== values[key]) patch[key] = Number(draft[key]);
    if (draft.dailyDrawTime !== values.dailyDrawTime) patch.dailyDrawTime = draft.dailyDrawTime.trim();
    if (draft.timezone !== values.timezone) patch.timezone = draft.timezone.trim();
    if (draft.scoringEnabled !== values.scoringEnabled) patch.scoringEnabled = draft.scoringEnabled;

    const parsed = groupSettingsPatchSchema.safeParse(patch);
    if (!parsed.success) return setError(tError('VALIDATION_ERROR'));
    setError(null);
    setBusy(true);
    try {
      await onSave(parsed.data);
    } catch (e) {
      setError(tError(e instanceof ApiError ? e.code : 'UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="gap-4">
      <ErrorBanner message={error} />
      {NUMERIC.map(({ key, label }) => (
        <TextField key={key} label={t(label)} value={draft[key]} keyboardType="number-pad" onChangeText={(v) => setDraft({ ...draft, [key]: v.replace(/[^0-9]/g, '') })} />
      ))}
      <TextField label={t('settings.drawTime')} value={draft.dailyDrawTime} placeholder="08:00" onChangeText={(v) => setDraft({ ...draft, dailyDrawTime: v })} maxLength={5} />
      <TextField label={t('settings.timezone')} value={draft.timezone} placeholder="Europe/Budapest" onChangeText={(v) => setDraft({ ...draft, timezone: v })} autoCorrect={false} />
      <View className="min-h-12 flex-row items-center justify-between">
        <Text className="text-base text-slate-800 dark:text-slate-100">{t('settings.scoring')}</Text>
        <Switch value={draft.scoringEnabled} onValueChange={(v) => setDraft({ ...draft, scoringEnabled: v })} trackColor={{ true: colors.brand }} />
      </View>
      <Button label={t('settings.save')} onPress={save} loading={busy} />
    </View>
  );
}
