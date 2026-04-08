import { describe, it, expect, vi, afterEach } from 'vitest';
import { DaemonSupervisor } from '../../src/daemon/DaemonSupervisor';

vi.mock('../../src/daemon/IPCServer', () => ({
  IPCServer: vi.fn(function () {
    return {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('../../src/daemon/scheduler', () => ({
  startScheduler: vi.fn(),
  stopScheduler: vi.fn(),
}));

vi.mock('../../src/core/ControlPlane', () => ({
  ControlPlane: {
    initialize: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/db/SchemaManager', () => ({
  SchemaManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('DaemonSupervisor uncovered functions', () => {
  afterEach(() => {
    // Remove all SIGINT listeners after each test to prevent leak
    process.removeAllListeners('SIGINT');
  });

  it('start() initializes components and starts IPC server', async () => {
    const sup = new DaemonSupervisor();
    await expect(sup.start()).resolves.not.toThrow();
  });

  it('shutdown is called when SIGINT is received', async () => {
    const sup = new DaemonSupervisor();
    const shutdownSpy = vi.spyOn(sup as any, 'shutdown').mockImplementation(async () => {});
    await sup.start();
    process.emit('SIGINT', 'SIGINT');
    expect(shutdownSpy).toHaveBeenCalled();
    shutdownSpy.mockRestore();
  });
});
