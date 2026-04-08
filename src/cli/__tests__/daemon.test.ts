import { describe, it, expect, vi, beforeEach } from 'vitest';
import { daemonCommand } from '../commands/daemon';

// Mock DaemonSupervisor
vi.mock('../../daemon/DaemonSupervisor', () => ({
  DaemonSupervisor: vi.fn(() => ({ start: vi.fn() })),
}));

describe('daemonCommand', () => {
  it('should be defined with correct properties', () => {
    expect(daemonCommand).toBeDefined();
    expect(daemonCommand.name()).toBe('daemon');
    expect(daemonCommand.description()).toBe('Start the background daemon process');
  });

  it('should have an action handler', () => {
    expect(typeof daemonCommand.action).toBe('function');
  });
});
