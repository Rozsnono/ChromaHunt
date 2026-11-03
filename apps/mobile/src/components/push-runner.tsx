import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { useEffect } from 'react';
import { registerForPush, routeForNotification, selectGroupFromNotification } from '@/lib/push';
import { useSession } from '@/lib/session';

/** Registers the device for push after sign-in and routes notification taps. */
export function PushRunner() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status !== 'signedIn') return;
    void registerForPush();
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const target = routeForNotification(data);
      if (!target) return;
      void selectGroupFromNotification(data).then(() => router.navigate(target as unknown as Href));
    });
    return () => subscription.remove();
  }, [status, router]);

  return null;
}
