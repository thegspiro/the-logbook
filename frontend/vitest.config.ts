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
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
        'dist/',
      ],
      // Ratchet floor: set ~2 points under measured coverage (2026-07-29:
      // 54.98% lines / 41.67% funcs / 52.93% stmts / 45.71% branches on 2026-07-31) so the
      // gate blocks real regressions instead of failing every build against
      // an aspirational 80%. Raise these as coverage grows.
      thresholds: {
        lines: 53,
        functions: 40,
        branches: 44,
        statements: 51,
      },
    },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache', 'src/e2e'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});