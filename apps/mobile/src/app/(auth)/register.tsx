import { Link, useRouter } from 'expo-router';
import { Check, UserPlus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Body, Button, ErrorBanner, Screen, TextField, Title } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api-core';
import { useSession } from '@/lib/session';
import { isEmail, isValidDisplayName, isValidPassword } from '@/lib/validation';

export default function RegisterScreen() {
  const { t, tError } = useI18n();
  const router = useRouter();
  const { register } = useSession();
  const [form, setForm] = useState({ email: '', password: '', displayName: '' });
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<'email' | 'password' | 'displayName' | 'privacy', string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const next: typeof errors = {};
    if (!isEmail(form.email)) next.email = t('auth.emailInvalid');
    if (!isValidPassword(form.password)) next.password = t('auth.passwordRules');
    if (!isValidDisplayName(form.displayName)) next.displayName = t('auth.nameInvalid');
    if (!accepted) next.privacy = t('auth.privacyRequired');
    setErrors(next);
    setError(null);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      await register({ email: form.email.trim(), password: form.password, displayName: form.displayName.trim() });
    } catch (e) {
      setError(tError(e instanceof ApiError ? e.code : 'UNKNOWN'));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View className="mt-4 gap-2">
        <Title>{t('auth.goRegister')}</Title>
        <Body muted>{t('auth.subtitle')}</Body>
      </View>
      <View className="gap-4">
        <ErrorBanner message={error} />
        <TextField label={t('auth.displayName')} value={form.displayName} onChangeText={(displayName) => setForm({ ...form, displayName })} error={errors.displayName} placeholder={t('auth.displayNamePlaceholder')} autoCapitalize="words" autoComplete="name" />
        <TextField label={t('auth.email')} value={form.email} onChangeText={(email) => setForm({ ...form, email })} error={errors.email} placeholder={t('auth.emailPlaceholder')} keyboardType="email-address" autoComplete="email" textContentType="username" />
        <TextField label={t('auth.password')} value={form.password} onChangeText={(password) => setForm({ ...form, password })} error={errors.password} hint={t('auth.passwordHint')} secure autoComplete="new-password" textContentType="newPassword" />

        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} onPress={() => setAccepted(!accepted)} className="flex-row items-start gap-3">
          <View className={`mt-0.5 size-6 items-center justify-center rounded-lg border ${accepted ? 'border-brand-600 bg-brand-600' : 'border-slate-400 dark:border-slate-500'}`}>
            {accepted && <Check size={16} color="#fff" />}
          </View>
          <Text className="flex-1 text-base leading-6 text-slate-700 dark:text-slate-200">{t('auth.acceptPrivacy')}</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => router.push('/privacy')}>
          <Text className="text-base font-medium text-brand-600 dark:text-brand-400">{t('auth.readPrivacy')}</Text>
        </Pressable>
        {errors.privacy && <Text className="text-sm text-red-600 dark:text-red-400">{errors.privacy}</Text>}

        <Button label={t('auth.register')} icon={UserPlus} onPress={submit} loading={busy} />
      </View>
      <View className="mt-auto flex-row items-center justify-center gap-2 pt-6">
        <Text className="text-base text-slate-500 dark:text-slate-400">{t('auth.haveAccount')}</Text>
        <Link href="/login" replace className="text-base font-medium text-brand-600 dark:text-brand-400">
          {t('auth.goLogin')}
        </Link>
      </View>
    </Screen>
  );
}
