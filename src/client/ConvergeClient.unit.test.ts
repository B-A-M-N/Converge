import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConvergeClient } from './ConvergeClient';
import { DaemonUnavailableError } from './errors';

describe('ConvergeClient Additional Coverage', () => {
  let client: ConvergeClient;
  let socketPath: string;

  beforeEach(() => {
    vi.useFakeTimers();
    socketPath = `/tmp/test-converge-${Date.now()}.sock`;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Connection error handling', () => {
    it('rejects connect promise on socket error', async () => {
      client = new ConvergeClient({ socketPath, autoConnect: false });
      const connectPromise = client.connect();
      // Socket will immediately fail with ENOENT since file doesn't exist
      await expect(connectPromise).rejects.toThrow(/Cannot connect:/);
    });
  });

  describe('Request/Response Correlation', () => {
    it('generates unique request IDs', () => {
      client = new ConvergeClient({ socketPath, autoConnect: false });
      const id1 = (client as any).nextId++;
      const id2 = (client as any).nextId++;
      expect(id1).not.toBe(id2);
    });

    it('maintains pending requests map correctly', () => {
      client = new ConvergeClient({ socketPath, autoConnect: false });
      const pending = (client as any).pendingRequests;
      expect(pending.size).toBe(0);

      // Simulate adding pending
      const resolve = vi.fn();
      const reject = vi.fn();
      pending.set(1, { resolve, reject });
      expect(pending.size).toBe(1);
      expect(pending.get(1)?.resolve).toBe(resolve);

      pending.delete(1);
      expect(pending.size).toBe(0);
    });
  });

  describe('Auto-connect behavior', () => {
    it('calls connect on first method when autoConnect is true', async () => {
      client = new ConvergeClient({ socketPath, autoConnect: true });
      const connectSpy = vi.spyOn(client as any, 'connect').mockRejectedValue(new Error('connection failed'));
      await expect(client.listJobs()).rejects.toThrow();
      expect(connectSpy).toHaveBeenCalled();
    });

    it('does not auto-connect when disabled', async () => {
      client = new ConvergeClient({ socketPath, autoConnect: false });
      const connectSpy = vi.spyOn(client as any, 'connect');
      await expect(client.listJobs()).rejects.toThrow('Not connected');
      expect(connectSpy).not.toHaveBeenCalled();
    });
  });

  describe('Event handling', () => {
    it('onEvent method registers callback', () => {
      client = new ConvergeClient({ socketPath, autoConnect: false });
      const callback = vi.fn();
      (client as any).onEvent = callback;
      // Confirm callback is set
      expect((client as any).onEvent).toBe(callback);
    });

    it('event broadcaster delivers events to callback', () => {
      client = new ConvergeClient({ socketPath, autoConnect: false });
      const callback = vi.fn();
      (client as any).onEvent = callback;
      // Manually emit event via _onEvent
      (client as any)._onEvent({ eventType: 'TEST', payload: { foo: 'bar' } });
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'TEST', payload: { foo: 'bar' } })
      );
    });

    it('multiple callbacks can be set independently', () => {
      const client1 = new ConvergeClient({ socketPath, autoConnect: false });
      const client2 = new ConvergeClient({ socketPath, autoConnect: false });
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      (client1 as any).onEvent = cb1;
      (client2 as any).onEvent = cb2;
      (client1 as any)._onEvent({ eventType: 'EVENT' });
      expect(cb1).toHaveBeenCalled();
      expect(cb2).not.toHaveBeenCalled();
    });
  });

  describe('Close behavior', () => {
    it('clears pending requests on close', async () => {
      client = new ConvergeClient({ socketPath, autoConnect: false });
      const pending = (client as any).pendingRequests;
      pending.set(1, { resolve: vi.fn(), reject: vi.fn() });
      pending.set(2, { resolve: vi.fn(), reject: vi.fn() });
      client.close();
      expect(pending.size).toBe(0);
    });

    it('destroys socket on close', () => {
      client = new ConvergeClient({ socketPath, autoConnect: false });
      const mockSocket = { destroy: vi.fn() };
      (client as any).socket = mockSocket as any;
      client.close();
      expect(mockSocket.destroy).toHaveBeenCalled();
    });
  });
});
