/**
 * Codex CLI adapter for Converge.
 *
 * Thin CliAdapter implementation for Codex. Responsibilities:
 * - Provide a ConvergeClient configured for this session's socket path
 * - Resolve the Actor (username@hostname:/workspace:codex)
 * - Map command names to ConvergeClient calls
 *
 * Codex sessions use the codex-session adapter for job execution:
 * the session claims jobs via `converge claim-run`, executes them inline,
 * then submits results via `converge complete-run`.
 */

import { Actor } from '../../types';
import { ConvergeClient } from '../../client/ConvergeClient';
import { CliAdapter, CliAdapterCommand, CliAdapterResponse } from '../cli-adapter';
import { CodexActorResolver } from './actor-resolver';

const COMMAND_MAP: Record<
  string,
  (client: ConvergeClient, args: CliAdapterCommand, actor: Actor) => Promise<CliAdapterResponse>
> = {
  add: handleAdd,
  ls: handleList,
  status: handleStatus,
  pause: handlePause,
  resume: handleResume,
  cancel: handleCancel,
  'run-now': handleRunNow,
  logs: handleLogs,
  doctor: handleDoctor,
};

export class CodexAdapter implements CliAdapter {
  readonly name = 'codex';
  private client: ConvergeClient | null = null;
  private actorResolver: CodexActorResolver;

  constructor(workspaceRoot: string) {
    this.actorResolver = new CodexActorResolver(workspaceRoot);
  }

  getSocketPath(): string {
    const override = process.env.CONVERGE_SOCKET_PATH;
    if (override) return override;
    const xdg = process.env.XDG_RUNTIME_DIR;
    if (xdg) return `${xdg}/converge.sock`;
    const uid = process.getuid ? process.getuid() : 1000;
    return `/tmp/converge-${uid}.sock`;
  }

  getClient(): ConvergeClient {
    if (!this.client) {
      this.client = new ConvergeClient({
        socketPath: this.getSocketPath(),
        autoConnect: true,
      });
    }
    return this.client;
  }

  async resolveActor(): Promise<Actor> {
    return this.actorResolver.resolve();
  }

  async execute(
    client: ConvergeClient,
    command: CliAdapterCommand,
    actor: Actor
  ): Promise<CliAdapterResponse> {
    const handler = COMMAND_MAP[command.name];
    if (!handler) {
      return {
        status: 'error',
        message: `Unknown command: ${command.name}. Supported: ${Object.keys(COMMAND_MAP).join(', ')}`,
      };
    }
    return handler(client, command, actor);
  }
}

async function handleAdd(client: ConvergeClient, args: CliAdapterCommand, _actor: Actor): Promise<CliAdapterResponse> {
  const task = args.options.task as string | undefined;
  const interval = args.options.every as string | undefined;
  const cli = (args.options.cli as string | undefined) ?? 'codex-session';
  const stopCondition = args.options.stopCondition as object | undefined;

  if (!task || !interval) {
    return { status: 'error', message: 'Usage: converge add --task "<task>" --every <interval> [--cli codex-session]' };
  }

  try {
    const job = await client.createJob({
      task,
      interval,
      cli,
      ...(stopCondition && { stop_condition: stopCondition as any }),
    } as any);
    return { status: 'success', message: `Job created: ${job.id}`, data: job };
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) };
  }
}

async function handleList(client: ConvergeClient, _args: CliAdapterCommand, _actor: Actor): Promise<CliAdapterResponse> {
  try {
    const jobs = await client.listJobs();
    return {
      status: 'success',
      message: jobs.length === 0 ? 'No jobs' : `${jobs.length} job(s)`,
      data: jobs,
    };
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) };
  }
}

async function handleStatus(client: ConvergeClient, args: CliAdapterCommand, _actor: Actor): Promise<CliAdapterResponse> {
  const id = args.args[0];
  if (!id) return { status: 'error', message: 'Usage: converge status <job-id>' };
  try {
    const job = await client.getJob(id);
    if (!job) return { status: 'error', message: `Job not found: ${id}` };
    return { status: 'success', message: `Job ${id}`, data: job };
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) };
  }
}

async function handlePause(client: ConvergeClient, args: CliAdapterCommand, _actor: Actor): Promise<CliAdapterResponse> {
  const id = args.args[0];
  if (!id) return { status: 'error', message: 'Usage: converge pause <job-id>' };
  try {
    await client.pauseJob(id);
    return { status: 'success', message: `Job ${id} paused` };
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) };
  }
}

async function handleResume(client: ConvergeClient, args: CliAdapterCommand, _actor: Actor): Promise<CliAdapterResponse> {
  const id = args.args[0];
  if (!id) return { status: 'error', message: 'Usage: converge resume <job-id>' };
  try {
    await client.resumeJob(id);
    return { status: 'success', message: `Job ${id} resumed` };
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) };
  }
}

async function handleCancel(client: ConvergeClient, args: CliAdapterCommand, actor: Actor): Promise<CliAdapterResponse> {
  const id = args.args[0];
  if (!id) return { status: 'error', message: 'Usage: converge cancel <job-id>' };
  try {
    await client.cancelJob(id, actor.actorId);
    return { status: 'success', message: `Job ${id} cancelled` };
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) };
  }
}

async function handleRunNow(client: ConvergeClient, args: CliAdapterCommand, _actor: Actor): Promise<CliAdapterResponse> {
  const id = args.args[0];
  if (!id) return { status: 'error', message: 'Usage: converge run-now <job-id>' };
  try {
    const result = await client.runNow(id);
    return { status: 'success', message: `Job ${id} triggered`, data: result };
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) };
  }
}

async function handleLogs(client: ConvergeClient, args: CliAdapterCommand, _actor: Actor): Promise<CliAdapterResponse> {
  const id = args.args[0];
  if (!id) return { status: 'error', message: 'Usage: converge logs <job-id>' };
  try {
    const job = await client.getJob(id);
    if (!job) return { status: 'error', message: `Job not found: ${id}` };
    return { status: 'success', message: `Logs for ${id}`, data: { job, runs: (job as any).runs || [] } };
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) };
  }
}

async function handleDoctor(client: ConvergeClient, _args: CliAdapterCommand, _actor: Actor): Promise<CliAdapterResponse> {
  try {
    const caps = await client.getCapabilities();
    const paused = await client.isGloballyPaused();
    return {
      status: caps ? 'success' : 'info',
      message: paused ? 'System is globally paused' : 'System healthy',
      data: { capabilities: caps, paused },
    };
  } catch (err: any) {
    return { status: 'error', message: `Daemon unavailable: ${err.message || String(err)}` };
  }
}
