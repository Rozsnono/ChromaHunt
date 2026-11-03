import { useRouter } from 'expo-router';
import { Plus, QrCode, UsersRound } from 'lucide-react-native';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { ScreenHeader } from '@/components/screen-header';
import { Badge, Button, Card, EmptyState, ErrorBanner, Swatch } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatTime } from '@/lib/format';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GroupSummary } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function GroupsScreen() {
  const { t, tError, lang } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, error, loading, refreshing, reload } = useApi<GroupSummary[]>('/api/groups');

  const status = (g: GroupSummary) => {
    if (g.isArchived) return t('groups.archived');
    if (!g.latestAssignment) return t('groups.noColor');
    return g.latestAssignment.isOpen ? t('groups.open', { time: formatTime(g.latestAssignment.deadlineAt, lang) }) : t('groups.closed');
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-[#0b1020]" style={{ paddingTop: insets.top + 12 }}>
      <View className="px-5 pb-3">
        <ScreenHeader title={t('tabs.groups')} />
      </View>
      <FlatList
        data={data ?? []}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 12, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}
        ListHeaderComponent={error ? <ErrorBanner message={tError(error.code)} /> : undefined}
        ListEmptyComponent={loading ? undefined : <EmptyState icon={UsersRound} text={t('groups.empty')} />}
        renderItem={({ item, index }) => (
          <View>
            <Pressable accessibilityRole="button" accessibilityLabel={item.name} onPress={() => router.push(`/group/${item.id}`)}>
              <Card className="flex-row items-center gap-4">
                {item.latestAssignment ? <Swatch hex={item.latestAssignment.colorHex} size={48} /> : <View className="size-12 rounded-full bg-slate-200 dark:bg-[#1f2744]" />}
                <View className="flex-1 gap-1">
                  <Text className="text-lg font-semibold text-slate-900 dark:text-slate-50">{item.name}</Text>
                  <Text className="text-sm text-slate-500 dark:text-slate-400">
                    {t('groups.members', { count: item.memberCount })} · {status(item)}
                  </Text>
                </View>
                {item.role === 'admin' && <Badge label={t('groups.admin')} tone="brand" />}
              </Card>
            </Pressable>
          </View>
        )}
      />
      <View className="flex-row gap-3 px-5 pt-2 pb-4">
        <View className="flex-1">
          <Button label={t('groups.join')} icon={QrCode} onPress={() => router.push('/join')} />
        </View>
        <View className="flex-1">
          <Button label={t('groups.new')} icon={Plus} variant="secondary" onPress={() => router.push('/group/new')} />
        </View>
      </View>
    </View>
  );
}
