/**
 * Claude Code adapter for Converge.
 *
 * This adapter implements CliAdapter for Claude Code, mapping command input
 * to ConvergeClient method calls. All mutating operations include explicit
 * Actor attribution derived from Claude-local context.
 *
 * CLI-specific behavior (command parsing, output formatting, actor derivation)
 * lives here. ConvergeClient remains untouched and generic.
 */

import { Actor } from '../../types';
import { ConvergeClient } from '../../client/ConvergeClient';
import { CliAdapter, CliAdapterCommand, CliAdapterResponse } from '../cli-adapter';
import { ClaudeActorResolver } from './actor-resolver';

/**
 * Maps command names to ConvergeClient methods.
 */
const COMMAND_MAP: Record<string, (client: ConvergeClient, args: CliAdapterCommand, actor: Actor) => Promise<CliAdapterResponse>> = {
  'add': handleAdd,
  'ls': handleList,
  'status': handleStatus,
  'pause': handlePause,
  'resume': handleResume,
  'cancel': handleCancel,
  'run-now': handleRunNow,
  'logs': handleLogs,
  'doctor': handleDoctor,
};

export class ClaudeAdapter implements CliAdapter {
  readonly name = 'claude-code';
  private client: ConvergeClient | null = null;
  private actorResolver: ClaudeActorResolver;

  constructor(workspaceRoot: string) {
    this.actorResolver = new ClaudeActorResolver(workspaceRoot);
  }

  getSocketPath(): string {
    const uid = process.getuid ? process.getuid() : 1000;
    const xdg = process.env.XDG_RUNTIME_DIR;
    const override = process.env.CONVERGE_SOCKET_PATH;
    if (override) return override;
    if (xdg) return `${xdg}/converge.sock`;
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
    if (!actor?.actorId) {
      return {
        status: 'error',
        message: 'Actor identity is required for this operation',
      };
    }
    const handler = COMMAND_MAP[command.name];
    if (!handler) {
      return {
        status: 'error',
        message: `Unknown command: ${command.name}. Supported: ${Object.keys(COMMAND_MAP).join(', ')}`,
      };
    }
    return handler(client, { ...command, options: { ...command.options, _actor: actor } } as CliAdapterCommand, actor);
  }
}

async function handleAdd(client: ConvergeClient, args: CliAdapterCommand, _actor: Actor): Promise<CliAdapterResponse> {
  const task = args.options.task as string | undefined;
  const interval = args.options.every as string | undefined;
  const cli = args.options.cli as string | undefined;
  const stopCondition = args.options.stopCondition as object | undefined;

  if (!task || !interval) {
    return { status: 'error', message: 'Usage: /loop add --task "<task>" --every <interval> [--cli <cli>]' };
  }

  try {
    const job = await client.createJob(
      {
        task,
        interval,
        cli: cli || 'test',
        ...(stopCondition && { stop_condition: stopCondition as any }),
      } as any,
    );
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
      message: jobs.length === 0 ? 'No jobs found' : `Found ${jobs.length} job(s)`,
      data: jobs,
    };
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) };
  }
}

async function handleStatus(client: ConvergeClient, args: CliAdapterCommand, _actor: Actor): Promise<CliAdapterResponse> {
  const id = args.args[0] as string | undefined;
  if (!id) {
    return { status: 'error', message: 'Usage: /loop status <job-id>' };
  }
  try {
    const job = await client.getJob(id);
    if (!job) {
      return { status: 'error', message: `Job not found: ${id}` };
    }
    return { status: 'success', message: `Job ${id} retrieved`, data: job };
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) };
  }
}

async function handlePause(client: ConvergeClient, args: CliAdapterCommand, _actor: Actor): Promise<CliAdapterResponse> {
  const id = args.args[0] as string | undefined;
  if (!id) {
    return { status: 'error', message: 'Usage: /loop pause <job-id>' };
  }
  try {
    await client.pauseJob(id);
    return { status: 'success', message: `Job ${id} paused` };
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) };
  }
}

async function handleResume(client: ConvergeClient, args: CliAdapterCommand, _actor: Actor): Promise<CliAdapterResponse> {
  const id = args.args[0] as string | undefined;
  if (!id) {
    return { status: 'error', message: 'Usage: /loop resume <job-id>' };
  }
  try {
    await client.resumeJob(id);
    return { status: 'success', message: `Job ${id} resumed` };
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) };
  }
}

async function handleCancel(client: ConvergeClient, args: CliAdapterCommand, _actor: Actor): Promise<CliAdapterResponse> {
  const id = args.args[0] as string | undefined;
  if (!id) {
    return { status: 'error', message: 'Usage: /loop cancel <job-id>' };
  }
  try {
    await client.cancelJob(id, _actor.actorId);
    return { status: 'success', message: `Job ${id} cancelled` };
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) };
  }
}

async function handleRunNow(client: ConvergeClient, args: CliAdapterCommand, _actor: Actor): Promise<CliAdapterResponse> {
  const id = args.args[0] as string | undefined;
  if (!id) {
    return { status: 'error', message: 'Usage: /loop run-now <job-id>' };
  }
  try {
    const result = await client.runNow(id);
    return { status: 'success', message: `Job ${id} scheduled for immediate run`, data: result };
  } catch (err: any) {
    return { status: 'error', message: err.message || String(err) };
  }
}

async function handleLogs(client: ConvergeClient, args: CliAdapterCommand, _actor: Actor): Promise<CliAdapterResponse> {
  const id = args.args[0] as string | undefined;
  if (!id) {
    return { status: 'error', message: 'Usage: /loop logs <job-id>' };
  }
  try {
    const job = await client.getJob(id);
    if (!job) {
      return { status: 'error', message: `Job not found: ${id}` };
    }
    return {
      status: 'success',
      message: `Logs for job ${id}`,
      data: { job, runs: (job as any).runs || [] },
    };
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
