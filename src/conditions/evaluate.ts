import type { StopCondition, NormalizedRunOutput } from '../types';

export interface StopConditionResult {
  shouldStop: boolean;
  reason: string;
}

export function evaluateStopCondition(
  condition: StopCondition,
  output: NormalizedRunOutput,
  _previousRuns: NormalizedRunOutput[]
): StopConditionResult {
  switch (condition.type) {
    case 'exitCode':
      return evaluateExitCode(condition, output);
    case 'output':
      return evaluateOutput(condition, output);
    case 'convergence':
      return evaluateConvergence(condition, output);
    default:
      return { shouldStop: false, reason: `Unknown stop condition type: ${condition.type}` };
  }
}

function evaluateExitCode(condition: StopCondition, output: NormalizedRunOutput): StopConditionResult {
  const expectedCode = condition.code ?? 0;
  const actualCode = output.rawExitCode ?? 1;
  if (actualCode === expectedCode) {
    return { shouldStop: true, reason: `Exit code ${actualCode} matches expected ${expectedCode}` };
  }
  return { shouldStop: false, reason: `Exit code ${actualCode} does not match expected ${expectedCode}` };
}

function evaluateOutput(condition: StopCondition, output: NormalizedRunOutput): StopConditionResult {
  const pattern = condition.pattern as string | undefined;
  if (pattern) {
    const match = (output.stdout ?? '').includes(pattern);
    if (match) {
      return { shouldStop: true, reason: `Output matches pattern: ${pattern}` };
    }
  }
  return { shouldStop: false, reason: 'Output condition not met' };
}

function evaluateConvergence(_condition: StopCondition, output: NormalizedRunOutput): StopConditionResult {
  return { shouldStop: false, reason: 'Convergence requires previous runs' };
}

export function detectConvergence(
  output: NormalizedRunOutput,
  previousRuns: NormalizedRunOutput[]
): StopConditionResult {
  if (previousRuns.length < 2) {
    return { shouldStop: false, reason: 'Insufficient previous runs for convergence detection' };
  }
  const last = previousRuns[previousRuns.length - 1];
  if (last.rawExitCode === output.rawExitCode && last.stdout === output.stdout) {
    return { shouldStop: true, reason: 'Output is identical to previous run' };
  }
  return { shouldStop: false, reason: 'Output differs from previous run — not converged' };
}
