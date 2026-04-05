// Environment overrides MUST come before any imports that use config
process.env.NODE_ENV = 'test';
const leaseDurationSec = parseInt(process.argv[2] || '2', 10);
process.env.LEASE_DURATION_MS = `${leaseDurationSec * 1000}`;
process.env.LEASE_RENEWAL_INTERVAL_MS = '60000'; // 60s > lease to force expiry

import { ControlPlane } from '../../core/ControlPlane';
import { JobRepository } from '../../repositories/JobRepository';
import { RunRepository } from '../../repositories/RunRepository';
import { registerAdapter } from '../../adapters/registry';
import { db } from '../../db/sqlite';
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import { StartRunInput, NormalizeOutputInput } from '../../types';

// Define a long-running test adapter
const slowAdapter = {
  name: 'slow-contestant',
  detect: async () => ({ isAvailable: true }),
  startRun: async (input: StartRunInput) => {
    // Run for 15 seconds to exceed lease expiry (2s lease)
    await new Promise(resolve => setTimeout(resolve, 15000));
    return { exitCode: 0, pid: process.pid };
  },
  resumeRun: async (input: any) => ({ exitCode: 0 }),
  cancelRun: async (input: any) => ({ success: true }),
  normalizeOutput: async (input: NormalizeOutputInput) => ({
    rawExitCode: input.exitCode ?? null,
    stdout: input.stdout ?? '',
    stderr: input.stderr ?? '',
    assistantSummary: 'unknown',
    sessionId: null,
    markers: [],
    filesChanged: [],
    retrySuggested: false,
    successSuggested: false,
  }),
};

registerAdapter(slowAdapter);

async function main() {
  if (process.argv.length < 4) {
    console.error('Usage: collision-contestant.ts <jobId> <barrierPath>');
    process.exit(1);
  }

  const jobId = process.argv[2];
  const barrierPath = process.argv[3];

  // Wait for barrier file to exist (simple polling)
  for (let i = 0; i < 100; i++) {
    try {
      await fs.access(barrierPath);
      break; // Barrier released
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Capture runs before dispatch
  const runsBefore = RunRepository.getByJob(jobId);

  // Dispatch the job
  await ControlPlane.dispatch(jobId);

  // Capture runs after dispatch
  const runsAfter = RunRepository.getByJob(jobId);

  // Determine if we created a new run
  const newRun = runsAfter.find(r => !runsBefore.some(b => b.id === r.id));

  const result = {
    success: !!newRun,
    runId: newRun?.id ?? null,
    reason: newRun ? 'started' : 'collision-skip',
  };

  console.log(JSON.stringify(result));
  process.exit(0);
}

main().catch(err => {
  console.error('Contestant error:', err);
  process.exit(1);
});
