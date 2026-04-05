import { z } from 'zod';

// Sentinel constants
const SENTINEL_SUMMARY = 'unknown';
const SENTINEL_SESSION: string | null = null;
const SENTINEL_ARRAY: string[] = [];
const SENTINEL_BOOL = false;

// Zod schema for NormalizedRunOutput with defaults
export const normalizedRunOutputSchema = z.object({
  rawExitCode: z.number().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  assistantSummary: z.string().optional().default(SENTINEL_SUMMARY),
  sessionId: z.string().nullable().optional(),
  markers: z.array(z.string()).optional().default(SENTINEL_ARRAY),
  filesChanged: z.array(z.string()).optional().default(SENTINEL_ARRAY),
  retrySuggested: z.boolean().optional().default(SENTINEL_BOOL),
  successSuggested: z.boolean().optional().default(SENTINEL_BOOL),
});

// Export inferred type
export type NormalizedRunOutput = z.infer<typeof normalizedRunOutputSchema>;

// Helper functions (pure, deterministic)
export function extractMarkers(stdout: string): string[] {
  const markerRegex = /\[(CONTINUE|STOP|RETRY|ASYNC)\]/g;
  const found: string[] = [];
  let match;
  while ((match = markerRegex.exec(stdout)) !== null) {
    found.push(match[0]);
  }
  return found;
}

export function extractFilesChanged(stdout: string): string[] {
  const fileRegex = /Files changed:\n((?:.*\n)+?)(?=\n|$)/;
  const match = stdout.match(fileRegex);
  if (!match) return [];
  const lines = match[1]
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines;
}

export function extractJSONBlocks(stdout: string): Record<string, unknown>[] {
  const jsonRegex = /```json\n([\s\S]*?)\n```/g;
  const blocks: Record<string, unknown>[] = [];
  let m;
  while ((m = jsonRegex.exec(stdout)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (typeof parsed === 'object' && parsed !== null) {
        blocks.push(parsed);
      }
    } catch {
      // ignore parse errors
    }
  }
  return blocks;
}

export function extractSessionId(stdout: string): string | null {
  const sessionRegex = /session[_-]?id[:\s]+([a-zA-Z0-9_-]+)/i;
  const match = stdout.match(sessionRegex);
  return match ? match[1] : null;
}

// Main validator
export function validateNormalizedOutput(
  input: { stdout?: string; stderr?: string; exitCode?: number | null },
  extracted?: Partial<NormalizedRunOutput>,
): NormalizedRunOutput {
  const base = {
    rawExitCode: input.exitCode,
    stdout: input.stdout,
    stderr: input.stderr,
  };

  // Extract additional fields from stdout
  const markers = extractMarkers(input.stdout ?? "");
  const files = extractFilesChanged(input.stdout ?? "");
  const sessionId = extractSessionId(input.stdout ?? "");

  // Try to extract summary from JSON blocks
  const jsonBlocks = extractJSONBlocks(input.stdout ?? "");
  const summaryBlock = jsonBlocks.find((b) => 'summary' in b);
  const assistantSummary = summaryBlock?.summary as string | undefined;

  // Apply zod defaults by parsing through schema
  return normalizedRunOutputSchema.parse({
    ...base,
    assistantSummary,
    markers,
    filesChanged: files,
    sessionId,
    retrySuggested: markers.includes('[RETRY]'),
    successSuggested: markers.includes('[CONTINUE]') && input.exitCode === 0,
    ...extracted,
  });
}
