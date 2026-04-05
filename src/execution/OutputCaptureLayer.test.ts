import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { OutputCaptureLayer } from './OutputCaptureLayer';
import EventEmitter = require('events');
import fs from 'fs';

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
    vi.spyOn(fs, 'createWriteStream').mockImplementation(() => createMockWriteStream() as any);
  });

  beforeEach(() => {
    mockProc = createMockProc();
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
    mockProc.stdout.emit('data', chunk50); // 100KB
    mockProc.stdout.emit('data', huge); // exceed
    await new Promise(res => setTimeout(res, 50));
    const meta = (layer as any).getMetadata();
    expect(meta.truncated).toBe(true);
    expect(meta.truncatedAt).not.toBeNull();
    // Bytes written should be not much over the limit
    expect(meta.stdoutBytes).toBeLessThanOrEqual(110 * 1024);
  });

  it('truncation stops further writes', async () => {
    const hugeChunk = Buffer.alloc(200 * 1024, 'z');
    layer = new OutputCaptureLayer('/tmp/out3', '/tmp/err3', 100 * 1024);
    (layer as any).attachToProcess(mockProc);
    mockProc.stdout.emit('data', hugeChunk);
    await new Promise(res => setTimeout(res, 50));
    const meta = (layer as any).getMetadata();
    expect(meta.stdoutBytes).toBeLessThanOrEqual(110 * 1024);
    // Further data should not increase bytes
    const after = meta.stdoutBytes;
    mockProc.stdout.emit('data', Buffer.alloc(100 * 1024, 'z'));
    await new Promise(res => setTimeout(res, 10));
    const meta2 = (layer as any).getMetadata();
    expect(meta2.stdoutBytes).toBe(after);
  });

  it('uses pipe to connect streams', async () => {
    layer = new OutputCaptureLayer('/tmp/out4', '/tmp/err4', 100 * 1024);
    (layer as any).attachToProcess(mockProc);
    await new Promise(res => setTimeout(res, 20));
    expect(mockProc.stdout.pipe).toHaveBeenCalled();
  });

  it('getMetadata returns correct structure', async () => {
    const chunk = Buffer.alloc(512, 'a');
    layer = new OutputCaptureLayer('/tmp/meta', '/tmp/meta2', 100 * 1024);
    (layer as any).attachToProcess(mockProc);
    mockProc.stdout.emit('data', chunk);
    mockProc.stdout.emit('data', chunk);
    await new Promise(res => setTimeout(res, 50));
    const meta = (layer as any).getMetadata();
    expect(meta.stdoutPath).toBe('/tmp/meta');
    expect(meta.stderrPath).toBe('/tmp/meta2');
    expect(meta.stdoutBytes).toBe(1024);
    expect(meta.maxBytes).toBe(100 * 1024);
    expect(meta.truncated).toBe(false);
    expect(meta.truncatedAt).toBeNull();
  });

  it('close() can be called multiple times', () => {
    layer = new OutputCaptureLayer('/tmp/out5', '/tmp/err5', 100 * 1024);
    (layer as any).attachToProcess(mockProc);
    layer!.close();
    expect(() => layer!.close()).not.toThrow();
  });

  it('stream errors are logged', async () => {
    layer = new OutputCaptureLayer('/tmp/out6', '/tmp/err6', 100 * 1024);
    (layer as any).attachToProcess(mockProc);
    // Replace stdoutStream with an error emitter
    const errStream = new EventEmitter() as any;
    errStream.bytesWritten = 0;
    errStream.write = vi.fn().mockReturnValue(true);
    errStream.end = vi.fn();
    (layer as any).stdoutStream = errStream;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    errStream.emit('error', new Error('disk full'));
    await new Promise(res => setTimeout(res, 20));
    expect(consoleSpy).toHaveBeenCalledWith('[OutputCaptureLayer] stdout stream error:', 'disk full');
    consoleSpy.mockRestore();
  });

  it('bytesWritten matches data sent before truncation', async () => {
    const chunk1 = Buffer.alloc(1024, 'a');
    const chunk2 = Buffer.alloc(2048, 'b');
    const chunk3 = Buffer.alloc(3072, 'c');
    layer = new OutputCaptureLayer('/tmp/count', '/tmp/count2', 10 * 1024);
    (layer as any).attachToProcess(mockProc);
    mockProc.stdout.emit('data', chunk1);
    mockProc.stdout.emit('data', chunk2);
    mockProc.stdout.emit('data', chunk3);
    await new Promise(res => setTimeout(res, 50));
    const meta = (layer as any).getMetadata();
    expect(meta.stdoutBytes).toBe(6144);
    expect(meta.truncated).toBe(false);
  });

  it('combined stdout and stderr count toward limit', async () => {
    const chunk60 = Buffer.alloc(60 * 1024, 'x');
    layer = new OutputCaptureLayer('/tmp/out7', '/tmp/err7', 100 * 1024);
    (layer as any).attachToProcess(mockProc);
    mockProc.stdout.emit('data', chunk60);
    mockProc.stderr.emit('data', chunk60);
    await new Promise(res => setTimeout(res, 50));
    const meta = (layer as any).getMetadata();
    expect(meta.truncated).toBe(true);
  });

  it('truncatedAt timestamp is set', async () => {
    const small = Buffer.alloc(10 * 1024, 's');
    const huge = Buffer.alloc(200 * 1024, 'h');
    layer = new OutputCaptureLayer('/tmp/out8', '/tmp/err8', 50 * 1024);
    (layer as any).attachToProcess(mockProc);
    mockProc.stdout.emit('data', small);
    mockProc.stdout.emit('data', small);
    mockProc.stdout.emit('data', huge);
    await new Promise(res => setTimeout(res, 50));
    const meta = (layer as any).getMetadata();
    expect(meta.truncated).toBe(true);
    expect(meta.truncatedAt).not.toBeNull();
  });

  it('metadata includes correct maxBytes', async () => {
    const max = 100 * 1024;
    layer = new OutputCaptureLayer('/tmp/max', '/tmp/max2', max);
    (layer as any).attachToProcess(mockProc);
    await new Promise(res => setTimeout(res, 10));
    const meta = (layer as any).getMetadata();
    expect(meta.maxBytes).toBe(max);
  });
});
