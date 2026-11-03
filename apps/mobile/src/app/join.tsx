import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CircleCheck, QrCode, Send } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { Body, Button, ErrorBanner, Screen, TextField, Title } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-core';
import { parseInviteCode } from '@/lib/invite';

export default function JoinScreen() {
  const { t, tError } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(params.code ?? '');
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scanned = useRef(false);

  async function submit(raw: string) {
    const parsed = parseInviteCode(raw);
    if (!parsed) return setError(t('join.codeInvalid'));
    setError(null);
    setBusy(true);
    try {
      const result = await api.request<{ groupName: string }>('/api/groups/join', { body: { code: parsed } });
      setSentTo(result.groupName);
    } catch (e) {
      setError(tError(e instanceof ApiError ? e.code : 'UNKNOWN'));
    } finally {
      setBusy(false);
      scanned.current = false;
    }
  }

  async function startScan() {
    const granted = permission?.granted ? permission : await requestPermission();
    if (granted.granted) setScanning(true);
  }

  if (sentTo) {
    return (
      <Screen>
        <View className="mt-10 items-center gap-4">
          <CircleCheck size={56} color="#16a34a" />
          <Title>{t('groups.join')}</Title>
          <Body muted>{t('join.sent', { group: sentTo })}</Body>
        </View>
        <View className="mt-auto">
          <Button label={t('common.close')} onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  if (scanning) {
    return (
      <Screen scroll={false}>
        <Title>{t('join.scan')}</Title>
        <Body muted>{t('join.scanHint')}</Body>
        <View className="flex-1 overflow-hidden rounded-3xl">
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (scanned.current) return; // the scanner fires continuously
              scanned.current = true;
              setScanning(false);
              setCode(parseInviteCode(data) ?? '');
              void submit(data);
            }}
          />
        </View>
        <Button label={t('join.stopScan')} variant="secondary" onPress={() => setScanning(false)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View className="gap-2">
        <Title>{t('join.title')}</Title>
        <Body muted>{t('join.subtitle')}</Body>
      </View>
      <ErrorBanner message={error} />
      {permission && !permission.granted && !permission.canAskAgain && <ErrorBanner message={t('join.cameraDenied')} />}
      <TextField label={t('join.code')} value={code} onChangeText={(v) => setCode(v.toUpperCase())} placeholder={t('join.codePlaceholder')} autoCapitalize="characters" autoCorrect={false} maxLength={40} onSubmitEditing={() => void submit(code)} returnKeyType="send" />
      <Button label={t('join.submit')} icon={Send} onPress={() => void submit(code)} loading={busy} disabled={!code.trim()} />
      <Button label={t('join.scan')} icon={QrCode} variant="secondary" onPress={startScan} />
      <Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
