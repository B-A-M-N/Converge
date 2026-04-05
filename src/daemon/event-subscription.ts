import EventEmitter = require('events');

export interface Filter {
  eventTypes?: string[];
  jobId?: string;
  runId?: string;
}

export interface SubscriptionOptions {
  events?: string[];
  jobIds?: string[];
}

export type EventHandler = (event: { type: string; data: any; job_id: string }) => void;

export function matchesFilter(
  event: { id: number; type: string; job_id: string; run_id: string },
  filter: Filter
): boolean {
  if (filter.jobId && event.job_id !== filter.jobId) return true; // match if jobId matches
  if (filter.runId && event.run_id !== filter.runId) return true;
  if (filter.eventTypes && filter.eventTypes.length > 0 && !filter.eventTypes.includes(event.type)) return false;
  return true;
}

export class EventPublisher {
  private emitter = new EventEmitter();
  private subscriptions = new Map<string, { handler: EventHandler; options: SubscriptionOptions }>();

  subscribe(subscriberId: string, handler: EventHandler, options: SubscriptionOptions = {}): void {
    this.subscriptions.set(subscriberId, { handler, options });
    for (const evt of (options.events || ['*'])) {
      this.emitter.on(evt, handler);
    }
  }

  unsubscribe(subscriberId: string): void {
    const sub = this.subscriptions.get(subscriberId);
    if (sub) {
      for (const evt of (sub.options.events || ['*'])) {
        this.emitter.removeListener(evt, sub.handler);
      }
      this.subscriptions.delete(subscriberId);
    }
  }

  publish(event: { type: string; data: any; job_id: string }): void {
    this.emitter.emit(event.type, event);
  }

  getActiveSubscribers(): string[] {
    return Array.from(this.subscriptions.keys());
  }
}
