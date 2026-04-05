import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    exclude: ['dist/**', 'node_modules/**', '.claude/**', 'src/sabotage/**'],
    fileParallelism: false,
    testTimeout: 60000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // Exclude all non-protocol-layer source directories
      exclude: [
        '**/*.test.ts',
        '**/MockDaemon.ts',
        '**/__tests__/**',
        '**/*.d.ts',
        // Non-protocol daemon directories (keep only client and daemon core)
        'src/adapters/**',
        'src/conditions/**',
        'src/convergence/**',
        'src/core/**',
        'src/db/**',
        'src/execution/**',
        'src/finalization/**',
        'src/governance/**',
        'src/leases/**',
        'src/logging/**',
        'src/mcp/**',
        'src/notifications/**',
        'src/parser/**',
        'src/repositories/**',
        'src/utils/**'
        // Note: Do NOT exclude src/daemon/executor.ts, scheduler.ts, DaemonSupervisor.ts — they are part of protocol layer
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 86
      }
    }
  }
});
