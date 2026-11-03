import { useEffect, useState } from 'react';
import { listQueue, subscribeQueue, type QueueItem } from './upload-queue';

/** Live view of the upload queue (newest first). */
export function useUploadQueue(): QueueItem[] {
  const [items, setItems] = useState<QueueItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => void listQueue().then((list) => !cancelled && setItems(list)).catch(() => undefined);
    refresh();
    const unsubscribe = subscribeQueue(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return items;
}
