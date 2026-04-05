import { EventRepository } from '../repositories/EventRepository';
import type { Job } from '../types';

export class StructuredEventEmitter {
  static jobCreated(job: Job): void {
    try {
      EventRepository.insert({
        job_id: job.id,
        event_type: 'job_created',
        actor_id: 'system',
        timestamp: new Date().toISOString(),
        metadata: JSON.stringify({ cli: job.cli, interval: job.interval_spec }),
      });
    } catch (e) {
      // Events are non-critical; log but don't fail
      console.error('[StructuredEventEmitter] Failed to emit job_created:', e);
    }
  }
}
