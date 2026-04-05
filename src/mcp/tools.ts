import { CommandDispatcher } from '../core/CommandDispatcher';

export async function handleLoopCreate(args: { task: string; interval: string; stopCondition?: any; cli?: string }) {
  const result = await CommandDispatcher.add({
    task: args.task,
    interval: args.interval,
    stopCondition: args.stopCondition,
    cli: args.cli || 'test'
  });
  if (result.status === 'error') throw new Error(result.reason);
  return { jobId: result.jobId, status: 'created' };
}

export async function handleLoopList() {
  const jobs = CommandDispatcher.ls();
  return { jobs };
}

export async function handleLoopDelete(args: { id: string }) {
  const result = await CommandDispatcher.rm(args.id);
  if (result.status === 'error') throw new Error(result.reason);
  return { deleted: true };
}

export async function handleLoopPause(args: { id: string }) {
  const result = await CommandDispatcher.pause(args.id);
  if (result.status === 'error') throw new Error(result.reason);
  return { paused: true };
}

export async function handleLoopResume(args: { id: string }) {
  const result = await CommandDispatcher.resume(args.id);
  if (result.status === 'error') throw new Error(result.reason);
  return { resumed: true };
}

export async function handleLoopRunNow(args: { id: string }) {
  const result = await CommandDispatcher.runNow(args.id);
  if (result.status === 'rejected') throw new Error(result.reason);
  return { scheduled: true };
}

export async function handleLoopLogs(args: { id: string }) {
  const runs = CommandDispatcher.logs(args.id);
  return { runs };
}

export async function handleLoopDoctor() {
  const health = await CommandDispatcher.doctor();
  return { health };
}
