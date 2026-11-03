import { useRouter } from 'expo-router';
import { KeyRound, LogOut, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { Body, Button, Card, ErrorBanner, Screen, TextField, Title, Row } from '@/components/ui';
import { useI18n, type Lang } from '@/i18n';
import { ApiError } from '@/lib/api-core';
import { APP_VERSION } from '@/lib/config';
import { isValidPassword } from '@/lib/validation';
import { isBiometricAvailable } from '@/lib/biometric';
import { useSession } from '@/lib/session';
import { useThemeColors } from '@/lib/theme';

export default function ProfileScreen() {
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  const colors = useThemeColors();
  const { user, logout, biometricReady, enableBiometrics, disableBiometrics, changePassword, deleteAccount } = useSession();
  const { tError } = useI18n();
  const [message, setMessage] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwMessage, setPwMessage] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function submitPassword() {
    setPwError(null);
    setPwMessage(null);
    if (!isValidPassword(pw.next)) return setPwError(t('auth.passwordRules'));
    setPwBusy(true);
    try {
      await changePassword(pw.current, pw.next);
      setPw({ current: '', next: '' });
      setPwMessage(t('profile.passwordSaved'));
    } catch (e) {
      setPwError(tError(e instanceof ApiError ? e.code : 'UNKNOWN'));
    } finally {
      setPwBusy(false);
    }
  }

  async function confirmDelete() {
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      await deleteAccount(deletePassword);
    } catch (e) {
      setDeleteError(tError(e instanceof ApiError ? e.code : 'UNKNOWN'));
      setDeleteBusy(false);
    }
  }

  async function toggleBiometrics(next: boolean) {
    setMessage(null);
    if (!next) return disableBiometrics();
    if (!(await isBiometricAvailable())) return setMessage(t('biometric.unavailable'));
    setMessage((await enableBiometrics()) ? t('biometric.enabled') : t('biometric.failed'));
  }

  return (
    <Screen>
      <Title>{t('profile.title')}</Title>
      <Card>
        <Text className="text-xl font-semibold text-slate-900 dark:text-slate-50">{user?.displayName}</Text>
        <Body muted>{user?.email}</Body>
      </Card>

      <Card index={1}>
        <Text className="mb-1 text-sm font-medium uppercase tracking-wide text-slate-500">{t('profile.language')}</Text>
        <View className="flex-row gap-2 pt-1">
          {(['hu', 'en'] as Lang[]).map((code) => (
            <Pressable key={code} accessibilityRole="radio" accessibilityState={{ selected: lang === code }} onPress={() => setLang(code)} className={`min-h-11 flex-1 items-center justify-center rounded-2xl border ${lang === code ? 'border-brand-600 bg-brand-50 dark:bg-[#1b2140]' : 'border-slate-300 dark:border-[#26304d]'}`}>
              <Text className="text-base font-medium text-slate-800 dark:text-slate-100">{code === 'hu' ? 'Magyar' : 'English'}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card index={2}>
        <Text className="mb-1 text-sm font-medium uppercase tracking-wide text-slate-500">{t('profile.security')}</Text>
        <Row label={t('profile.biometric')}>
          <Switch value={biometricReady} onValueChange={toggleBiometrics} trackColor={{ true: colors.brand }} />
        </Row>
        {message && <Text className="pt-1 text-sm text-slate-500 dark:text-slate-400">{message}</Text>}
      </Card>

      <Card index={3} className="gap-4">
        <Text className="text-sm font-medium uppercase tracking-wide text-slate-500">{t('profile.password')}</Text>
        <ErrorBanner message={pwError} />
        <TextField label={t('profile.passwordCurrent')} value={pw.current} onChangeText={(current) => setPw({ ...pw, current })} secure autoComplete="current-password" />
        <TextField label={t('profile.passwordNew')} value={pw.next} onChangeText={(next) => setPw({ ...pw, next })} secure autoComplete="new-password" hint={t('auth.passwordHint')} />
        {pwMessage && <Text className="text-sm text-green-700 dark:text-green-400">{pwMessage}</Text>}
        <Button label={t('profile.password')} icon={KeyRound} variant="secondary" onPress={submitPassword} loading={pwBusy} disabled={!pw.current || !pw.next} />
      </Card>

      <Card index={4} className="gap-4">
        {deleting ? (
          <>
            <Text className="text-lg font-semibold text-slate-900 dark:text-slate-50">{t('profile.deleteTitle')}</Text>
            <Body muted>{t('profile.deleteBody')}</Body>
            <ErrorBanner message={deleteError} />
            <TextField label={t('auth.password')} value={deletePassword} onChangeText={setDeletePassword} secure autoComplete="current-password" />
            <Button label={t('profile.deleteConfirm')} icon={Trash2} onPress={confirmDelete} loading={deleteBusy} disabled={!deletePassword} />
            <Button label={t('common.cancel')} variant="ghost" onPress={() => { setDeleting(false); setDeletePassword(''); }} />
          </>
        ) : (
          <Button label={t('profile.delete')} icon={Trash2} variant="secondary" onPress={() => setDeleting(true)} />
        )}
      </Card>

      <View className="gap-3">
        <Button label={t('profile.logout')} icon={LogOut} variant="secondary" onPress={() => void logout()} />
        <Button label={t('common.close')} variant="ghost" onPress={() => router.back()} />
        <Text className="text-center text-sm text-slate-400">{t('profile.version', { version: APP_VERSION })}</Text>
      </View>
    </Screen>
  );
}
