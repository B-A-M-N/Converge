import { z } from 'zod';
import { describe, it, expect } from 'vitest';
import {
  normalizedRunOutputSchema,
  validateNormalizedOutput,
  extractMarkers,
  extractFilesChanged,
  extractJSONBlocks,
  extractSessionId,
} from './OutputNormalizer';

describe('OutputNormalizer', () => {
  describe('Zod Schema', () => {
    it('requires rawExitCode, stdout, stderr', () => {
      const result = normalizedRunOutputSchema.safeParse({
        stdout: 'test',
        stderr: '',
      });
      expect(result.success).toBe(false);
      expect(Object.keys((result.error! as any).format().rawExitCode ?? {})).toHaveLength(1);
    });

    it('applies default sentinels for optional fields when omitted', () => {
      const result = normalizedRunOutputSchema.parse({
        rawExitCode: 0,
        stdout: 'test',
        stderr: '',
      });
      expect(result.assistantSummary).toBe('unknown');
      expect(result.sessionId).toBeNull();
      expect(result.markers).toEqual([]);
      expect(result.filesChanged).toEqual([]);
      expect(result.retrySuggested).toBe(false);
      expect(result.successSuggested).toBe(false);
    });
  });

  describe('validateNormalizedOutput', () => {
    it('returns fully-populated NormalizedRunOutput with defaults', () => {
      const result = validateNormalizedOutput({
        stdout: 'test',
        stderr: '',
        exitCode: 0,
      });
      expect(result).toMatchObject({
        rawExitCode: 0,
        stdout: 'test',
        stderr: '',
        assistantSummary: 'unknown',
        sessionId: null,
        markers: [],
        filesChanged: [],
        retrySuggested: false,
        successSuggested: false,
      });
    });

    it('extracts markers from stdout', () => {
      const result = validateNormalizedOutput({
        stdout: 'Some output [CONTINUE] more [STOP] end',
        stderr: '',
        exitCode: 0,
      });
      expect(result.markers).toContain('[CONTINUE]');
      expect(result.markers).toContain('[STOP]');
    });

    it('extracts files changed from "Files changed:" blocks', () => {
      const stdout = `Output
Files changed:
src/file1.ts
src/file2.ts

More text`;
      const result = validateNormalizedOutput({
        stdout,
        stderr: '',
        exitCode: 0,
      });
      expect(result.filesChanged).toContain('src/file1.ts');
      expect(result.filesChanged).toContain('src/file2.ts');
    });

    it('extracts JSON blocks from stdout', () => {
      const stdout = `Before
\`\`\`json
{"summary": "test summary", "data": 123}
\`\`\`
After`;
      const result = validateNormalizedOutput({
        stdout,
        stderr: '',
        exitCode: 0,
      });
      const jsonBlocks = extractJSONBlocks(stdout);
      expect(jsonBlocks).toHaveLength(1);
      expect(jsonBlocks[0].summary).toBe('test summary');
    });

    it('extracts session ID from stdout', () => {
      const stdout = 'Session ID: abc-123-def';
      const result = validateNormalizedOutput({
        stdout,
        stderr: '',
        exitCode: 0,
      });
      expect(result.sessionId).toBe('abc-123-def');
    });

    it('sets retrySuggested and successSuggested based on markers and exitCode', () => {
      const result1 = validateNormalizedOutput({
        stdout: '[RETRY]',
        stderr: '',
        exitCode: 1,
      });
      expect(result1.retrySuggested).toBe(true);

      const result2 = validateNormalizedOutput({
        stdout: '[CONTINUE]',
        stderr: '',
        exitCode: 0,
      });
      expect(result2.successSuggested).toBe(true);
    });
  });
});
