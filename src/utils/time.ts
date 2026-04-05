/**
 * Calculate the next run time given an interval spec and a base time.
 */
export function getNextRunTime(
  intervalSpec: string | number,
  from: Date = new Date(),
  timezone?: string
): Date | null {
  const intervalMs = typeof intervalSpec === 'number'
    ? intervalSpec
    : parseIntervalMs(intervalSpec);

  if (intervalMs <= 0) return null;

  return new Date(from.getTime() + intervalMs);
}

function parseIntervalMs(spec: string): number {
  const str = spec.trim().toLowerCase();
  if (str === 'once') return 0;
  // Cron - return default
  if (/^[0-9,/*-]+\s/.test(str) || /^\S+\s+\S+\s/.test(str) || str.startsWith('*')) {
    return 60000;
  }
  // Duration string
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
  return parseInt(spec, 10) || 0;
}
