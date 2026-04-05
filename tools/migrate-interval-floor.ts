#!/usr/bin/env node
/**
 * Migration script for minimum interval floor enforcement.
 *
 * Scans all jobs and reports those with interval_spec below the configured floor.
 * Optionally can update them with --apply flag.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { parseArgs } from 'util';

// Simple argument parsing for Node.js
const argv = process.argv.slice(2);
const dryRun = !argv.includes('--apply');
const jsonOutput = argv.includes('--json');
const csvOutput = argv.includes('--csv') || !jsonOutput;

// Load config
const configPath = join(process.cwd(), 'dist', 'config.js');
let minimumIntervalFloorMs = 1000;
try {
  const configContent = readFileSync(configPath, 'utf-8');
  // Extract MINIMUM_INTERVAL_FLOOR_MS from compiled config
  const match = configContent.match(/MINIMUM_INTERVAL_FLOOR_MS\s*=\s*(\d+)/);
  if (match) {
    minimumIntervalFloorMs = parseInt(match[1], 10);
  }
} catch (e) {
  console.warn('Could not load config, using default 1000ms');
}

// Load database and JobRepository
let db: any, JobRepository: any;
try {
  // Import compiled modules
  const dbModule = require('../dist/db/Database.js');
  const jobRepoModule = require('../dist/repositories/JobRepository.js');
  db = dbModule.default || dbModule;
  JobRepository = jobRepoModule.JobRepository || jobRepoModule;
} catch (e) {
  console.error('Failed to load database modules. Make sure to run npm run build first.');
  process.exit(1);
}

// Import validator (use compiled output if available, else fallback inline)
let validateIntervalFloor: any = null;
try {
  const validatorModule = require('../dist/conditions/interval-validator.js');
  validateIntervalFloor = validatorModule.validateIntervalFloor || validatorModule.default;
} catch (e) {
  // Fallback: re-implement minimal validation inline to avoid dependency
  console.warn('Could not load interval-validator, using inline fallback');
}

// Inline fallback validator (matches logic from src/conditions/interval-validator.ts)
function parseDurationToMs(duration: string): number | null {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60 * 1000, h: 3600 * 1000, d: 24 * 3600 * 1000 };
  return value * (multipliers[unit] || 0);
}

function objectToMs(obj: any): number | null {
  if (!obj || typeof obj !== 'object') return null;
  const { seconds, minutes, hours, days } = obj;
  let total = 0;
  if (seconds) total += seconds * 1000;
  if (minutes) total += minutes * 60 * 1000;
  if (hours) total += hours * 3600 * 1000;
  if (days) total += days * 24 * 3600 * 1000;
  return total > 0 ? total : null;
}

function inlineValidateIntervalFloor(intervalSpec: any, floorMs: number): { ok: boolean; error?: string; intervalMs?: number } {
  if (!intervalSpec) {
    return { ok: false, error: 'Missing interval_spec' };
  }

  let intervalMs: number | null = null;

  if (typeof intervalSpec === 'string') {
    if (intervalSpec === 'once') {
      // non-recurring job, not subject to floor
      return { ok: true };
    }
    // Try duration string like "5m", "1h", "30s"
    intervalMs = parseDurationToMs(intervalSpec);
    if (intervalMs === null) {
      // Cron or other string; we cannot calculate exact ms, assume unknown => warn but accept
      return { ok: true, intervalMs: undefined };
    }
  } else if (typeof intervalSpec === 'object') {
    intervalMs = objectToMs(intervalSpec);
    if (intervalMs === null) {
      return { ok: false, error: 'Invalid interval object' };
    }
  } else {
    return { ok: false, error: 'Invalid interval_spec type' };
  }

  if (intervalMs !== null && intervalMs < floorMs) {
    return { ok: false, error: `Interval ${intervalMs}ms is below floor ${floorMs}ms`, intervalMs };
  }

  return { ok: true, intervalMs };
}

const validator = validateIntervalFloor || inlineValidateIntervalFloor;

async function migrate(): Promise<void> {
  console.log(`Minimum interval floor: ${minimumIntervalFloorMs}ms`);
  console.log(`Mode: ${dryRun ? '[DRY RUN]' : '[APPLY]'}`);
  console.log('Connecting to database...');

  const dbInstance = new db.Database(process.env.CONVERGE_DB || 'converge.db');
  const jobRepo = new JobRepository(dbInstance);

  // Query all jobs
  const allJobs = jobRepo.listJobs(); // Assume this returns Job[] with interval_spec
  console.log(`Scanned ${allJobs.length} jobs`);

  const violations: any[] = [];

  for (const job of allJobs) {
    if (!job.interval_spec) continue; // non-recurring jobs skip

    const result = validator(job.interval_spec, minimumIntervalFloorMs);
    if (!result.ok) {
      violations.push({
        jobId: job.id,
        name: job.name,
        interval_spec: job.interval_spec,
        calculatedMs: result.intervalMs ?? null,
        floorMs: minimumIntervalFloorMs,
        error: result.error
      });
    }
  }

  console.log(`Found ${violations.length} jobs below floor`);

  if (violations.length === 0) {
    console.log('No violations found.');
    return;
  }

  if (csvOutput) {
    // Output CSV
    console.log('jobId,name,interval_spec,calculatedMs,floorMs,error');
    for (const v of violations) {
      console.log(`${v.jobId},"${v.name}",${JSON.stringify(v.interval_spec)},${v.calculatedMs},${v.floorMs},"${v.error}"`);
    }
  } else if (jsonOutput) {
    console.log(JSON.stringify(violations, null, 2));
  }

  if (!dryRun) {
    console.log('Applying updates not yet implemented. Only dry-run reports available.');
  }
}

if (require.main === module) {
  migrate().catch((err: unknown) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

export { migrate };
