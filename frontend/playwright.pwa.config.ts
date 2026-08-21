import { defineConfig, devices } from '@playwright/test';

const port = 4173;

/**
 * Production-only PWA smoke tests. The normal Playwright suite uses Vite's
 * development server, where service-worker registration is intentionally
 * disabled. This project builds and previews dist so it exercises the same
 * generated manifest and worker that are shipped to users.
 */
export default defineConfig({
  testDir: './src/e2e',
  testMatch: 'pwa.spec.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? {
          launchOptions: {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
          },
        }
      : {}),
  },
  webServer: {
    command: `npm run build && node scripts/serve-pwa-test.mjs --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
