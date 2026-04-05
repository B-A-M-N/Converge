import type { StopCondition, NormalizedRunOutput, ConvergenceMode, ExecutionKind, JobState } from '../types';

export interface StopConditionResult {
  shouldStop: boolean;
  reason: string;
}

export interface ConvergencePolicy {
  mode: ConvergenceMode;
  kind: ExecutionKind;
}

/**
 * Returned by detectConvergence.
 * nextState: the state the job should move to, or null if no convergence action.
 *   - 'repeat_detected':       identical output observed; below candidacy threshold
 *   - 'convergence_candidate': streak meets candidacy; one confirming run away from pause
 *   - 'paused':                confirmed convergence; auto-pause
 *   - 'active':                diverging run — reset convergence state back to active
 *   - null:                    no change (insufficient data or disabled)
 */
export interface ConvergenceTransition {
  nextState: Extract<JobState, 'active' | 'repeat_detected' | 'convergence_candidate' | 'paused'> | null;
  reason: string;
}

/**
 * Per-mode streak thresholds for the three-stage state machine:
 *   active → repeat_detected → convergence_candidate → paused
 *
 * repeat:    identical-run streak to enter repeat_detected (from active)
 * candidate: streak to enter convergence_candidate
 * confirm:   streak to auto-pause (from convergence_candidate + 1 confirming run)
 */
interface ConvergenceThresholds {
  minTotalRuns: number;
  repeat: number;
  candidate: number;
  confirm: number;
}

const THRESHOLDS: Record<ConvergenceMode, ConvergenceThresholds> = {
  aggressive:   { minTotalRuns: 2, repeat: 2, candidate: 3, confirm: 4 },
  normal:       { minTotalRuns: 4, repeat: 2, candidate: 3, confirm: 4 },
  conservative: { minTotalRuns: 6, repeat: 3, candidate: 5, confirm: 7 },
  disabled:     { minTotalRuns: Infinity, repeat: Infinity, candidate: Infinity, confirm: Infinity },
};

/** Normalize output for material comparison — trims whitespace, ignores cosmetic differences. */
function materialSignature(run: NormalizedRunOutput): string {
  const stdout = (run.stdout ?? '').trim().replace(/\r\n/g, '\n');
  const exitCode = run.rawExitCode ?? 0;
  const hasFileChanges = (run.filesChanged?.length ?? 0) > 0 ? 1 : 0;
  return `${exitCode}|${hasFileChanges}|${stdout}`;
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

function evaluateConvergence(_condition: StopCondition, _output: NormalizedRunOutput): StopConditionResult {
  return { shouldStop: false, reason: 'Convergence requires previous runs' };
}

/**
 * Three-stage convergence state machine.
 *
 * Given the job's current state, the latest run output, and run history, returns
 * the next state the job should transition to — or null if no change is needed.
 *
 * State progression (identical runs):
 *   active → repeat_detected → convergence_candidate → paused
 *
 * On any diverging run from repeat_detected or convergence_candidate:
 *   → active (reset)
 */
export function detectConvergence(
  currentJobState: JobState,
  output: NormalizedRunOutput,
  previousRuns: NormalizedRunOutput[],
  policy: ConvergencePolicy = { mode: 'normal', kind: 'general' }
): ConvergenceTransition {
  // polling and external-stateful: sameness now ≠ sameness later
  if (policy.kind === 'polling' || policy.kind === 'external-stateful') {
    return { nextState: null, reason: `Convergence suppressed for ${policy.kind} jobs` };
  }

  const thresholds = THRESHOLDS[policy.mode];
  const totalRuns = previousRuns.length + 1;

  if (totalRuns < thresholds.minTotalRuns) {
    return { nextState: null, reason: `Below minimum run floor (${totalRuns}/${thresholds.minTotalRuns})` };
  }

  // Count trailing streak of materially identical runs (including current)
  const currentSig = materialSignature(output);
  let streak = 1;
  for (let i = previousRuns.length - 1; i >= 0; i--) {
    if (materialSignature(previousRuns[i]) === currentSig) {
      streak++;
    } else {
      break;
    }
  }

  const isDiverging = streak === 1 && (
    currentJobState === 'repeat_detected' || currentJobState === 'convergence_candidate'
  );

  // Diverging run resets convergence state
  if (isDiverging) {
    return {
      nextState: 'active',
      reason: `Diverging run detected — convergence state reset (was: ${currentJobState})`,
    };
  }

  // State machine promotions
  if (currentJobState === 'convergence_candidate' && streak >= thresholds.confirm) {
    return {
      nextState: 'paused',
      reason:
        `Convergence confirmed: ${streak} consecutive materially identical runs ` +
        `across ${totalRuns} total (mode: ${policy.mode}, kind: ${policy.kind}). ` +
        `No output delta, no artifact delta.`,
    };
  }

  if ((currentJobState === 'active' || currentJobState === 'repeat_detected') && streak >= thresholds.candidate) {
    return {
      nextState: 'convergence_candidate',
      reason: `Convergence candidate: ${streak} identical runs — one confirming run away from auto-pause`,
    };
  }

  if (currentJobState === 'active' && streak >= thresholds.repeat) {
    return {
      nextState: 'repeat_detected',
      reason: `Repeat detected: ${streak} consecutive identical runs (${streak}/${thresholds.candidate} for candidacy)`,
    };
  }

  return { nextState: null, reason: 'No convergence signal' };
}
