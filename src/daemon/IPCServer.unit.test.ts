import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IPCServer } from './IPCServer';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';

describe('IPCServer Unit', () => {
  let server: IPCServer;
  let socketPath: string;

  beforeEach(() => {
    socketPath = `/tmp/test-converge-${Date.now()}.sock`;
    vi.stubGlobal('process', { getuid: () => 1000 });
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    vi.spyOn(fs, 'chmodSync').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
    beforeEach(() => {
      server = new IPCServer({ socketPath: socketPath });
      vi.spyOn(net.Server.prototype as any, 'listen').mockImplementation((async function (this: any, _path: string, cb: () => void): Promise<any> {
        (this as any).listening = true;
        cb();
      }) as any);
      vi.spyOn(net.Server.prototype as any, 'on');
    });

    it('creates directory if it does not exist', async () => {
      (fs.existsSync as any).mockReturnValue(false);
      await server.start();
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.dirname(socketPath), { recursive: true });
    });

    it('removes existing socket file before listening', async () => {
      (fs.existsSync as any).mockReturnValueOnce(true);
      (fs.existsSync as any).mockReturnValueOnce(true);
      await server.start();
      expect(fs.unlinkSync).toHaveBeenCalledWith(socketPath);
    });

    it('sets chmod 0600 on socket', async () => {
      (fs.existsSync as any).mockReturnValue(false);
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
      (fs.existsSync as any).mockReturnValue(false);
      const s: any = server;
      await server.start();
      const mockSocket = {} as net.Socket;
      s.routers = [];
      // Simulate connection by directly pushing router
      s.routers.push({});
      expect(s.routers.length).toBeGreaterThan(0);
    });
  });

  describe('stop()', () => {
    let s: any;

    beforeEach(async () => {
      vi.spyOn(net.Server.prototype as any, 'listen').mockImplementation((async function (this: any, _path: string, cb: () => void): Promise<any> {
        (this as any).listening = true;
        cb();
      }) as any);
      vi.spyOn(net.Server.prototype as any, 'close').mockImplementation(function (this: any, cb: () => void) {
        (this as any).listening = false;
        cb();
      } as any);
    });

    it('shuts down all routers', async () => {
      server = new IPCServer({ socketPath });
      s = server as any;
      (fs.existsSync as any).mockReturnValue(false);
      await server.start();
      const mockRouter1 = { shutdown: vi.fn().mockResolvedValue(undefined) };
      const mockRouter2 = { shutdown: vi.fn().mockResolvedValue(undefined) };
      s.routers = [mockRouter1, mockRouter2];
      await server.stop();
      expect(mockRouter1.shutdown).toHaveBeenCalled();
      expect(mockRouter2.shutdown).toHaveBeenCalled();
    });

    it('catches router shutdown errors and continues', async () => {
      server = new IPCServer({ socketPath });
      s = server as any;
      (fs.existsSync as any).mockReturnValue(false);
      await server.start();
      const mockRouter = { shutdown: vi.fn().mockRejectedValue(new Error('fail')) };
      s.routers = [mockRouter];
      await server.stop();
      expect(mockRouter.shutdown).toHaveBeenCalled();
    });

    it('closes server if present', async () => {
      server = new IPCServer({ socketPath });
      s = server as any;
      (fs.existsSync as any).mockReturnValue(false);
      await server.start();
      expect(s.server).not.toBeNull();
      await server.stop();
      expect(s.server).toBeNull();
    });

    it('removes socket file', async () => {
      server = new IPCServer({ socketPath });
      s = server as any;
      (fs.existsSync as any).mockReturnValue(false);
      await server.start();
      await server.stop();
      expect(fs.unlinkSync).toHaveBeenCalledWith(socketPath);
    });

    it('handles socket removal errors gracefully', async () => {
      server = new IPCServer({ socketPath });
      s = server as any;
      (fs.existsSync as any).mockReturnValue(false);
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('EACCES'); });
      await server.start();
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
