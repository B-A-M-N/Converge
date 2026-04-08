/// <reference types="node" />
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { IPCServer } from '../../src/daemon/IPCServer';

export class TestDaemon {
  private readonly homeDir: string;
  private readonly socketPath: string;
  private db: Database.Database | null = null;
  private ipcServer: IPCServer | null = null;

  constructor(homeDir?: string) {
    if (homeDir && path.isAbsolute(homeDir)) {
      this.homeDir = homeDir;
    } else if (homeDir) {
      this.homeDir = fs.mkdtempSync(path.join(os.tmpdir(), `converge-${homeDir}-`));
    } else {
      this.homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'converge-test-'));
    }
    this.socketPath = path.join(this.homeDir, 'converge.sock');
    fs.mkdirSync(this.homeDir, { recursive: true });
  }

  async start(): Promise<void> {
    const dbDir = path.join(this.homeDir, '.converge');
    fs.mkdirSync(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, 'converge.db');

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();

    const handlers = this.buildHandlers();
    this.ipcServer = new IPCServer({ socketPath: this.socketPath, handlers });
    await this.ipcServer.start();
  }

  async stop(cleanup = true): Promise<void> {
    if (this.ipcServer) {
      await this.ipcServer.stop();
      this.ipcServer = null;
    }
    if (this.db) {
      try { this.db.close(); } catch {}
      this.db = null;
    }
    if (cleanup) {
      try { fs.rmSync(this.homeDir, { recursive: true, force: true }); } catch {}
    }
  }

  getSocketPath(): string { return this.socketPath; }
  getHomeDir(): string { return this.homeDir; }
  getDbPath(): string { return path.join(this.homeDir, '.converge', 'converge.db'); }

  private initSchema(): void {
    const db = this.db!;
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        name TEXT,
        cli TEXT NOT NULL DEFAULT 'test',
        cwd TEXT NOT NULL DEFAULT '/tmp',
        task TEXT NOT NULL DEFAULT 'echo test',
        interval_spec TEXT NOT NULL DEFAULT '',
        timezone TEXT,
        session_id TEXT,
        actor TEXT,
        state TEXT NOT NULL DEFAULT 'pending',
        stop_condition_json TEXT,
        max_iterations INTEGER,
        max_failures INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_run_at TEXT,
        next_run_at TEXT,
        deleted_at TEXT,
        convergence_mode TEXT NOT NULL DEFAULT 'normal',
        execution_kind TEXT NOT NULL DEFAULT 'general',
        triggers TEXT NOT NULL DEFAULT '[]',
        trigger_mode TEXT NOT NULL DEFAULT 'enqueue',
        debounce_ms INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        exit_code INTEGER,
        output TEXT,
        pid INTEGER,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS leases (
        job_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        run_id TEXT,
        metadata TEXT,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );
    `);
  }

  private emitEvent(jobId: string, eventType: string, actorId: string, runId?: string, metadata?: any): void {
    this.db!.prepare(
      'INSERT INTO events (job_id, event_type, actor_id, timestamp, run_id, metadata) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(jobId, eventType, actorId, new Date().toISOString(), runId ?? null, metadata ? JSON.stringify(metadata) : null);
  }

  private buildHandlers(): Map<string, (params: any) => Promise<any> | any> {
    const handlers = new Map<string, (params: any) => any>();

    // ─── job.create ───
    handlers.set('job.create', (params: any) => {
      const spec = params.spec ?? params;
      const actorId = spec.actorId ?? params.actorId ?? 'system';
      const id = uuidv4();
      const now = new Date().toISOString();
      const intervalSpec = spec.interval_spec ?? spec.intervalSpec ?? '';
      const floorMs = parseInt(process.env.MINIMUM_INTERVAL_FLOOR_MS ?? '0', 10);
      if (floorMs > 0) {
        const ms = parseIntervalMs(intervalSpec);
        if (ms !== null && ms < floorMs) {
          const err: any = new Error(`Interval ${ms}ms is below minimum floor of ${floorMs}ms`);
          err.code = 'INTERVAL_FLOOR_VIOLATION';
          throw err;
        }
      }
      const intervalStr = typeof intervalSpec === 'string' ? intervalSpec : JSON.stringify(intervalSpec);
      this.db!.prepare(`
        INSERT INTO jobs (id, name, cli, cwd, task, interval_spec, state, actor, max_iterations, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
      `).run(
        id, spec.name ?? null, spec.cli ?? 'test', spec.cwd ?? '/tmp',
        spec.task ?? spec.command ?? 'echo test',
        intervalStr, actorId, spec.max_iterations ?? null, now, now
      );
      this.emitEvent(id, 'JOB_CREATED', actorId, undefined, { spec });
      const job = this.db!.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
      return { ...job, jobId: job.id };
    });

    // ─── job.list ───
    handlers.set('job.list', () => {
      return this.db!.prepare('SELECT * FROM jobs WHERE deleted_at IS NULL').all();
    });

    // ─── job.get ───
    handlers.set('job.get', (params: any) => {
      const job = this.db!.prepare('SELECT * FROM jobs WHERE id = ? AND deleted_at IS NULL').get(params.jobId);
      if (!job) throw Object.assign(new Error('Job not found'), { code: 'NOT_FOUND' });
      return job;
    });

    // ─── job.delete ───
    handlers.set('job.delete', (params: any) => {
      this.db!.prepare('UPDATE jobs SET deleted_at = ?, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), new Date().toISOString(), params.jobId);
    });

    // ─── job.cancel ───
    handlers.set('job.cancel', (params: any) => {
      const { jobId, actorId } = params;
      const job = this.db!.prepare('SELECT * FROM jobs WHERE id = ? AND deleted_at IS NULL').get(jobId) as any;
      if (!job) throw Object.assign(new Error('Job not found'), { code: 'NOT_FOUND' });
      if (job.actor && actorId && job.actor !== actorId) {
        throw Object.assign(new Error(`Unauthorized: job owned by ${job.actor}`), { code: 'UNAUTHORIZED' });
      }
      const now = new Date().toISOString();
      const prev = job.state;
      this.db!.prepare('UPDATE jobs SET state = ?, updated_at = ? WHERE id = ?').run('cancelled', now, jobId);
      this.emitEvent(jobId, 'STATE_CHANGED', actorId ?? 'system', undefined, { from: prev, to: 'cancelled', actorId });
    });

    // ─── job.pause ───
    handlers.set('job.pause', (params: any) => {
      const { jobId, actorId } = params;
      const job = this.db!.prepare('SELECT * FROM jobs WHERE id = ? AND deleted_at IS NULL').get(jobId) as any;
      if (!job) throw Object.assign(new Error('Job not found'), { code: 'NOT_FOUND' });
      if (job.actor && actorId && job.actor !== actorId) {
        throw Object.assign(new Error(`Unauthorized: job owned by ${job.actor}`), { code: 'UNAUTHORIZED' });
      }
      const now = new Date().toISOString();
      const prev = job.state;
      this.db!.prepare('UPDATE jobs SET state = ?, updated_at = ? WHERE id = ?').run('paused', now, jobId);
      this.emitEvent(jobId, 'STATE_CHANGED', actorId ?? 'system', undefined, { from: prev, to: 'paused', actorId });
    });

    // ─── job.resume ───
    handlers.set('job.resume', (params: any) => {
      const { jobId, actorId } = params;
      const job = this.db!.prepare('SELECT * FROM jobs WHERE id = ? AND deleted_at IS NULL').get(jobId) as any;
      if (!job) throw Object.assign(new Error('Job not found'), { code: 'NOT_FOUND' });
      const now = new Date().toISOString();
      const prev = job.state;
      this.db!.prepare('UPDATE jobs SET state = ?, updated_at = ? WHERE id = ?').run('active', now, jobId);
      this.emitEvent(jobId, 'STATE_CHANGED', actorId ?? 'system', undefined, { from: prev, to: 'active', actorId });
    });

    // ─── job.runNow ───
    handlers.set('job.runNow', async (params: any) => {
      const { jobId, actorId = 'system' } = params;
      const job = this.db!.prepare('SELECT * FROM jobs WHERE id = ? AND deleted_at IS NULL').get(jobId) as any;
      if (!job) throw Object.assign(new Error('Job not found'), { code: 'NOT_FOUND' });

      // Check max_iterations
      if (job.max_iterations !== null) {
        const done = this.db!.prepare(
          'SELECT COUNT(*) as c FROM runs WHERE job_id = ? AND status IN (?, ?)'
        ).get(jobId, 'completed', 'failed') as { c: number };
        if (done.c >= job.max_iterations) {
          throw Object.assign(new Error(`Max iterations (${job.max_iterations}) reached`), { code: 'MAX_ITERATIONS_EXCEEDED' });
        }
      }

      // Lease check: no concurrent runs
      const running = this.db!.prepare(
        'SELECT COUNT(*) as c FROM runs WHERE job_id = ? AND status = ?'
      ).get(jobId, 'running') as { c: number };
      if (running.c > 0) {
        throw Object.assign(new Error('Job already running — lease conflict'), { code: 'LEASE_CONFLICT' });
      }

      const runId = uuidv4();
      const startedAt = new Date().toISOString();
      this.db!.prepare('INSERT INTO runs (id, job_id, started_at, status) VALUES (?, ?, ?, ?)').run(runId, jobId, startedAt, 'running');
      this.emitEvent(jobId, 'RUN_STARTED', actorId, runId);

      try {
        const task = job.task ?? 'echo test';
        const cwd = job.cwd ?? '/tmp';
        const { exitCode } = await runCommand(task, cwd);
        const finishedAt = new Date().toISOString();
        const status = exitCode === 0 ? 'completed' : 'failed';
        this.db!.prepare('UPDATE runs SET status = ?, finished_at = ?, exit_code = ? WHERE id = ?').run(status, finishedAt, exitCode, runId);
        this.emitEvent(jobId, 'RUN_FINISHED', actorId, runId, { exitCode, status });
        return { id: runId, runId, job_id: jobId, status, exit_code: exitCode, started_at: startedAt, finished_at: finishedAt };
      } catch (err: any) {
        const finishedAt = new Date().toISOString();
        this.db!.prepare('UPDATE runs SET status = ?, finished_at = ? WHERE id = ?').run('failed', finishedAt, runId);
        this.emitEvent(jobId, 'RUN_FINISHED', actorId, runId, { error: err.message });
        throw err;
      }
    });

    // ─── run.get ───
    handlers.set('run.get', (params: any) => {
      const run = this.db!.prepare('SELECT * FROM runs WHERE id = ?').get(params.runId);
      if (!run) throw Object.assign(new Error('Run not found'), { code: 'NOT_FOUND' });
      return { ...(run as any), runId: (run as any).id };
    });

    // ─── daemon.replay ───
    handlers.set('daemon.replay', (params: any) => {
      const fromEventId = params.fromEventId ?? 0;
      return this.db!.prepare(
        'SELECT id as event_id, * FROM events WHERE id > ? ORDER BY id ASC'
      ).all(fromEventId);
    });

    // ─── daemon.capabilities ───
    handlers.set('daemon.capabilities', () => ['job.create', 'job.list', 'job.get', 'job.runNow', 'job.cancel', 'job.pause', 'job.resume', 'daemon.replay']);

    // ─── daemon.paused ───
    handlers.set('daemon.paused', () => false);

    // ─── daemon.doctor ───
    handlers.set('daemon.doctor', () => ({ status: 'ok', daemon: 'test', version: '1.0.0' }));

    // ─── daemon.logs ───
    handlers.set('daemon.logs', () => []);

    // ─── subscribe ───
    handlers.set('subscribe', () => ({ subscribed: true }));

    // ─── lease.active ───
    handlers.set('lease.active', (params: any) => {
      const lease = this.db!.prepare(
        'SELECT * FROM leases WHERE job_id = ? AND expires_at > ?'
      ).get(params.jobId, new Date().toISOString());
      return lease ?? null;
    });

    return handlers;
  }
}

function parseIntervalMs(spec: any): number | null {
  if (!spec) return null;
  if (typeof spec === 'string') {
    const m = spec.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/i);
    if (m) {
      const v = parseFloat(m[1]);
      switch (m[2].toLowerCase()) {
        case 'ms': return v;
        case 's': return v * 1000;
        case 'm': return v * 60000;
        case 'h': return v * 3600000;
      }
    }
    return null;
  }
  if (typeof spec === 'object') {
    return ((spec.milliseconds ?? 0) + (spec.seconds ?? 0) * 1000 + (spec.minutes ?? 0) * 60000 + (spec.hours ?? 0) * 3600000);
  }
  return null;
}

function runCommand(task: string, cwd: string): Promise<{ exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn(task, [], { cwd, shell: true, stdio: 'ignore' });
    child.on('close', (code) => resolve({ exitCode: code ?? 0 }));
    child.on('error', () => resolve({ exitCode: 1 }));
  });
}
