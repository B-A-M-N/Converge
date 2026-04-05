import { describe, it, expect } from 'vitest';
import { validateIntervalFloor } from './interval-validator';

describe('validateIntervalFloor', () => {
  const floor = 1000; // 1 second

  describe('duration strings', () => {
    it('accepts interval >= floor', () => {
      expect(validateIntervalFloor('5m', floor).ok).toBe(true);
      expect(validateIntervalFloor('1h', floor).ok).toBe(true);
      expect(validateIntervalFloor('30s', floor).ok).toBe(true); // 30s >= 1s
      expect(validateIntervalFloor('1d', floor).ok).toBe(true);
    });

    it('rejects interval < floor', () => {
      expect(validateIntervalFloor('500ms', floor).ok).toBe(false);
      expect(validateIntervalFloor('100ms', floor).ok).toBe(false);
      expect(validateIntervalFloor('0.5s', floor).ok).toBe(false);
    });

    it('handles edge case exactly at floor', () => {
      expect(validateIntervalFloor('1s', floor).ok).toBe(true);
    });
  });

  describe('object notation', () => {
    it('accepts objects with total >= floor', () => {
      expect(validateIntervalFloor({ seconds: 2 }, floor).ok).toBe(true);
      expect(validateIntervalFloor({ minutes: 1 }, floor).ok).toBe(true);
      expect(validateIntervalFloor({ hours: 1 }, floor).ok).toBe(true);
      expect(validateIntervalFloor({ seconds: 30, minutes: 1 }, floor).ok).toBe(true);
    });

    it('rejects objects with total < floor', () => {
      expect(validateIntervalFloor({ milliseconds: 500 }, floor).ok).toBe(false);
      expect(validateIntervalFloor({ seconds: 0.5 }, floor).ok).toBe(false);
    });

    it('rejects empty objects', () => {
      const result = validateIntervalFloor({}, floor);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/invalid/i);
    });

    it('ignores zero values and computes correctly', () => {
      expect(validateIntervalFloor({ seconds: 1, minutes: 0 }, floor).ok).toBe(true);
    });
  });

  describe('once recurrence', () => {
    it('accepts once as non-recurring', () => {
      expect(validateIntervalFloor('once', floor).ok).toBe(true);
    });
  });

  describe('cron expressions', () => {
    it('accepts cron strings (cannot determine interval, assume valid)', () => {
      expect(validateIntervalFloor('*/5 * * * *', floor).ok).toBe(true);
      expect(validateIntervalFloor('0 0 * * *', floor).ok).toBe(true);
    });
  });

  describe('invalid inputs', () => {
    it('rejects null', () => {
      const result = validateIntervalFloor(null, floor);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/missing|invalid/i);
    });

    it('rejects undefined', () => {
      const result = validateIntervalFloor(undefined, floor);
      expect(result.ok).toBe(false);
    });

    it('rejects non-string non-object types', () => {
      expect(validateIntervalFloor(123 as any, floor).ok).toBe(false);
      expect(validateIntervalFloor(true as any, floor).ok).toBe(false);
      expect(validateIntervalFloor([], floor).ok).toBe(false);
    });

    it('rejects malformed objects with non-numeric values', () => {
      expect(validateIntervalFloor({ seconds: 'abc' } as any, floor).ok).toBe(false);
    });
  });

  describe('boundary conditions', () => {
    it('handles floor = 0 (accepts all intervals)', () => {
      expect(validateIntervalFloor('100ms', 0).ok).toBe(true);
      expect(validateIntervalFloor('1s', 0).ok).toBe(true);
    });

    it('handles very large floor', () => {
      const largeFloor = 24 * 60 * 60 * 1000; // 1 day
      expect(validateIntervalFloor('1d', largeFloor).ok).toBe(true);
      expect(validateIntervalFloor('12h', largeFloor).ok).toBe(false);
    });

    it('handles negative floor (unlikely but returns ok if interval >= negative)', () => {
      const result = validateIntervalFloor('500ms', -1000);
      expect(result.ok).toBe(true);
    });
  });
});

// Property-based style explicit tests (exhaustive coverage)
describe('interval validator exhaustive properties', () => {
  const floor = 1000;

  it('property: intervalMs >= floor always OK', () => {
    const cases: [any, number][] = [
      ['2s', 2000],
      [{ minutes: 1 }, 60000],
      [{ hours: 1 }, 3600000],
    ];
    cases.forEach(([spec, ms]) => {
      const result = validateIntervalFloor(spec, ms);
      expect(result.ok).toBe(true);
    });
  });

  it('property: intervalMs < floor always fails with error containing "below floor"', () => {
    const cases: [any, number][] = [
      ['500ms', 1000],
      [{ milliseconds: 500 }, 1000],
      [{ seconds: 0.5 }, 1000],
    ];
    cases.forEach(([spec, floorVal]) => {
      const result = validateIntervalFloor(spec, floorVal);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/below.*floor/i);
    });
  });
});
