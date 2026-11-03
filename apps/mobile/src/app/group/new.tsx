import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { Body, Button, ErrorBanner, Screen, TextField, Title } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-core';
import type { GroupSummary } from '@/lib/types';

export default function NewGroupScreen() {
  const { t, tError } = useI18n();
  const router = useRouter();
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 60) return setFieldError(t('groupNew.nameInvalid'));
    setFieldError(null);
    setBusy(true);
    try {
      const group = await api.request<GroupSummary>('/api/groups', { body: { name: trimmed } });
      router.replace(`/group/${group.id}`);
    } catch (e) {
      setError(tError(e instanceof ApiError ? e.code : 'UNKNOWN'));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View className="gap-2">
        <Title>{t('groupNew.title')}</Title>
        <Body muted>{t('groupNew.subtitle')}</Body>
      </View>
      <ErrorBanner message={error} />
      <TextField label={t('groupNew.name')} value={name} onChangeText={setName} placeholder={t('groupNew.namePlaceholder')} autoCapitalize="sentences" error={fieldError} maxLength={60} onSubmitEditing={create} returnKeyType="done" />
      <Button label={t('groupNew.create')} icon={Plus} onPress={create} loading={busy} disabled={!name.trim()} />
      <Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
