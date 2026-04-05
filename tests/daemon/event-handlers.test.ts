import { describe, it, expect } from 'vitest';
import { createEventHandlerRouter } from '../../src/daemon/event-handlers';

describe('event-handlers', () => {
  it('createEventHandlerRouter returns a router', () => {
    const router = createEventHandlerRouter();
    expect(router).toBeDefined();
  });

  it('router has emit method', () => {
    const router = createEventHandlerRouter();
    expect((router as any).emit).toBeDefined();
  });
});
