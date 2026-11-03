'use client';
import { Save } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_GROUP_SETTINGS, type GroupSettings, type GroupSettingsPatch } from '@/shared';
import { SettingsForm } from '@/components/settings-form';
import { Button, Card, ErrorNotice, PageHeader, Spinner, TextInput, Toggle, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/use-api';

interface GlobalSettingsView {
  defaults: GroupSettingsPatch;
  minAcceptanceThreshold: number;
  maxRetentionDays: number;
  storageQuotaBytes: number;
  registrationOpen: boolean;
}

const MB = 1024 * 1024;

/** Global limits form. Mounted with `key` so it re-initialises from the saved values after a save. */
function LimitsForm({ data, onSave }: { data: GlobalSettingsView; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const { t } = useI18n();
  const [limits, setLimits] = useState({
    min: data.minAcceptanceThreshold,
    maxRetention: data.maxRetentionDays,
    quotaMb: Math.round(data.storageQuotaBytes / MB),
    open: data.registrationOpen,
  });
  const [saving, setSaving] = useState(false);

  return (
    <Card className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">{t('settings.limits')}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('settings.limitsHint')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextInput label={t('settings.minThreshold')} type="number" min={0} max={100} value={limits.min} onChange={(e) => setLimits({ ...limits, min: Number(e.target.value) })} />
        <TextInput label={t('settings.maxRetention')} type="number" min={1} max={3650} value={limits.maxRetention} onChange={(e) => setLimits({ ...limits, maxRetention: Number(e.target.value) })} />
        <TextInput label={t('settings.quotaMb')} hint={t('settings.quotaHint')} type="number" min={0} value={limits.quotaMb} onChange={(e) => setLimits({ ...limits, quotaMb: Number(e.target.value) })} />
      </div>
      <div className="rounded-lg border border-slate-200 px-4 dark:border-slate-800">
        <Toggle label={t('settings.registrationOpen')} checked={limits.open} onChange={(v) => setLimits({ ...limits, open: v })} />
      </div>
      <div className="flex justify-end">
        <Button
          loading={saving}
          icon={<Save className="size-4" aria-hidden />}
          onClick={async () => {
            setSaving(true);
            await onSave({
              minAcceptanceThreshold: limits.min,
              maxRetentionDays: limits.maxRetention,
              storageQuotaBytes: Math.round(limits.quotaMb * MB),
              registrationOpen: limits.open,
            }).catch(() => undefined);
            setSaving(false);
          }}
        >
          {t('common.save')}
        </Button>
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const { t, tError } = useI18n();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<GlobalSettingsView>('/api/admin/settings');

  async function patch(body: Record<string, unknown>) {
    try {
      await api('/api/admin/settings', { method: 'PATCH', body });
      toast('success', t('common.saved'));
      reload();
    } catch (e) {
      toast('error', tError(e instanceof ApiError ? e.code : 'INTERNAL_ERROR'));
      throw e;
    }
  }

  const effective: GroupSettings = { ...DEFAULT_GROUP_SETTINGS, ...(data?.defaults ?? {}) };

  return (
    <>
      <PageHeader title={t('nav.settings')} subtitle={t('settings.subtitle')} />
      {error && <ErrorNotice code={error.code} onRetry={reload} />}
      {loading && !data && <Spinner />}
      {data && (
        <div className="space-y-6">
          <LimitsForm key={JSON.stringify(data)} data={data} onSave={patch} />

          <Card className="space-y-5">
            <div>
              <h2 className="text-base font-semibold">{t('settings.defaults')}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('settings.defaultsHint')}</p>
            </div>
            <SettingsForm key={JSON.stringify(effective)} values={effective} onSave={(p) => patch({ defaults: p })} />
          </Card>
        </div>
      )}
    </>
  );
}
