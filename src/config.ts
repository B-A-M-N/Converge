const isTest = process.env.NODE_ENV === 'test';

export const LEASE_DURATION_MS = parseInt(
  process.env.LEASE_DURATION_MS || '600000', // 10 minutes
  10
);

export const LEASE_RENEWAL_INTERVAL_MS = parseInt(
  process.env.LEASE_RENEWAL_INTERVAL_MS || '60000', // 1 minute
  10
);

export const LEASE_RENEWAL_EXTENSION_MS = parseInt(
  process.env.LEASE_RENEWAL_EXTENSION_MS || '300000', // 5 minutes
  10
);

if (!isTest && LEASE_RENEWAL_INTERVAL_MS >= LEASE_DURATION_MS) {
  throw new Error(
    'LEASE_RENEWAL_INTERVAL_MS must be less than LEASE_DURATION_MS'
  );
}
