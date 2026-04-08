import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimeoutEnforcer } from './TimeoutEnforcer';
import type { ChildProcess } from 'child_process';
import EventEmitter = require('events');

class MockChildProcess extends EventEmitter {
  pid = 12345;
}

describe('TimeoutEnforcer', () => {
  let mockProc: any;
  let killMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockProc = new MockChildProcess();
    killMock = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Test 1: start() begins a timer that triggers after specified timeout', () => {
    const enforcer = new TimeoutEnforcer(mockProc as any, 2000, 10000, killMock as any);
    enforcer.start();
    // Verify timeout fires at exactly 2000ms\n    vi.advanceTimersByTime(1999);\n    expect(killMock).not.toHaveBeenCalled();\n    vi.advanceTimersByTime(1);\n    expect(killMock).toHaveBeenCalled();
  });

  it('Test 2: sends SIGTERM when timeout fires and records it in audit trail', () => {
    const enforcer = new TimeoutEnforcer(mockProc as any, 2000, 10000, killMock as any);
    enforcer.start();
    vi.advanceTimersByTime(2000);
    expect(killMock).toHaveBeenCalledWith(12345, 'SIGTERM');
    expect(enforcer.getMetadata().killedBySignal).toBe('SIGTERM');
    expect(enforcer.getMetadata().signalsSent).toHaveLength(1);
    expect(enforcer.getMetadata().signalsSent[0].signal).toBe('SIGTERM');
  });

  it('Test 3: sends SIGKILL after grace period if still alive, recording both signals', () => {
    const enforcer = new TimeoutEnforcer(mockProc as any, 2000, 5000, killMock as any);
    enforcer.start();
    vi.advanceTimersByTime(2000); // timeout -> SIGTERM
    expect(killMock).toHaveBeenCalledWith(12345, 'SIGTERM');
    vi.advanceTimersByTime(5000); // grace period -> SIGKILL
    expect(killMock).toHaveBeenCalledWith(12345, 'SIGKILL');
    expect(enforcer.getMetadata().killedBySignal).toBe('SIGKILL');
    expect(enforcer.getMetadata().signalsSent).toHaveLength(2);
    expect(enforcer.getMetadata().signalsSent[0].signal).toBe('SIGTERM');
    expect(enforcer.getMetadata().signalsSent[1].signal).toBe('SIGKILL');
  });

  it('Test 4: natural exit before timeout cancels timer', () => {
    const enforcer = new TimeoutEnforcer(mockProc as any, 2000, 10000, killMock as any);
    enforcer.start();
    enforcer.markExited();
    vi.advanceTimersByTime(2000);
    expect(killMock).not.toHaveBeenCalled();
    expect(enforcer.isExited()).toBe(true);
  });

  it('Test 5: natural exit during grace period cancels SIGKILL', () => {
    const enforcer = new TimeoutEnforcer(mockProc as any, 2000, 5000, killMock as any);
    enforcer.start();
    vi.advanceTimersByTime(2000); // SIGTERM sent
    expect(killMock).toHaveBeenCalledWith(12345, 'SIGTERM');
    enforcer.markExited();
    vi.advanceTimersByTime(5000);
    const sigKillCalls = killMock.mock.calls.filter(call => call[1] === 'SIGKILL');
    expect(sigKillCalls).toHaveLength(0);
  });

  it('Test 6: getMetadata returns complete structure with signalsSent, gracePeriodMs', () => {
    const enforcer = new TimeoutEnforcer(mockProc as any, 3000, 10000, killMock as any);
    enforcer.start();
    vi.advanceTimersByTime(3000);
    const meta = enforcer.getMetadata();
    expect(meta).toEqual({
      killedBySignal: 'SIGTERM',
      timeoutMs: 3000,
      enforcedAt: expect.any(String),
      gracePeriodMs: 10000,
      signalsSent: [{ signal: 'SIGTERM', timestamp: expect.any(String) }]
    });
  });

  it('Test 7: cancel() clears both timeout and kill timeout timers', () => {
    const enforcer = new TimeoutEnforcer(mockProc as any, 2000, 5000, killMock as any);
    enforcer.start();
    enforcer.cancel();
    vi.advanceTimersByTime(2000);
    expect(killMock).not.toHaveBeenCalled();
  });

  it('Test 8: multiple consecutive timeouts prevented by isProcessExited flag', () => {
    const enforcer = new TimeoutEnforcer(mockProc as any, 2000, 5000, killMock as any);
    enforcer.start();
    vi.advanceTimersByTime(2000); // First timeout
    expect(killMock).toHaveBeenCalledWith(12345, 'SIGTERM');
    // Manually trigger again to simulate double timeout (should be prevented)
    vi.advanceTimersByTime(5000); // Grace period
    expect(killMock).toHaveBeenCalledWith(12345, 'SIGKILL');
    // Only 2 signals total
    expect(killMock).toHaveBeenCalledTimes(2);
  });

  it('Test 9: defaultKill uses negative PID on Unix', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
    const enforcer = new TimeoutEnforcer(mockProc as any, 1000, 5000);
    enforcer.start();
    vi.advanceTimersByTime(1000);
    expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGTERM');
    vi.advanceTimersByTime(5000);
    expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGKILL');
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    killSpy.mockRestore();
  });

  it('Test 10: defaultKill uses taskkill on Windows', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
    const enforcer = new TimeoutEnforcer(mockProc as any, 1000, 5000);
    enforcer.start();
    vi.advanceTimersByTime(1000);
    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM');
    vi.advanceTimersByTime(5000);
    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGKILL');
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    killSpy.mockRestore();
  });
});
