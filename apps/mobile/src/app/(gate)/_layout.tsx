import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/lib/session';

/** Decides which blocking step comes first: password change, then the privacy notice. */
export default function GateLayout() {
  const { user } = useSession();
  if (!user) return null;
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <Redirect href={user.mustChangePassword ? '/change-password' : '/terms'} />
    </>
  );
}
