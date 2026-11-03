import { useRouter } from 'expo-router';
import { Body, Button, Card, Screen, Title } from '@/components/ui';
import { useI18n } from '@/i18n';

export default function PrivacyScreen() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Screen>
      <Title>{t('privacy.title')}</Title>
      <Card>
        <Body>{t('privacy.body')}</Body>
      </Card>
      <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
