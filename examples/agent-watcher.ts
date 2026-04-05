#!/usr/bin/env ts-node

/**
 * Example: Agent-triggered workflow
 *
 * Watches a job and triggers another when conditions are met.
 * Run with: npx ts-node examples/agent-watcher.ts
 */

import { ConvergeClient } from '../src/client/ConvergeClient';

const WATCHED_JOB_ID = 'YOUR_JOB_ID_HERE';
const TRIGGER_JOB_ID = 'YOUR_TRIGGER_JOB_ID_HERE';

async function main() {
  const client = new ConvergeClient();

  // Listen to all events (optional: for logging)
  client.onEvent((event) => {
    console.log(`[${event.eventType}] job=${event.job_id} run=${event.run_id}`);
  });

  // Subscribe to RUN_FINISHED events for the watched job
  await client.subscribe(
    { jobId: WATCHED_JOB_ID, eventTypes: ['RUN_FINISHED'] },
    async (event) => {
      const { exitCode, output } = event.payload;

      console.log(`Watched job finished with exit code ${exitCode}`);

      // Trigger condition: run succeeded
      if (exitCode === 0) {
        console.log('→ Triggering downstream job...');
        try {
          const result = await client.runNow(TRIGGER_JOB_ID, 'watcher-agent');
          console.log(`→ Triggered: ${result.runId}`);
        } catch (err: any) {
          console.error('→ Failed to trigger:', err.message);
        }
      }
    }
  );

  console.log('Watcher started. Press Ctrl+C to exit.');
}

main().catch(console.error);
