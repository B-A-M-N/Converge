import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DaemonSupervisor } from '../../src/daemon/DaemonSupervisor';
import * as fs from 'fs';

vi.mock('fs');

describe('DaemonSupervisor uncovered functions', () => {
  it('releaseSingleton closes pid fd and removes pid file', async () => {
    const mockFd = { close: vi.fn(() => Promise.resolve()) };
    const sup = new DaemonSupervisor();
    (sup as any).pidFd = mockFd as any;

    await (sup as any).releaseSingleton();

    expect(mockFd.close).toHaveBeenCalled();
    expect(fs.unlink).toHaveBeenCalledWith('/tmp/test.pid', expect.anything());
  });

  it('onSignal calls shutdown and releaseSingleton', async () => {
    const sup = new DaemonSupervisor() as any;
    sup.shutdown = vi.fn();
    sup.releaseSingleton = vi.fn();

    sup.onSignal('SIGINT');

    expect(sup.shutdown).toHaveBeenCalled();
    expect(sup.releaseSingleton).toHaveBeenCalled();
  });
});
