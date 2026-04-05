import { describe, it } from 'vitest';
import { execSync } from 'child_process';

describe('Unused Component Sabotage Test (REQ-3.1 #12)', () => {
  it('should have zero unused locals/parameters (tsc noUnusedLocals passes)', () => {
    // tsconfig.json enforces noUnusedLocals and noUnusedParameters.
    // tsc --noEmit failing here means dead code was introduced.
    try {
      execSync('npx tsc --noEmit', { cwd: process.cwd(), stdio: 'pipe' });
    } catch (err: any) {
      const output = err.stdout?.toString() || err.stderr?.toString() || err.message;
      throw new Error(`TypeScript found unused code (noUnusedLocals/noUnusedParameters). Output:\n${output}`);
    }
  });
});
