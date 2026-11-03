import { ChevronLeft, ChevronRight, Trophy } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addDays, isoWeekKey, isoWeekMonday, localDateString } from '@chromahunt/shared';
import { GroupChips } from '@/components/group-chips';
import { ScreenHeader } from '@/components/screen-header';
import { Avatar, Badge, Card, EmptyState, ErrorBanner } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useSession } from '@/lib/session';
import { useThemeColors } from '@/lib/theme';
import { useApi } from '@/lib/use-api';
import { useSelectedGroup } from '@/lib/use-selected-group';

interface RankingResponse {
  enabled: boolean;
  week: string;
  finalized: boolean;
  entries: { rank: number; userId: string; displayName: string; points: number; daysCompleted: number }[];
}

const PODIUM_HEIGHT: Record<number, number> = { 1: 92, 2: 68, 3: 52 };

export default function RankingScreen() {
  const { t, tError } = useI18n();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const { user } = useSession();
  const { groups, group, select } = useSelectedGroup();
  const timezone = group?.settings.timezone ?? 'Europe/Budapest';
  const currentWeek = isoWeekKey(localDateString(new Date(), timezone));
  const [week, setWeek] = useState<string | null>(null);
  const shown = week ?? currentWeek;
  const ranking = useApi<RankingResponse>(group ? `/api/groups/${group.id}/ranking?week=${shown}` : null);

  const shift = (delta: number) => setWeek(isoWeekKey(addDays(isoWeekMonday(shown), delta * 7)));
  const entries = ranking.data?.entries ?? [];
  const podium = entries.slice(0, 3);
  const weekNumber = shown.split('-W')[1] ?? shown;

  return (
    <View className="flex-1 bg-slate-50 dark:bg-[#0b1020]" style={{ paddingTop: insets.top + 12 }}>
      <View className="gap-3 px-5 pb-3">
        <ScreenHeader title={t('tabs.ranking')} />
        <GroupChips groups={groups.data ?? []} selectedId={group?.id} onSelect={(id) => { select(id); setWeek(null); }} />
      </View>
      {!group && groups.data ? (
        <EmptyState icon={Trophy} text={t('soon.ranking')} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, gap: 16 }} refreshControl={<RefreshControl refreshing={ranking.refreshing} onRefresh={ranking.reload} />}>
          <ErrorBanner message={ranking.error ? tError(ranking.error.code) : null} />
          <View className="flex-row items-center justify-between">
            <Pressable accessibilityRole="button" accessibilityLabel={t('ranking.prev')} onPress={() => shift(-1)} hitSlop={10} className="size-11 items-center justify-center">
              <ChevronLeft size={24} color={colors.text} />
            </Pressable>
            <View className="items-center gap-1">
              <Text accessibilityRole="header" className="text-lg font-semibold text-slate-900 dark:text-slate-50">{t('ranking.week', { week: weekNumber })}</Text>
              {ranking.data?.enabled && <Badge label={ranking.data.finalized ? t('ranking.final') : t('ranking.live')} tone={ranking.data.finalized ? 'success' : 'brand'} />}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('ranking.next')} disabled={shown >= currentWeek} onPress={() => shift(1)} hitSlop={10} className={`size-11 items-center justify-center ${shown >= currentWeek ? 'opacity-30' : ''}`}>
              <ChevronRight size={24} color={colors.text} />
            </Pressable>
          </View>

          {ranking.data && !ranking.data.enabled && <EmptyState icon={Trophy} text={t('ranking.disabled')} />}
          {ranking.data?.enabled && entries.every((e) => e.points === 0) && <EmptyState icon={Trophy} text={t('ranking.empty')} />}

          {podium.length > 0 && entries.some((e) => e.points !== 0) && (
            <View className="flex-row items-end justify-center gap-3 pt-2">
              {[podium[1], podium[0], podium[2]].map((e) =>
                e ? (
                  <View key={e.userId} className="items-center gap-2">
                    <Avatar name={e.displayName} size={e.rank === 1 ? 56 : 44} />
                    <Text numberOfLines={1} className="max-w-24 text-sm font-medium text-slate-800 dark:text-slate-100">{e.displayName}</Text>
                    <View style={{ height: PODIUM_HEIGHT[e.rank] }} className={`w-24 items-center justify-start rounded-t-2xl pt-2 ${e.rank === 1 ? 'bg-brand-600' : 'bg-brand-100 dark:bg-[#252d5c]'}`}>
                      <Text className={`text-lg font-semibold ${e.rank === 1 ? 'text-white' : 'text-brand-700 dark:text-brand-200'}`}>{e.points}</Text>
                    </View>
                  </View>
                ) : null,
              )}
            </View>
          )}

          {entries.length > 0 && (
            <Card className="gap-1 p-3">
              {entries.map((e) => (
                <View key={e.userId} className={`min-h-14 flex-row items-center gap-3 rounded-2xl px-3 ${e.userId === user?.id ? 'bg-brand-50 dark:bg-[#1b2140]' : ''}`}>
                  <Text className="w-7 text-center text-base font-semibold text-slate-400">{e.rank}</Text>
                  <Avatar name={e.displayName} />
                  <View className="flex-1">
                    <Text className="text-base text-slate-800 dark:text-slate-100">{e.displayName}</Text>
                    <Text className="text-xs text-slate-500 dark:text-slate-400">{t('ranking.days', { count: e.daysCompleted })}</Text>
                  </View>
                  <Text className="text-base font-semibold text-slate-900 dark:text-slate-50">{t('ranking.points', { points: e.points })}</Text>
                </View>
              ))}
            </Card>
          )}
        </ScrollView>
      )}
    </View>
  );
}
