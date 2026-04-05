import type { StopCondition, NormalizedRunOutput } from '../types';

export interface StopConditionResult {
  shouldStop: boolean;
  reason: string;
}

export function evaluateStopCondition(
  condition: StopCondition,
  output: NormalizedRunOutput,
  previousRuns: NormalizedRunOutput[]
): StopConditionResult {
  switch (condition.type) {
    case 'exitCode':
      return evaluateExitCode(condition, output);
    case 'stdoutMatches':
      return evaluateStdoutMatches(condition, output);
    case 'output':
      // Legacy substring match — kept for backward compatibility
      return evaluateOutput(condition, output);
    case 'compound':
      return evaluateCompound(condition, output, previousRuns);
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

function evaluateStdoutMatches(condition: StopCondition, output: NormalizedRunOutput): StopConditionResult {
  const pattern = condition.pattern as string | undefined;
  if (!pattern) {
    return { shouldStop: false, reason: 'stdoutMatches: no pattern provided' };
  }
  try {
    const regex = new RegExp(pattern);
    const matched = regex.test(output.stdout ?? '');
    if (matched) {
      return { shouldStop: true, reason: `Output matches pattern: ${pattern}` };
    }
    return { shouldStop: false, reason: `Output does not match pattern: ${pattern}` };
  } catch {
    return { shouldStop: false, reason: `stdoutMatches: invalid regex pattern: ${pattern}` };
  }
}

function evaluateCompound(
  condition: StopCondition,
  output: NormalizedRunOutput,
  previousRuns: NormalizedRunOutput[]
): StopConditionResult {
  const operator: 'any' | 'all' = condition.operator ?? 'all';
  const conditions: StopCondition[] = condition.conditions ?? [];

  if (conditions.length === 0) {
    return { shouldStop: false, reason: 'compound: no sub-conditions provided' };
  }

  const results = conditions.map((sub: StopCondition) =>
    evaluateStopCondition(sub, output, previousRuns)
  );

  if (operator === 'any') {
    const met = results.find((r) => r.shouldStop);
    if (met) {
      return { shouldStop: true, reason: `compound(any): ${met.reason}` };
    }
    return {
      shouldStop: false,
      reason: `compound(any): no conditions met — ${results.map((r) => r.reason).join('; ')}`,
    };
  }

  // operator === 'all'
  const unmet = results.find((r) => !r.shouldStop);
  if (unmet) {
    return { shouldStop: false, reason: `compound(all): ${unmet.reason}` };
  }
  return {
    shouldStop: true,
    reason: `compound(all): all conditions met — ${results.map((r) => r.reason).join('; ')}`,
  };
}

function evaluateOutput(condition: StopCondition, output: NormalizedRunOutput): StopConditionResult {
  const pattern = condition.pattern as string | undefined;
  if (pattern) {
    const match = (output.stdout ?? '').includes(pattern);
    if (match) {
      return { shouldStop: true, reason: `Output contains: ${pattern}` };
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
