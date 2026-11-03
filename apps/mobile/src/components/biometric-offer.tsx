import { Fingerprint } from 'lucide-react-native';
import { Modal, Text, View } from 'react-native';
import { useI18n } from '@/i18n';
import { useSession } from '@/lib/session';
import { useThemeColors } from '@/lib/theme';
import { Button } from './ui';

/** Offered once per device after the first successful password login. */
export function BiometricOffer() {
  const { t } = useI18n();
  const colors = useThemeColors();
  const { biometricOffer, enableBiometrics, dismissBiometricOffer } = useSession();
  return (
    <Modal visible={biometricOffer} transparent animationType="fade" onRequestClose={dismissBiometricOffer}>
      <View className="flex-1 justify-end bg-black/50 p-4">
        <View className="gap-4 rounded-3xl bg-white p-6 dark:bg-[#141a2e]">
          <View className="size-14 items-center justify-center self-center rounded-full bg-brand-50 dark:bg-[#1b2140]">
            <Fingerprint size={28} color={colors.brandSoft} />
          </View>
          <Text className="text-center text-xl font-semibold text-slate-900 dark:text-slate-50">{t('biometric.offerTitle')}</Text>
          <Text className="text-center text-base leading-6 text-slate-500 dark:text-slate-400">{t('biometric.offerBody')}</Text>
          <Button label={t('biometric.enable')} onPress={() => void enableBiometrics()} />
          <Button label={t('biometric.later')} variant="ghost" onPress={() => void dismissBiometricOffer()} />
        </View>
      </View>
    </Modal>
  );
}
