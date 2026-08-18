import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Runner config for the Stryker mutation pilot (see TESTING.md).
 *
 * Why this exists: against the full suite, Stryker's dry run executes all ~4,000
 * tests for every mutant and times out before the first one completes. Narrowing
 * the runner to the pilot's own test files keeps a run to minutes.
 *
 * INVARIANT — this list must contain the tests for EVERY file that can be
 * mutated, not just the ones currently in `stryker.pilot.json`'s `mutate`
 * array. TESTING.md documents a single-file override
 * (`npx stryker run stryker.pilot.json --mutate src/utils/apiCache.ts`), and a
 * target whose tests are missing here does not report as "no coverage" — it
 * reports every mutant as SURVIVED, i.e. 0.00%, which reads as a catastrophic
 * test failure rather than a misconfiguration. When adding a mutation target,
 * add its test file here in the same change.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/utils/formValues.test.ts',
      'src/utils/errorHandling.test.ts',
      'src/utils/apiCache.test.ts',
      'src/utils/createApiClient.test.ts',
      'src/modules/onboarding/utils/security.test.ts',
      'src/modules/onboarding/utils/validation.test.ts',
      'src/modules/onboarding/utils/errorHandler.test.ts',
      'src/modules/ip-security/store/ipSecurityStore.test.ts',
      'src/modules/public-portal/hooks/usePublicPortal.test.ts',
    ],
  },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
});
