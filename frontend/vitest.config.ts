import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      // Without an explicit `include`, Vitest 4 measures only files that a test
      // actually imported. A module with no test at all then contributes nothing
      // to the denominator, so adding one *raises* the reported percentage — the
      // gate cannot see exactly the code that most needs it. On 2026-08-16 that
      // hid 384 of 758 source files (125,519 of 261,081 LOC, 48%) and reported
      // 60.32% lines where the honest figure was 33.10%.
      //
      // Keep this glob in sync with the source tree; it is the denominator.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/',
        'src/test/',
        // Playwright specs are tests, not application source. They are already
        // excluded from the runner below; without this they land in the
        // denominator at 0% and understate the real figure.
        'src/e2e/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
        'dist/',
      ],
      // Ratchet floor: ~2 points under measured coverage so the gate blocks real
      // regressions instead of failing every build against an aspirational 80%.
      // Raise these as coverage grows; never lower them.
      //
      // Measured 2026-08-16 against the corrected denominator above:
      // 33.13% lines / 25.41% funcs / 32.20% stmts / 27.55% branches.
      // The earlier 53/40/44/51 floor was set against the pre-fix denominator
      // and is not comparable — this is the same suite measured honestly, not a
      // regression.
      thresholds: {
        lines: 31,
        functions: 23,
        branches: 25,
        statements: 30,
      },
    },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache', 'src/e2e'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
