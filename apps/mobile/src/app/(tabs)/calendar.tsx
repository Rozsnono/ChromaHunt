import { useRouter } from 'expo-router';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthImage } from '@/components/auth-image';
import { GroupChips } from '@/components/group-chips';
import { ScreenHeader } from '@/components/screen-header';
import { Body, Card, EmptyState, ErrorBanner } from '@/components/ui';
import { useI18n } from '@/i18n';
import { buildMonthGrid, monthKey, monthRange, shiftMonth } from '@/lib/calendar';
import { useThemeColors } from '@/lib/theme';
import { useApi } from '@/lib/use-api';
import { useSelectedGroup } from '@/lib/use-selected-group';

interface CalendarDay {
  date: string;
  colorHex: string;
  colorName: string;
  requiredPhotos: number;
  photos: { id: string; userId: string; displayName: string; closenessScore: number }[];
}
interface CalendarResponse {
  retentionDays: number;
  earliest: string;
  days: CalendarDay[];
}

export default function CalendarScreen() {
  const { t, tError, lang } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const { groups, group, select } = useSelectedGroup();
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const range = monthRange(cursor.year, cursor.month);
  const calendar = useApi<CalendarResponse>(group ? `/api/groups/${group.id}/calendar?from=${range.from}&to=${range.to}` : null);

  const days = new Map((calendar.data?.days ?? []).map((d) => [d.date, d]));
  const grid = buildMonthGrid(cursor.year, cursor.month);
  const detail = selected ? days.get(selected) : undefined;
  const earliestMonth = calendar.data?.earliest.slice(0, 7);
  const canGoBack = !earliestMonth || monthKey(cursor.year, cursor.month) > earliestMonth;
  const isCurrentMonth = cursor.year === today.getFullYear() && cursor.month === today.getMonth() + 1;
  const monthLabel = new Intl.DateTimeFormat(lang === 'hu' ? 'hu-HU' : 'en-GB', { month: 'long', year: 'numeric' }).format(new Date(cursor.year, cursor.month - 1, 1));
  const weekdays = lang === 'hu' ? ['H', 'K', 'Sz', 'Cs', 'P', 'Sz', 'V'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return (
    <View className="flex-1 bg-slate-50 dark:bg-[#0b1020]" style={{ paddingTop: insets.top + 12 }}>
      <View className="gap-3 px-5 pb-3">
        <ScreenHeader title={t('tabs.calendar')} />
        <GroupChips groups={groups.data ?? []} selectedId={group?.id} onSelect={(id) => { select(id); setSelected(null); }} />
      </View>

      {!group && groups.data ? (
        <EmptyState icon={CalendarDays} text={t('calendar.noGroup')} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, gap: 16 }} refreshControl={<RefreshControl refreshing={calendar.refreshing} onRefresh={calendar.reload} />}>
          <ErrorBanner message={calendar.error ? tError(calendar.error.code) : null} />
          <Card className="gap-3">
            <View className="flex-row items-center justify-between">
              <Pressable accessibilityRole="button" accessibilityLabel={t('calendar.prev')} disabled={!canGoBack} onPress={() => { setCursor(shiftMonth(cursor.year, cursor.month, -1)); setSelected(null); }} hitSlop={10} className={`size-11 items-center justify-center ${canGoBack ? '' : 'opacity-30'}`}>
                <ChevronLeft size={24} color={colors.text} />
              </Pressable>
              <Text accessibilityRole="header" className="text-lg font-semibold capitalize text-slate-900 dark:text-slate-50">{monthLabel}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t('calendar.next')} disabled={isCurrentMonth} onPress={() => { setCursor(shiftMonth(cursor.year, cursor.month, 1)); setSelected(null); }} hitSlop={10} className={`size-11 items-center justify-center ${isCurrentMonth ? 'opacity-30' : ''}`}>
                <ChevronRight size={24} color={colors.text} />
              </Pressable>
            </View>
            <View className="flex-row">
              {weekdays.map((w, i) => (
                <Text key={i} className="flex-1 text-center text-xs font-medium text-slate-400">{w}</Text>
              ))}
            </View>
            {grid.map((week, wi) => (
              <View key={wi} className="flex-row">
                {week.map((cell, ci) => {
                  const day = cell.date ? days.get(cell.date) : undefined;
                  const active = cell.date !== null && cell.date === selected;
                  return (
                    <Pressable key={ci} accessibilityRole="button" accessibilityLabel={cell.date ?? undefined} disabled={!day} onPress={() => setSelected(cell.date)} className="flex-1 items-center py-1">
                      {cell.day !== null && (
                        <View
                          style={{ backgroundColor: day?.colorHex ?? 'transparent', borderColor: active ? colors.brand : 'transparent' }}
                          className={`size-10 items-center justify-center rounded-full border-2 ${day ? '' : 'bg-slate-100 dark:bg-[#1b2140]'}`}
                        >
                          <Text className={`text-sm font-medium ${day ? 'text-white' : 'text-slate-400'}`} style={day ? { textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 2 } : undefined}>{cell.day}</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </Card>

          {calendar.data && <Body muted>{t('calendar.earliest', { days: calendar.data.retentionDays })}</Body>}

          {detail && (
            <Card index={1} className="gap-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-lg font-semibold text-slate-900 dark:text-slate-50">{detail.colorName}</Text>
                <Text className="text-sm text-slate-500">{t('calendar.photoCount', { count: detail.photos.length })}</Text>
              </View>
              {detail.photos.length === 0 ? (
                <Body muted>{t('calendar.empty')}</Body>
              ) : (
                <View className="flex-row flex-wrap gap-2">
                  {detail.photos.map((p) => (
                    <Pressable key={p.id} accessibilityRole="imagebutton" accessibilityLabel={p.displayName} onPress={() => router.push({ pathname: '/photo/[id]', params: { id: p.id, name: p.displayName, score: String(p.closenessScore), color: detail.colorHex } })} style={{ width: '31.5%' }}>
                      <AuthImage submissionId={p.id} style={{ width: '100%', aspectRatio: 1, borderRadius: 16 }} />
                      <Text numberOfLines={1} className="pt-1 text-xs text-slate-500 dark:text-slate-400">{p.displayName}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </Card>
          )}
        </ScrollView>
      )}
    </View>
  );
}
