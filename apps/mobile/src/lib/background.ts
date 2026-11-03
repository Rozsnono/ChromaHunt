/**
 * Background upload task. The task must be defined at module scope (imported by the root
 * layout) so it also exists when Android starts the app headlessly. Android runs background
 * tasks at best every ~15 minutes and not guaranteed, so the queue also drains on app start,
 * foreground, connectivity changes and a timer.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { processQueue } from './upload-queue';

export const UPLOAD_TASK = 'chromahunt-upload-queue';

TaskManager.defineTask(UPLOAD_TASK, async () => {
  try {
    await processQueue();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerUploadTask(): Promise<void> {
  try {
    if (!(await TaskManager.isTaskRegisteredAsync(UPLOAD_TASK))) {
      await BackgroundTask.registerTaskAsync(UPLOAD_TASK, { minimumInterval: 15 });
    }
  } catch {
    /* unavailable (e.g. Expo Go or restricted by the OS): foreground triggers still work */
  }
}
