import type { Job, Run } from '../types';

export function sendNotification(
  job: Job,
  run: Run,
  oldState: string,
  newState: string,
  reason: string
): void {
  console.log(`[Notification] Job ${job.id}: ${oldState} -> ${newState} (${reason})`);
}
