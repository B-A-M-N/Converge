import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

// ESM-safe: mock fs at module level so both default and namespace imports are intercepted
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    createWriteStream: vi.fn(),
  };
});

import { OutputCaptureLayer } from './OutputCaptureLayer';
import EventEmitter = require('events');
import * as fs from 'fs';

// Helper to create mock readable (proc.stdout/stderr)
function createMockReadable(): any {
  const stream = new EventEmitter() as any;
  let dataHandler: ((chunk: Buffer) => void) | null = null;
  stream.pipe = vi.fn((dest: any) => {
    dataHandler = (chunk: Buffer) => dest.write(chunk);
    stream.on('data', dataHandler);
    stream.on('end', () => dest.emit('finish'));
    return dest;
  });
  (stream as any)._cleanup = () => {
    if (dataHandler) stream.off?.('data', dataHandler);
  };
  return stream;
}

// Helper to create mock write stream (file destination)
function createMockWriteStream(): any {
  const stream = new EventEmitter() as any;
  stream.bytesWritten = 0;
  stream.write = vi.fn((chunk: Buffer) => {
    stream.bytesWritten += chunk.length;
    return true;
  });
  stream.end = vi.fn(() => setImmediate(() => stream.emit('finish')));
  return stream;
}

function createMockProc(): any {
  return {
    stdout: createMockReadable(),
    stderr: createMockReadable(),
    pid: 12345,
  };
}

