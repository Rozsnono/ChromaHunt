import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Check, LogOut, Share2, UserPlus, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Share, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GroupSettingsForm } from '@/components/group-settings-form';
import { Avatar, Badge, Body, Button, Card, ErrorBanner, SectionLabel, Swatch } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-core';
import { formatTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useThemeColors } from '@/lib/theme';
import type { GroupDetail, GroupSettings, InviteResult, JoinRequestItem } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, tError, lang } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const { user } = useSession();
  const group = useApi<GroupDetail>(`/api/groups/${id}`);
  const isAdmin = group.data?.role === 'admin' && !group.data.isArchived;
  const requests = useApi<JoinRequestItem[]>(isAdmin ? `/api/groups/${id}/join-requests` : null);
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<unknown>, after?: () => void) {
    setBusy(label);
    setError(null);
    try {
      await action();
      after?.();
    } catch (e) {
      setError(tError(e instanceof ApiError ? e.code : 'UNKNOWN'));
    } finally {
      setBusy(null);
    }
  }

  const confirm = (title: string, body: string, action: () => void) =>
    Alert.alert(title, body, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.confirm'), style: 'destructive', onPress: action }]);

  const createInvite = () => run('invite', async () => setInvite(await api.request<InviteResult>(`/api/groups/${id}/invites`, { method: 'POST' })));
  const decide = (reqId: string, decision: 'approve' | 'reject') =>
    run(reqId, () => api.request(`/api/groups/${id}/join-requests/${reqId}/decision`, { body: { decision } }), () => {
      requests.reload();
      group.reload();
    });

  const g = group.data;
  const assignment = g?.latestAssignment;

  return (
    <ScrollView
      className="flex-1 bg-slate-50 dark:bg-[#0b1020]"
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, paddingHorizontal: 20, gap: 16 }}
      refreshControl={<RefreshControl refreshing={group.refreshing} onRefresh={() => { group.reload(); requests.reload(); }} />}
      keyboardShouldPersistTaps="handled"
    >
      <View className="flex-row items-center gap-3">
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} hitSlop={10} className="size-11 items-center justify-center rounded-full bg-white dark:bg-[#141a2e]">
          <ArrowLeft size={22} color={colors.text} />
        </Pressable>
        <Text numberOfLines={1} className="flex-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">{g?.name ?? ''}</Text>
        {g?.role === 'admin' && <Badge label={t('groups.admin')} tone="brand" />}
      </View>

      <ErrorBanner message={error ?? (group.error ? tError(group.error.code) : null)} />
      {g?.isArchived && <ErrorBanner message={t('group.archivedNote')} />}

      {g && assignment && (
        <Card className="flex-row items-center gap-4">
          <Swatch hex={assignment.colorHex} size={56} />
          <View className="flex-1">
            <Text className="text-lg font-semibold text-slate-900 dark:text-slate-50">{assignment.colorName}</Text>
            <Text className="text-sm text-slate-500 dark:text-slate-400">
              {assignment.isOpen ? t('groups.open', { time: formatTime(assignment.deadlineAt, lang) }) : t('groups.closed')}
            </Text>
          </View>
        </Card>
      )}

      {isAdmin && (
        <Card index={1} className="gap-3">
          <SectionLabel>{t('group.invite')}</SectionLabel>
          {invite ? (
            <View className="items-center gap-3">
              <View className="rounded-2xl bg-white p-3">
                <QRCode value={invite.qrPayload} size={168} />
              </View>
              <Text selectable accessibilityLabel={t('group.inviteCode')} className="text-3xl font-semibold tracking-widest text-slate-900 dark:text-slate-50">{invite.code}</Text>
              <Body muted>{t('group.inviteNote')}</Body>
              <Button
                label={t('group.share')}
                icon={Share2}
                variant="secondary"
                onPress={() => void Share.share({ message: t('group.shareMessage', { group: invite.groupName, code: invite.code, link: invite.qrPayload }) })}
              />
            </View>
          ) : (
            <Button label={t('group.invite')} icon={UserPlus} onPress={createInvite} loading={busy === 'invite'} />
          )}
        </Card>
      )}

      {isAdmin && (
        <Card index={2} className="gap-3">
          <SectionLabel>{t('group.requests')}</SectionLabel>
          {requests.data && requests.data.length === 0 && <Body muted>{t('group.noRequests')}</Body>}
          {requests.data?.map((r) => (
            <View key={r.id} className="flex-row items-center gap-3">
              <Avatar name={r.displayName} />
              <Text className="flex-1 text-base text-slate-800 dark:text-slate-100">{r.displayName}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t('group.reject')} onPress={() => void decide(r.id, 'reject')} disabled={busy === r.id} className="size-11 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/50">
                <X size={20} color="#dc2626" />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t('group.approve')} onPress={() => void decide(r.id, 'approve')} disabled={busy === r.id} className="size-11 items-center justify-center rounded-full bg-green-100 dark:bg-green-950">
                <Check size={20} color="#16a34a" />
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      {g && (
        <Card index={3} className="gap-3">
          <SectionLabel>{t('group.members')}</SectionLabel>
          {g.members.map((m) => (
            <View key={m.userId} className="flex-row items-center gap-3">
              <Avatar name={m.displayName} />
              <View className="flex-1 flex-row items-center gap-2">
                <Text className="text-base text-slate-800 dark:text-slate-100">{m.displayName}</Text>
                {m.userId === user?.id && <Text className="text-sm text-slate-400">({t('group.you')})</Text>}
              </View>
              {m.role === 'admin' && <Badge label={t('groups.admin')} tone="brand" />}
              {isAdmin && m.userId !== user?.id && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('group.remove')}: ${m.displayName}`}
                  onPress={() => confirm(t('group.removeTitle'), t('group.removeBody'), () => void run('kick', () => api.request(`/api/groups/${id}/members/${m.userId}`, { method: 'DELETE' }), group.reload))}
                  hitSlop={8}
                >
                  <X size={20} color={colors.muted} />
                </Pressable>
              )}
            </View>
          ))}
        </Card>
      )}

      {isAdmin && g && (
        <Card index={4} className="gap-3">
          <SectionLabel>{t('group.settings')}</SectionLabel>
          <GroupSettingsForm
            key={JSON.stringify(g.settings)}
            values={g.settings}
            onSave={async (patch: Partial<GroupSettings>) => {
              await api.request(`/api/groups/${id}/settings`, { method: 'PATCH', body: patch });
              group.reload();
              Alert.alert(t('group.settingsSaved'));
            }}
          />
        </Card>
      )}

      {g && (
        <Button
          label={t('group.leave')}
          icon={LogOut}
          variant="secondary"
          onPress={() => confirm(t('group.leaveTitle'), t('group.leaveBody'), () => void run('leave', () => api.request(`/api/groups/${id}/leave`, { method: 'POST' }), () => router.back()))}
          loading={busy === 'leave'}
        />
      )}
    </ScrollView>
  );
}
