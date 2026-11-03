import { useLocalSearchParams, useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthImage } from '@/components/auth-image';
import { Swatch } from '@/components/ui';
import { useI18n } from '@/i18n';

/** Full screen viewer for one accepted photo. */
export default function PhotoScreen() {
  const { id, name, score, color } = useLocalSearchParams<{ id: string; name?: string; score?: string; color?: string }>();
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-black" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View className="flex-row items-center justify-between px-4 py-3">
        <View className="flex-row items-center gap-3">
          {color ? <Swatch hex={color} size={28} /> : null}
          <View>
            <Text className="text-base font-medium text-white">{name}</Text>
            {score ? <Text className="text-sm text-slate-300">{t('photo.match', { score })}</Text> : null}
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => router.back()} hitSlop={10} className="size-11 items-center justify-center rounded-full bg-white/15">
          <X size={22} color="#fff" />
        </Pressable>
      </View>
      <View className="flex-1">
        <AuthImage submissionId={id as string} contain style={{ flex: 1, width: '100%' }} />
      </View>
    </View>
  );
}