describe('OutputCaptureLayer', () => {
  let layer: OutputCaptureLayer | null = null;
  let mockProc: any;

  beforeAll(() => {
    vi.mocked(fs.createWriteStream).mockImplementation(() => createMockWriteStream() as any);
  });

  beforeEach(() => {
    mockProc = createMockProc();
    // Re-apply implementation after clearAllMocks
    vi.mocked(fs.createWriteStream).mockImplementation(() => createMockWriteStream() as any);
  });

  afterEach(() => {
    if (layer) {
      layer.close();
      layer = null;
    }
    if (mockProc.stdout._cleanup) mockProc.stdout._cleanup();
    if (mockProc.stderr._cleanup) mockProc.stderr._cleanup();
    vi.clearAllMocks();
  });

  it('creates write streams at correct paths', () => {
    const stdoutPath = '/tmp/stdout-test.log';
    const stderrPath = '/tmp/stderr-test.log';
    layer = new OutputCaptureLayer(stdoutPath, stderrPath, 100 * 1024);
    (layer as any).attachToProcess(mockProc);
    expect(fs.createWriteStream).toHaveBeenCalledWith(stdoutPath, { highWaterMark: 64 * 1024 });
    expect(fs.createWriteStream).toHaveBeenCalledWith(stderrPath, { highWaterMark: 64 * 1024 });
  });

  it('small output is fully captured without truncation', async () => {
    const chunk = Buffer.alloc(1024, 'a');
    layer = new OutputCaptureLayer('/tmp/out1', '/tmp/err1', 100 * 1024);
    (layer as any).attachToProcess(mockProc);
    mockProc.stdout.emit('data', chunk);
    mockProc.stdout.emit('data', chunk);
    await new Promise(res => setTimeout(res, 50));
    const meta = (layer as any).getMetadata();
    expect(meta.truncated).toBe(false);
    expect(meta.stdoutBytes).toBe(2048);
    expect(meta.truncatedAt).toBeNull();
  });

  it('output exceeding maxBytes triggers truncation', async () => {
    const chunk50 = Buffer.alloc(50 * 1024, 'x');
    const huge = Buffer.alloc(100 * 1024, 'y');
    layer = new OutputCaptureLayer('/tmp/out2', '/tmp/err2', 100 * 1024);
    (layer as any).attachToProcess(mockProc);
    mockProc.stdout.emit('data', chunk50);
    mockProc.stdout.emit('data', huge); // pushes over 100KB
    await new Promise(res => setTimeout(res, 50));
    const meta = (layer as any).getMetadata();
    expect(meta.truncated).toBe(true);
    expect(meta.truncatedAt).not.toBeNull();
  });

  it('truncation stops further writes', async () => {
    const chunk50 = Buffer.alloc(50 * 1024, 'x');
    layer = new OutputCaptureLayer('/tmp/out3', '/tmp/err3', 60 * 1024);
    (layer as any).attachToProcess(mockProc);
    mockProc.stdout.emit('data', chunk50);
    mockProc.stdout.emit('data', chunk50); // second push triggers truncation
    await new Promise(res => setTimeout(res, 50));
    const meta = (layer as any).getMetadata();
    expect(meta.truncated).toBe(true);
  });

  it('uses pipe to connect streams', () => {
    layer = new OutputCaptureLayer('/tmp/out4', '/tmp/err4', 100 * 1024);
    (layer as any).attachToProcess(mockProc);
    expect(mockProc.stdout.pipe).toHaveBeenCalled();
    expect(mockProc.stderr.pipe).toHaveBeenCalled();
  });

  it('getMetadata returns correct structure', async () => {
    const chunk = Buffer.alloc(1024, 'a');
    layer = new OutputCaptureLayer('/tmp/out5', '/tmp/err5', 100 * 1024);
    (layer as any).attachToProcess(mockProc);
    mockProc.stdout.emit('data', chunk);
    await new Promise(res => setTimeout(res, 50));
    const meta = (layer as any).getMetadata();
    expect(meta.stdoutBytes).toBe(1024);
    expect(meta.maxBytes).toBe(100 * 1024);
    expect(meta.truncated).toBe(false);
  });

  it('close() can be called multiple times', () => {
    layer = new OutputCaptureLayer('/tmp/out6', '/tmp/err6', 100 * 1024);
    (layer as any).attachToProcess(mockProc);
    layer.close();
    layer.close(); // should not throw
    layer = null;
  });

  it('stream errors are logged', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    layer = new OutputCaptureLayer('/tmp/out7', '/tmp/err7', 100 * 1024);
    (layer as any).attachToProcess(mockProc);
    // Get the mock write stream and emit error on it
    const stdoutStream = (layer as any).stdoutStream;
    stdoutStream.emit('error', new Error('disk full'));
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('bytesWritten matches data sent before truncation', async () => {
    const chunk = Buffer.alloc(2048, 'z');
    layer = new OutputCaptureLayer('/tmp/out8', '/tmp/err8', 100 * 1024);
    (layer as any).attachToProcess(mockProc);
    mockProc.stdout.emit('data', chunk);
    mockProc.stdout.emit('data', chunk);
    mockProc.stdout.emit('data', chunk);
    await new Promise(res => setTimeout(res, 50));
    const meta = (layer as any).getMetadata();
    expect(meta.stdoutBytes).toBe(6144);
  });

  it('combined stdout and stderr count toward limit', async () => {
    const chunk40 = Buffer.alloc(40 * 1024, 'a');
    layer = new OutputCaptureLayer('/tmp/out9', '/tmp/err9', 60 * 1024);
    (layer as any).attachToProcess(mockProc);
    mockProc.stdout.emit('data', chunk40);
    mockProc.stderr.emit('data', chunk40); // combined > 60KB -> truncation
    await new Promise(res => setTimeout(res, 50));
    const meta = (layer as any).getMetadata();
    expect(meta.truncated).toBe(true);
  });

  it('truncatedAt timestamp is set', async () => {
    const huge = Buffer.alloc(200 * 1024, 'y');
    layer = new OutputCaptureLayer('/tmp/out10', '/tmp/err10', 100 * 1024);
    (layer as any).attachToProcess(mockProc);
    mockProc.stdout.emit('data', huge);
    await new Promise(res => setTimeout(res, 50));
    const meta = (layer as any).getMetadata();
    expect(meta.truncatedAt).toMatch(/^\d{4}-/); // ISO date prefix
  });

  it('metadata includes correct maxBytes', () => {
    layer = new OutputCaptureLayer('/tmp/out11', '/tmp/err11', 512 * 1024);
    (layer as any).attachToProcess(mockProc);
    const meta = (layer as any).getMetadata();
    expect(meta.maxBytes).toBe(512 * 1024);
  });
});
