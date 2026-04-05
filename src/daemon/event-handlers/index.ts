/// <reference types="node" />
import EventEmitter = require('events');

export class DaemonEventEmitter extends EventEmitter {
  emitJobCreated(jobId: string): void { this.emit('job.created', { jobId }); }
  emitJobStateTransition(jobId: string, from: string, to: string): void { this.emit('job.state.transition', { jobId, from, to }); }
  emitJobRunStart(runId: string, jobId: string): void { this.emit('job.run.start', { runId, jobId }); }
  emitJobRunEnd(runId: string, jobId: string, exitCode: number): void { this.emit('job.run.end', { runId, jobId, exitCode }); }
}

export function createEventHandlerRouter(): EventEmitter {
  return new EventEmitter();
}
