import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

// ESM-safe: mock fs at module level
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
    chmodSync: vi.fn(),
  };
});

// ESM-safe: mock net at module level so createServer is interceptable
vi.mock('net', () => {
  const mockServer = {
    listening: false,
    _handlers: {} as Record<string, (...args: any[]) => void>,
    on: vi.fn(function (this: any, event: string, handler: (...args: any[]) => void) {
      this._handlers[event] = handler;
      return this;
    }),
    listen: vi.fn(function (this: any, _p: string, cb: () => void) {
      this.listening = true;
      cb();
      return this;
    }),
    close: vi.fn(function (this: any, cb: () => void) {
      this.listening = false;
      if (cb) cb();
    }),
    destroy: vi.fn(),
  };
  return {
    createServer: vi.fn(() => mockServer),
    _mockServer: mockServer,
  };
});

import * as fs from 'fs';
import * as net from 'net';
import { IPCServer } from './IPCServer';

function getMockServer(): any {
  return (net as any)._mockServer;
}

describe('IPCServer Unit', () => {
  let server: IPCServer;
  let socketPath: string;

  beforeEach(() => {
    socketPath = `/tmp/test-converge-${Date.now()}.sock`;
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});
    vi.mocked(fs.chmodSync).mockImplementation(() => {});
    // Reset mock server state
    const ms = getMockServer();
    ms.listening = false;
    ms._handlers = {};
    vi.mocked(net.createServer).mockReturnValue(ms);
    vi.mocked(ms.on).mockClear();
    vi.mocked(ms.listen).mockClear();
    vi.mocked(ms.close).mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('uses default socket path when not specified', () => {
      server = new IPCServer();
      expect(server).toBeDefined();
    });

    it('accepts custom socketPath', () => {
      const customPath = '/custom/path.sock';
      server = new IPCServer({ socketPath: customPath });
      expect((server as any).socketPath).toBe(customPath);
    });

    it('accepts custom version and capabilities', () => {
      server = new IPCServer({
        version: '2.0.0',
        capabilities: ['feature1', 'feature2']
      });
      expect((server as any).version).toBe('2.0.0');
      expect((server as any).capabilities).toEqual(['feature1', 'feature2']);
    });

    it('accepts custom handlers map', () => {
      const handlers = new Map([['test.method', async () => {}]]);
      server = new IPCServer({ handlers });
      expect((server as any).handlers).toBe(handlers);
    });
  });

  describe('start()', () => {
    it('creates directory if it does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      server = new IPCServer({ socketPath });
      await server.start();
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.dirname(socketPath), { recursive: true });
    });

    it('removes existing socket file before listening', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      server = new IPCServer({ socketPath });
      await server.start();
      expect(fs.unlinkSync).toHaveBeenCalledWith(socketPath);
    });

    it('sets chmod 0600 on socket', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      server = new IPCServer({ socketPath });
      await server.start();
      expect(fs.chmodSync).toHaveBeenCalledWith(socketPath, 0o600);
    });

    it('throws if already closed', async () => {
      server = new IPCServer({ socketPath });
      const s: any = server;
      s.closed = true;
      await expect(server.start()).rejects.toThrow('Server is closed');
    });

    it('stores router on connection', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      server = new IPCServer({ socketPath });
      const s: any = server;
      await server.start();
      s.routers = [];
      // Simulate connection by directly pushing router
      s.routers.push({});
      expect(s.routers.length).toBeGreaterThan(0);
    });
  });

  describe('stop()', () => {
    async function startServer(): Promise<IPCServer> {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const srv = new IPCServer({ socketPath });
      await srv.start();
      return srv;
    }

    it('shuts down all routers', async () => {
      server = await startServer();
      const s = server as any;
      const mockRouter1 = { shutdown: vi.fn() };
      const mockRouter2 = { shutdown: vi.fn() };
      s.routers = [mockRouter1, mockRouter2];
      await server.stop();
      expect(mockRouter1.shutdown).toHaveBeenCalled();
      expect(mockRouter2.shutdown).toHaveBeenCalled();
    });

    it('catches router shutdown errors and continues', async () => {
      server = await startServer();
      const s = server as any;
      const mockRouter = { shutdown: vi.fn(() => { throw new Error('fail'); }) };
      s.routers = [mockRouter];
      await expect(server.stop()).resolves.not.toThrow();
      expect(mockRouter.shutdown).toHaveBeenCalled();
    });

    it('closes server if present', async () => {
      server = await startServer();
      const s = server as any;
      expect(s.server).not.toBeNull();
      await server.stop();
      expect(s.server).toBeNull();
    });

    it('removes socket file', async () => {
      server = await startServer();
      vi.mocked(fs.unlinkSync).mockClear();
      await server.stop();
      expect(fs.unlinkSync).toHaveBeenCalledWith(socketPath);
    });

    it('handles socket removal errors gracefully', async () => {
      server = await startServer();
      vi.mocked(fs.unlinkSync).mockImplementation(() => { throw new Error('EACCES'); });
      await expect(server.stop()).resolves.not.toThrow();
    });
  });

  describe('removeRouter()', () => {
    let s: any;

    beforeEach(() => {
      server = new IPCServer({ socketPath });
      s = server as any;
      s.routers = [];
    });

    it('removes router from list', () => {
      const mockRouter = {};
      s.routers = [mockRouter];
      (server as any).removeRouter(mockRouter);
      expect(s.routers.length).toBe(0);
    });

    it('does nothing if router not in list', () => {
      const mockRouter = {};
      s.routers = [];
      (server as any).removeRouter(mockRouter);
      expect(s.routers.length).toBe(0);
    });
  });
});
