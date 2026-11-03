import { useRouter } from 'expo-router';
import { UserRound } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import { useI18n } from '@/i18n';
import { useThemeColors } from '@/lib/theme';

/** Page title with the profile shortcut used by every tab. */
export function ScreenHeader({ title }: { title: string }) {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useI18n();
  return (
    <View className="flex-row items-center justify-between">
      <Text accessibilityRole="header" className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
        {title}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t('profile.title')} onPress={() => router.push('/profile')} hitSlop={10} className="size-11 items-center justify-center rounded-full bg-white dark:bg-[#141a2e]">
        <UserRound size={22} color={colors.text} />
      </Pressable>
    </View>
  );
}
