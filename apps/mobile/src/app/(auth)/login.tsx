import { Link } from 'expo-router';
import { Fingerprint, LogIn, Palette } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Body, Button, ErrorBanner, Screen, TextField, Title } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api-core';
import { useSession } from '@/lib/session';
import { isEmail } from '@/lib/validation';

export default function LoginScreen() {
  const { t, tError } = useI18n();
  const { login, loginWithBiometrics, biometricReady } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const triedBiometric = useRef(false);

  const fail = (e: unknown) => setError(tError(e instanceof ApiError ? e.code : 'UNKNOWN'));

  async function submit() {
    setError(null);
    if (!isEmail(email)) return setEmailError(t('auth.emailInvalid'));
    setEmailError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  }

  async function biometric() {
    setError(null);
    setBusy(true);
    try {
      await loginWithBiometrics();
    } catch (e) {
      // A cancelled prompt is silent; anything else tells the user to use the password.
      if (e instanceof ApiError && e.code === 'BIOMETRIC_UNAVAILABLE') setBusy(false);
      else {
        setError(e instanceof ApiError && e.status !== 401 ? tError(e.code) : t('biometric.failed'));
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    if (biometricReady && !triedBiometric.current) {
      triedBiometric.current = true;
      void biometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometricReady]);

  return (
    <Screen>
      <View className="mt-6 gap-3">
        <View className="size-16 items-center justify-center rounded-3xl bg-brand-600">
          <Palette size={32} color="#fff" />
        </View>
        <Title>{t('auth.title')}</Title>
        <Body muted>{t('auth.subtitle')}</Body>
      </View>

      <View className="mt-4 gap-4">
        <ErrorBanner message={error} />
        <TextField label={t('auth.email')} value={email} onChangeText={setEmail} error={emailError} placeholder={t('auth.emailPlaceholder')} keyboardType="email-address" autoComplete="email" textContentType="username" />
        <TextField label={t('auth.password')} value={password} onChangeText={setPassword} secure autoComplete="current-password" textContentType="password" onSubmitEditing={submit} returnKeyType="go" />
        <Button label={t('auth.login')} icon={LogIn} onPress={submit} loading={busy} disabled={!email || !password} />
        {biometricReady && <Button label={t('auth.loginBiometric')} icon={Fingerprint} variant="secondary" onPress={biometric} disabled={busy} />}
      </View>

      <View className="mt-auto flex-row items-center justify-center gap-2 pt-6">
        <Text className="text-base text-slate-500 dark:text-slate-400">{t('auth.noAccount')}</Text>
        <Link href="/register" className="text-base font-medium text-brand-600 dark:text-brand-400">
          {t('auth.goRegister')}
        </Link>
      </View>
    </Screen>
  );
}
