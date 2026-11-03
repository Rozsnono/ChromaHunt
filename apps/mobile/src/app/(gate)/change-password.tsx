import { KeyRound } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { Body, Button, ErrorBanner, Screen, TextField, Title } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api-core';
import { useSession } from '@/lib/session';
import { isValidPassword } from '@/lib/validation';

export default function ChangePasswordScreen() {
  const { t, tError } = useI18n();
  const { changePassword, logout } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (!isValidPassword(next)) return setFieldError(t('auth.passwordRules'));
    setFieldError(null);
    setBusy(true);
    try {
      await changePassword(current, next);
    } catch (e) {
      setError(tError(e instanceof ApiError ? e.code : 'UNKNOWN'));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View className="mt-4 gap-2">
        <Title>{t('gate.change.title')}</Title>
        <Body muted>{t('gate.change.subtitle')}</Body>
      </View>
      <ErrorBanner message={error} />
      <TextField label={t('gate.change.current')} value={current} onChangeText={setCurrent} secure autoComplete="current-password" />
      <TextField label={t('gate.change.new')} value={next} onChangeText={setNext} secure autoComplete="new-password" error={fieldError} hint={t('auth.passwordHint')} />
      <Button label={t('gate.change.submit')} icon={KeyRound} onPress={submit} loading={busy} disabled={!current || !next} />
      <Button label={t('profile.logout')} variant="ghost" onPress={() => void logout()} />
    </Screen>
  );
}
