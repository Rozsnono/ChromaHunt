/**
 * Push notification registration and tap routing. Everything degrades silently when push is not
 * available (Expo Go, emulator without Google services, no EAS project id yet, permission denied).
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';
import { getDeviceId, prefs } from './storage';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const SELECTED_GROUP_PREF = 'ch_selected_group';

/** Returns true when this device is registered for push. */
export async function registerForPush(): Promise<boolean> {
  try {
    if (!Device.isDevice || Constants.appOwnership === 'expo') return false; // Expo Go cannot receive push on Android
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return false;
    if (Platform.OS === 'android') {
      // eslint-disable-next-line import/namespace -- exported by expo-notifications (false positive on its type layout)
      await Notifications.setNotificationChannelAsync('default', { name: 'ChromaHunt', importance: Notifications.AndroidImportance.HIGH, lightColor: '#4f46e5' });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return false;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.request('/api/push/tokens', { body: { token, deviceId: await getDeviceId() } });
    return true;
  } catch {
    return false;
  }
}

export async function unregisterFromPush(): Promise<void> {
  try {
    await api.request(`/api/push/tokens?deviceId=${encodeURIComponent(await getDeviceId())}`, { method: 'DELETE' });
  } catch {
    /* best effort */
  }
}

/** Where a notification tap should lead. */
export function routeForNotification(data: Record<string, unknown> | undefined): { pathname: string; params?: Record<string, string> } | null {
  const type = typeof data?.type === 'string' ? data.type : null;
  const groupId = typeof data?.groupId === 'string' ? data.groupId : null;
  switch (type) {
    case 'join_request':
    case 'admin_transferred':
    case 'group_archived':
      return groupId ? { pathname: '/group/[id]', params: { id: groupId } } : { pathname: '/groups' };
    case 'join_approved':
    case 'join_rejected':
      return { pathname: '/groups' };
    case 'daily_color':
    case 'deadline_reminder':
    case 'photo_accepted':
    case 'photo_rejected':
      return { pathname: '/' };
    default:
      return null;
  }
}

/** Remembers which group a notification was about so the Today tab opens on it. */
export async function selectGroupFromNotification(data: Record<string, unknown> | undefined): Promise<void> {
  if (typeof data?.groupId === 'string') await prefs.set(SELECTED_GROUP_PREF, data.groupId);
}
