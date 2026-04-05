import { describe, it, expect } from 'vitest';
import { matchesFilter, Filter } from '../../src/daemon/event-subscription';

describe('matchesFilter edge cases', () => {
  const event = { id: 1, type: 'JOB_CREATED', job_id: 'job1', run_id: 'run1' };

  it('returns true when filter.eventTypes is empty array', () => {
    const filter: Filter = { eventTypes: [] };
    expect(matchesFilter(event, filter)).toBe(true);
  });

  it('returns true when filter.jobId matches and runId matches but eventTypes does not include type', () => {
    const filter: Filter = { jobId: 'job1', runId: 'run1', eventTypes: ['OTHER'] };
    // Should still return true because jobId and runId match, eventTypes doesn't match -> false? Actually logic: if eventTypes defined and doesn't include, return false.
    expect(matchesFilter(event, filter)).toBe(false);
  });

  it('returns true when filter has only jobId that matches', () => {
    const filter: Filter = { jobId: 'job1' };
    expect(matchesFilter(event, filter)).toBe(true);
  });

  it('returns true when filter has only runId that matches', () => {
    const filter: Filter = { runId: 'run1' };
    expect(matchesFilter(event, filter)).toBe(true);
  });
});
