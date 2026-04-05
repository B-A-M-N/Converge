export interface IntervalValidationResult {
  ok: boolean;
  error?: string;
}

export const MINIMUM_INTERVAL_FLOOR_MS = 1000; // Default 1 second

export function intervalSpecToMs(spec: any): number {
  if (typeof spec === 'number') return spec;
  if (typeof spec === 'string') {
    const str = spec.trim().toLowerCase();
    if (str === 'once') return 0;
    // Duration string parsing
    const durationRegex = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?(?:(\d+)ms)?$/;
    const match = str.match(durationRegex);
    if (match) {
      const [, d, h, m, s, ms] = match;
      return (
        (parseInt(d || '0', 10) * 24 * 60 * 60 * 1000) +
        (parseInt(h || '0', 10) * 60 * 60 * 1000) +
        (parseInt(m || '0', 10) * 60 * 1000) +
        (parseInt(s || '0', 10) * 1000) +
        parseInt(ms || '0', 10)
      );
    }
    // Cron expression - return sentinel
    if (str.startsWith('*') || /^[0-9,/*-]+\s/.test(str) || /^\S+\s+\S+\s/.test(str)) {
      return 60000; // Default 1 min for unknown cron intervals
    }
    return parseInt(str, 10) || 0;
  }
  if (typeof spec === 'object' && spec !== null) {
    return (
      ((spec.milliseconds ?? 0) as number) +
      (((spec.seconds ?? 0) as number) * 1000) +
      (((spec.minutes ?? 0) as number) * 60 * 1000) +
      (((spec.hours ?? 0) as number) * 60 * 60 * 1000) +
      (((spec.days ?? 0) as number) * 24 * 60 * 60 * 1000)
    );
  }
  return 0;
}

export function validateIntervalFloor(spec: any, floorMs: number = MINIMUM_INTERVAL_FLOOR_MS): IntervalValidationResult {
  if (spec === null || spec === undefined) {
    return { ok: false, error: 'Interval is missing or invalid' };
  }

  if (typeof spec === 'string') {
    const str = spec.trim().toLowerCase();
    if (str === 'once') return { ok: true };
    // Cron expressions - cannot determine exact interval, assume valid
    if (/^[0-9,/*-]+\s/.test(str) || /^\S+\s+\S+\s/.test(str) || str.startsWith('*')) {
      return { ok: true };
    }
    const ms = intervalSpecToMs(spec);
    if (ms === 0) {
      return { ok: false, error: `Interval below floor: ${spec} (0ms < ${floorMs}ms)` };
    }
    if (ms < floorMs) {
      return { ok: false, error: `Interval below floor: ${ms}ms < ${floorMs}ms` };
    }
    return { ok: true };
  }

  if (typeof spec === 'object') {
    const ms = intervalSpecToMs(spec);
    if (ms === 0) {
      const hasAnyValue = Object.values(spec).some((v: any) => v !== 0);
      if (!hasAnyValue) {
        return { ok: false, error: 'Interval is missing or invalid (empty object)' };
      }
      return { ok: false, error: `Interval below floor: 0ms < ${floorMs}ms` };
    }
    // Validate numeric values in object
    for (const [, value] of Object.entries(spec)) {
      if (value !== null && typeof value !== 'number') {
        return { ok: false, error: 'Interval below floor: invalid numeric value in object' };
      }
    }
    if (ms < floorMs) {
      return { ok: false, error: `Interval below floor: ${ms}ms < ${floorMs}ms` };
    }
    return { ok: true };
  }

  return { ok: false, error: 'Interval below floor: invalid input type' };
}
