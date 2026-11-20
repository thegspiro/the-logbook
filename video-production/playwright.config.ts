import { defineConfig } from '@playwright/test';

import { SCALE } from './lib/recorder';

/**
 * Captures for the video shorts. Not part of the E2E suite: it records, it
 * does not assert. Run through make-short.sh, which supplies the narration
 * timings each capture reads.
 */
export default defineConfig({
  testDir: './shorts',
  testMatch: '**/capture.spec.ts',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: './build/test-results',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'off',
    launchOptions: {
      // Without this the screencast hands back CSS-pixel frames whatever the
      // context's deviceScaleFactor. See SCALE in lib/recorder.ts.
      args: [`--force-device-scale-factor=${SCALE}`],
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    },
  },
  webServer: {
    command: 'npm run dev',
    cwd: '../frontend',
    url: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
