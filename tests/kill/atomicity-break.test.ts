import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestDaemon } from '../helpers/test-daemon';
import { ConvergeClient } from '../../src/client/ConvergeClient';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';

describe('KILL TEST: Atomicity Break', () => {
  let daemon: TestDaemon;
  let socketPath: string;
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(tmpdir(), 'converge-atomic-'));
    daemon = new TestDaemon(homeDir);
    await daemon.start();
    socketPath = daemon.getSocketPath();
  });

  afterEach(async () => {
    await daemon.stop();
  });

  it('should detect and handle orphaned runs without corresponding events', async () => {
    const client = new ConvergeClient({ socketPath, autoConnect: true });
    await client.connect();

    try {
      // Create a normal job
      const job = await client.createJob(
        {
          cli: 'test',
          command: 'true',
          args: [],
          interval_spec: { seconds: 60 },
        },
        'test-actor'
      );

      // Directly insert an orphaned run into the database (simulating partial failure)
      const dbPath = path.join(homeDir, '.converge', 'converge.db');
      const { default: Database } = await import('better-sqlite3');
      const db = new Database(dbPath);
      const orphanRunId = `orphan-${uuidv4()}`;
      db.transaction(() => {
        db.prepare(`
          INSERT INTO runs (id, job_id, status, started_at)
          VALUES (?, ?, ?, datetime())
        `).run(orphanRunId, job.id, 'running');
      })();

      // Attempt to runNow the job; should fail due to active run (lease contention)
      await expect(client.runNow(job.id, 'test-actor')).rejects.toThrow();

      // Verify the orphaned run still exists and remains running
      const orphanRow = db.prepare('SELECT status FROM runs WHERE id = ?').get(orphanRunId) as { status: string } | undefined;
      expect(orphanRow).toBeDefined();
      expect(orphanRow?.status).toBe('running');

      // Verify that there is NO RUN_STARTED event for the orphaned run
      const orphanEventCount = db.prepare(`
        SELECT COUNT(*) as c FROM events
        WHERE run_id = ? AND type = 'RUN_STARTED'
      `).get(orphanRunId) as { c: number };
      expect(orphanEventCount.c).toBe(0);

      // Verify overall consistency: no run without RUN_STARTED (except our intentional orphan)
      // The orphan is intentional; we just ensure no other such anomalies exist
      const anomalyCount = db.prepare(`
        SELECT COUNT(*) as c FROM runs r
        LEFT JOIN events e ON r.id = e.run_id AND e.type = 'RUN_STARTED'
        WHERE r.job_id = ? AND e.id IS NULL
      `).get(job.id) as { c: number };
      // anomalyCount should be 1 (the orphan), and no more
      expect(anomalyCount.c).toBe(1);

      db.close();
    } finally {
      client.close();
    }
  });
});
