#!/usr/bin/env ts-node

/**
 * Example: Approval gate pattern
 *
 * Waits for an "approval" job to finish with a specific output pattern,
 * then proceeds with the next phase.
 */

import { ConvergeClient } from '../src/client/ConvergeClient';

const APPROVAL_JOB_ID = 'approval-request';
const DEPLOY_JOB_ID = 'deploy-production';

async function isApproved(output: string): Promise<boolean> {
  // Custom logic: check for "APPROVED" in output, or query a database, etc.
  return output.includes('APPROVED');
}

async function main() {
  const client = new ConvergeClient();

  await client.subscribe(
    { jobId: APPROVAL_JOB_ID, eventTypes: ['RUN_FINISHED'] },
    async (event) => {
      const { output, exitCode } = event.payload;

      console.log(`Approval job completed (exit ${exitCode})`);

      if (exitCode === 0 && await isApproved(output)) {
        console.log('✓ Approval received. Starting deployment...');
        try {
          await client.runNow(DEPLOY_JOB_ID, 'approval-gate');
          console.log('✓ Deployment triggered.');
        } catch (err: any) {
          console.error('✗ Failed to trigger deployment:', err.message);
        }
      } else {
        console.log('✗ Approval not granted. Deployment cancelled.');
      }
    }
  );

  console.log('Approval gate watching for completion...');
}

main().catch(console.error);
