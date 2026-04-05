import { describe, it, expect } from 'vitest';
import { ControlPlane } from '../core/ControlPlane';
import { validateNormalizedOutput } from '../adapters/OutputNormalizer';

describe('Trust Boundary Sabotage Test (REQ-3.1 #13)', () => {
  it('should reject path traversal in log path sanitization', () => {
    const sanitize = (ControlPlane as any).sanitizeLogPath.bind(ControlPlane);
    expect(() => sanitize('/tmp/logs', '../../../etc/passwd')).toThrow(/escapes base directory/);
    expect(() => sanitize('/tmp/logs', 'sub/../../etc')).toThrow(/escapes base directory/);
    // Valid subdirectory should not throw
    expect(() => sanitize('/tmp/logs', 'sub/dir')).not.toThrow();
  });

  it('should reject malformed adapter output via OutputNormalizer', () => {
    // Missing required fields (stderr, exitCode) must cause a Zod parse failure
    expect(() => {
      validateNormalizedOutput({ stdout: 'ok' } as any);
    }).toThrow();
  });
});
