import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestDaemon } from '../helpers/test-daemon';
import { ConvergeClient } from '../../src/client/ConvergeClient';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

describe('KILL TEST: Interval Floor Violation', () => {
  let daemon: TestDaemon;
  let socketPath: string;
  let homeDir: string;

  beforeEach(async () => {
    // Set minimum interval floor to 1000ms
    process.env.MINIMUM_INTERVAL_FLOOR_MS = '1000';
    homeDir = await fs.mkdtemp(path.join(tmpdir(), 'converge-intvl-'));
    daemon = new TestDaemon(homeDir);
    await daemon.start();
    socketPath = daemon.getSocketPath();
  });

  afterEach(async () => {
    await daemon.stop();
    delete process.env.MINIMUM_INTERVAL_FLOOR_MS;
  });

  it('rejects intervals below the floor', async () => {
    const client = new ConvergeClient({ socketPath, autoConnect: true });
    await client.connect();

    try {
      // 500ms via milliseconds field
      await expect(client.createJob({
        cli: 'test',
        command: 'true',
        args: [],
        interval_spec: { milliseconds: 500 },
      }, 'test-actor')).rejects.toThrow();

      // 0.5 seconds
      await expect(client.createJob({
        cli: 'test',
        command: 'true',
        args: [],
        interval_spec: { seconds: 0.5 },
      }, 'test-actor')).rejects.toThrow();
    } finally {
      client.close();
    }
  });

  it('accepts intervals at or above the floor', async () => {
    const client = new ConvergeClient({ socketPath, autoConnect: true });
    await client.connect();

    try {
      // exact floor: 1 second
      const job1 = await client.createJob({
        cli: 'test',
        command: 'true',
        args: [],
        interval_spec: { seconds: 1 },
      }, 'test-actor');
      expect(job1.id).toBeDefined();

      // above floor: 2 seconds
      const job2 = await client.createJob({
        cli: 'test',
        command: 'true',
        args: [],
        interval_spec: { seconds: 2 },
      }, 'test-actor');
      expect(job2.id).toBeDefined();
    } finally {
      client.close();
    }
  });
});
