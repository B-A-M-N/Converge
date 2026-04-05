#!/usr/bin/env node

/**
 * Coverage utility for Phase 26 protocol layer.
 * Runs tests with coverage and asserts thresholds are met.
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function assertCoverage(thresholds = { lines: 90, functions: 90, branches: 90 }) {
  console.log('Running tests with coverage...');
  try {
    // Run vitest with coverage
    execSync('npx vitest run --coverage', { stdio: 'inherit' });
  } catch (err) {
    console.error('Test run failed');
    process.exit(1);
  }

  // Check coverage summary JSON
  const summaryPath = join(process.cwd(), 'coverage', 'coverage-summary.json');
  if (!existsSync(summaryPath)) {
    console.error('Coverage summary not found');
    process.exit(1);
  }

  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const { total } = summary;

  const linesPct = total.lines.pct;
  const funcsPct = total.functions.pct;
  const branchesPct = total.branches.pct;

  console.log(`\nCoverage results:`);
  console.log(`  Lines: ${linesPct}% (threshold: ${thresholds.lines}%)`);
  console.log(`  Functions: ${funcsPct}% (threshold: ${thresholds.functions}%)`);
  console.log(`  Branches: ${branchesPct}% (threshold: ${thresholds.branches}%)`);

  const failures = [];
  if (linesPct < thresholds.lines) failures.push(`lines ${linesPct}% < ${thresholds.lines}%`);
  if (funcsPct < thresholds.functions) failures.push(`functions ${funcsPct}% < ${thresholds.functions}%`);
  if (branchesPct < thresholds.branches) failures.push(`branches ${branchesPct}% < ${thresholds.branches}%`);

  if (failures.length > 0) {
    console.error('\n❌ Coverage thresholds not met:');
    failures.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  }

  console.log('\n✅ All coverage thresholds met');
}

// If run directly
// if (import.meta.url === `file://${process.argv[1]}`) {
//   assertCoverage();
// }

export { assertCoverage };
