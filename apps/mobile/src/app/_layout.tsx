import '../../global.css';
import '@/lib/background';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BiometricOffer } from '@/components/biometric-offer';
import { PushRunner } from '@/components/push-runner';
import { QueueRunner } from '@/components/queue-runner';
import { I18nProvider } from '@/i18n';
import { SessionProvider, useSession } from '@/lib/session';
import { useThemeColors } from '@/lib/theme';

function RootNavigator() {
  const { status, user } = useSession();
  const colors = useThemeColors();

  if (status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-[#0b1020]">
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  // Gates: an admin password reset or an updated privacy notice must be handled before anything else.
  const gated = status === 'signedIn' && !!user && (user.mustChangePassword || user.privacyReacceptanceRequired);
  const ready = status === 'signedIn' && !gated;

  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Protected guard={status === 'signedOut'}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={gated}>
          <Stack.Screen name="(gate)" />
        </Stack.Protected>
        <Stack.Protected guard={ready}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="profile" options={{ presentation: 'modal' }} />
          <Stack.Screen name="join" options={{ presentation: 'modal' }} />
          <Stack.Screen name="camera" options={{ presentation: 'fullScreenModal' }} />
          <Stack.Screen name="group/new" options={{ presentation: 'modal' }} />
          <Stack.Screen name="group/[id]" />
          <Stack.Screen name="photo/[id]" options={{ presentation: 'fullScreenModal' }} />
        </Stack.Protected>
      </Stack>
      <BiometricOffer />
      <QueueRunner />
      <PushRunner />
      <StatusBar style={colors.dark ? 'light' : 'dark'} />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
