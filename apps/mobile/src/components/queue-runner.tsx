import * as Network from 'expo-network';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { registerUploadTask } from '@/lib/background';
import { useSession } from '@/lib/session';
import { processQueue, purgeOldItems } from '@/lib/upload-queue';

/**
 * Drains the offline upload queue while the user is signed in: on start, when the app returns to
 * the foreground, when connectivity comes back, and on a timer (plus the OS background task).
 */
export function QueueRunner() {
  const { status } = useSession();
  useEffect(() => {
    if (status !== 'signedIn') return;
    void registerUploadTask();
    void purgeOldItems().then(processQueue);
    const appState = AppState.addEventListener('change', (state) => state === 'active' && void processQueue());
    const network = Network.addNetworkStateListener((state) => state.isConnected && void processQueue());
    const timer = setInterval(() => void processQueue(), 30_000);
    return () => {
      appState.remove();
      network.remove();
      clearInterval(timer);
    };
  }, [status]);
  return null;
}
