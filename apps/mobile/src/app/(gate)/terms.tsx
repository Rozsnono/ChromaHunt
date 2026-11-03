import { ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { Body, Button, Card, ErrorBanner, Screen, Title } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api-core';
import { useSession } from '@/lib/session';

export default function TermsScreen() {
  const { t, tError } = useI18n();
  const { acceptTerms, logout } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await acceptTerms();
    } catch (e) {
      setError(tError(e instanceof ApiError ? e.code : 'UNKNOWN'));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View className="mt-4 gap-2">
        <Title>{t('gate.terms.title')}</Title>
        <Body muted>{t('gate.terms.subtitle')}</Body>
      </View>
      <ErrorBanner message={error} />
      <Card>
        <Body>{t('privacy.body')}</Body>
      </Card>
      <Button label={t('gate.terms.accept')} icon={ShieldCheck} onPress={accept} loading={busy} />
      <Button label={t('gate.terms.logout')} variant="ghost" onPress={() => void logout()} />
    </Screen>
  );
}
