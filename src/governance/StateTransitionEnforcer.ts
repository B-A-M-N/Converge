import EventEmitter = require('events');

export class StateTransitionEnforcer extends EventEmitter {
  enforce(jobId: string, from: string, to: string, reason?: string): boolean {
    this.emit('transition', { jobId, from, to, reason });
    return true;
  }

  static validate(from: string, to: string): boolean {
    const validTransitions: Record<string, string[]> = {
      'pending': ['active', 'cancelled'],
      'active': ['completed', 'paused', 'failed', 'cancelled'],
      'paused': ['active', 'cancelled'],
      'completed': [],
      'failed': ['active', 'paused'],
      'cancelled': [],
    };
    return (validTransitions[from] || []).includes(to);
  }
}
