import * as fs from 'fs';
import type { ChildProcess } from 'child_process';
import { CaptureMetadata } from '../types';

export class OutputCaptureLayer {
  private stdoutStream: fs.WriteStream | null = null;
  private stderrStream: fs.WriteStream | null = null;
  private stdoutBytes = 0;
  private stderrBytes = 0;
  private readBytes = 0;  // Track how much we've read from the pipe
  private truncated = false;
  private truncationReason: 'stdout' | 'stderr' | null = null;
  private truncationTimestamp: string | null = null;

  constructor(
    private stdoutPath: string,
    private stderrPath: string,
    private maxBytes: number = 100 * 1024 * 1024  // 100 MB default
  ) {}

  attachToProcess(proc: ChildProcess): void {
    // Create write streams with reasonable highWaterMark
    const streamOptions = { highWaterMark: 64 * 1024 };  // 64 KB buffer

    this.stdoutStream = fs.createWriteStream(this.stdoutPath, streamOptions);
    this.stderrStream = fs.createWriteStream(this.stderrPath, streamOptions);

    // Pipe stdout with backpressure handling
    if (proc.stdout) {
      proc.stdout.on('data', (chunk: Buffer) => {
        this.readBytes += chunk.length;
        if (!this.truncated && this.readBytes > this.maxBytes) {
          // Truncate: stop writing, close stream
          this.handleTruncation('stdout');
        }
      });

      // Only pipe if not truncated
      const pipeStdout = () => {
        if (!this.truncated) {
          proc.stdout!.pipe(this.stdoutStream!);
        }
      };
      // Delay pipe until next tick to intercept potential highWaterMark issues
      setImmediate(pipeStdout);
    }

    // Pipe stderr similarly
    if (proc.stderr) {
      proc.stderr.on('data', (chunk: Buffer) => {
        this.readBytes += chunk.length;
        if (!this.truncated && this.readBytes > this.maxBytes) {
          this.handleTruncation('stderr');
        }
      });

      const pipeStderr = () => {
        if (!this.truncated) {
          proc.stderr!.pipe(this.stderrStream!);
        }
      };
      setImmediate(pipeStderr);
    }

    // Handle stream finish/close
    const onFinish = () => {
      this.stdoutBytes = this.stdoutStream?.bytesWritten || 0;
      this.stderrBytes = this.stderrStream?.bytesWritten || 0;
    };

    this.stdoutStream.on('finish', onFinish);
    this.stderrStream.on('finish', onFinish);

    // Error handling: if write fails (e.g., disk full), log but don't crash
    this.stdoutStream.on('error', (err) => {
      console.error('[OutputCaptureLayer] stdout stream error:', err.message);
    });
    this.stderrStream.on('error', (err) => {
      console.error('[OutputCaptureLayer] stderr stream error:', err.message);
    });
  }

  private handleTruncation(source: 'stdout' | 'stderr'): void {
    this.truncated = true;
    this.truncationReason = source;
    this.truncationTimestamp = new Date().toISOString();

    // Close streams to stop writing
    if (this.stdoutStream) {
      this.stdoutStream.end();
    }
    if (this.stderrStream) {
      this.stderrStream.end();
    }

    // Log truncation event for audit
    console.error(`[OutputCaptureLayer] Output truncated at ${this.maxBytes} bytes (from ${source})`);
  }

  getMetadata(): CaptureMetadata {
    return {
      stdoutPath: this.stdoutPath,
      stderrPath: this.stderrPath,
      stdoutBytes: this.stdoutStream?.bytesWritten || 0,
      stderrBytes: this.stderrStream?.bytesWritten || 0,
      maxBytes: this.maxBytes,
      truncated: this.truncated,
      truncatedAt: this.truncationTimestamp
    };
  }

  close(): void {
    if (this.stdoutStream) {
      this.stdoutStream.end();
      this.stdoutStream = null;
    }
    if (this.stderrStream) {
      this.stderrStream.end();
      this.stderrStream = null;
    }
  }
}
