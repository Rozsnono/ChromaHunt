import { useRouter } from 'expo-router';
import { Camera, CircleCheck, Clock, Hourglass, UsersRound } from 'lucide-react-native';
import { useEffect } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { Avatar, Button, Card, EmptyState, ErrorBanner, SectionLabel, Swatch } from '@/components/ui';
import { useI18n, type Key } from '@/i18n';
import { formatRemaining } from '@/lib/format';
import type { TodayResponse } from '@/lib/types';
import { subscribeQueue } from '@/lib/upload-queue';
import { useSelectedGroup } from '@/lib/use-selected-group';
import { GroupChips } from '@/components/group-chips';
import { useApi } from '@/lib/use-api';
import { useNow } from '@/lib/use-now';
import { useUploadQueue } from '@/lib/use-upload-queue';

export default function TodayScreen() {
  const { t, tError, lang } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const queue = useUploadQueue();
  const { groups, group, select } = useSelectedGroup();
  const list = groups.data ?? [];
  const today = useApi<TodayResponse>(group ? `/api/groups/${group.id}/today` : null);
  const { reload } = today;
  useEffect(() => subscribeQueue(() => reload()), [reload]);

  const assignment = today.data?.assignment ?? null;
  const me = today.data?.me ?? null;
  const open = !!assignment && new Date(assignment.deadlineAt).getTime() > now && !group?.isArchived;
  const mine = queue.filter((q) => assignment && q.assignmentId === assignment.id);
  const waiting = mine.filter((q) => q.state === 'queued').length;
  const dropped = mine.filter((q) => q.state === 'dropped').slice(0, 2);

  const refresh = () => {
    groups.reload();
    today.reload();
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-[#0b1020]" style={{ paddingTop: insets.top + 12 }}>
      <View className="px-5 pb-3">
        <ScreenHeader title={t('tabs.today')} />
      </View>

      {groups.data && list.length === 0 ? (
        <View className="flex-1 pb-6">
          <EmptyState icon={UsersRound} text={t('today.noGroups')} />
          <View className="px-5">
            <Button label={t('today.goGroups')} onPress={() => router.navigate('/groups')} />
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, gap: 16 }} refreshControl={<RefreshControl refreshing={groups.refreshing || today.refreshing} onRefresh={refresh} />} showsVerticalScrollIndicator={false}>
          <ErrorBanner message={groups.error ? tError(groups.error.code) : today.error ? tError(today.error.code) : null} />

          <GroupChips groups={list} selectedId={group?.id} onSelect={select} />

          {group && assignment ? (
            <View className="items-center gap-4 rounded-[32px] p-6" style={{ backgroundColor: `${assignment.colorHex}26` }}>
              <Swatch hex={assignment.colorHex} size={168} />
              <View className="items-center gap-1">
                <Text className="text-sm font-medium uppercase tracking-widest text-slate-500 dark:text-slate-400">{t('today.colorOfTheDay')}</Text>
                <Text accessibilityRole="header" className="text-4xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">{assignment.colorName}</Text>
              </View>
              <View className="flex-row items-center gap-2 rounded-full bg-white/70 px-4 py-2 dark:bg-black/30">
                <Clock size={16} color="#64748b" />
                <Text className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {open ? t('today.deadlineIn', { time: formatRemaining(new Date(assignment.deadlineAt).getTime() - now, lang) }) : t('today.closed')}
                </Text>
              </View>
            </View>
          ) : group && today.data ? (
            <EmptyState icon={Hourglass} text={t('today.noAssignment')} />
          ) : null}

          {assignment && me && (
            <Card index={1} className="gap-4">
              <View className="flex-row items-center justify-between">
                <Text className="text-lg font-semibold text-slate-900 dark:text-slate-50">{t('today.photos', { done: me.accepted, total: assignment.requiredPhotos })}</Text>
                {me.completed && <CircleCheck size={24} color="#16a34a" />}
              </View>
              <View className="flex-row gap-2">
                {Array.from({ length: assignment.requiredPhotos }).map((_, i) => (
                  <View key={i} className={`h-2 flex-1 rounded-full ${i < me.accepted ? 'bg-green-500' : i < me.accepted + me.pending ? 'bg-amber-400' : 'bg-slate-200 dark:bg-[#26304d]'}`} />
                ))}
              </View>
              {me.pending > 0 && <Text className="text-sm text-amber-700 dark:text-amber-300">{t('today.pending', { count: me.pending })}</Text>}
              {me.rejected > 0 && !me.completed && <Text className="text-sm text-slate-500 dark:text-slate-400">{t('today.rejected', { count: me.rejected })}</Text>}
              {waiting > 0 && <Text className="text-sm text-slate-500 dark:text-slate-400">{t('today.queued', { count: waiting })}</Text>}
              {dropped.map((d) => (
                <Text key={d.id} className="text-sm text-red-600 dark:text-red-400">{t(`queue.${d.outcome ?? 'invalid'}` as Key)}</Text>
              ))}
              {me.completed ? (
                <Text className="text-base font-medium text-green-700 dark:text-green-400">{t('today.completed')}</Text>
              ) : open ? (
                <Button label={t('today.take')} icon={Camera} onPress={() => router.push({ pathname: '/camera', params: { groupId: group?.id } })} disabled={me.remaining <= 0} />
              ) : null}
            </Card>
          )}

          {today.data && today.data.members.length > 0 && (
            <Card index={2} className="gap-3">
              <SectionLabel>{t('today.members')}</SectionLabel>
              {today.data.members.map((m) => (
                <View key={m.userId} className="flex-row items-center gap-3">
                  <Avatar name={m.displayName} />
                  <Text className="flex-1 text-base text-slate-800 dark:text-slate-100">{m.displayName}</Text>
                  {m.completed ? <CircleCheck size={20} color="#16a34a" /> : <Text className="text-sm text-slate-400">{m.accepted} / {assignment?.requiredPhotos}</Text>}
                </View>
              ))}
            </Card>
          )}
        </ScrollView>
      )}
    </View>
  );
}
