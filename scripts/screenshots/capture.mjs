#!/usr/bin/env node
/**
 * Capture documentation screenshots from a running demo environment.
 *
 * Drives the real application with Playwright against the dev server, so the
 * images stay in step with the UI rather than being hand-assembled. Shots are
 * declared in `manifest.mjs`; each entry names the docs placeholder it fills,
 * the route to visit, and any interaction needed to reach the pictured state.
 *
 * Prerequisites (see README.md in this directory):
 *   - backend on :3001, frontend dev server on :3000
 *   - `bootstrap_demo.py` and `seed_demo_data.py` already run
 *
 * Usage:
 *   node scripts/screenshots/capture.mjs [--only <id-prefix>] [--headed]
 */

import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEMO_CREDENTIALS, SHOTS } from './manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const OUTPUT_DIR = resolve(REPO_ROOT, 'docs', 'training', 'images');
const BASE_URL = process.env.SCREENSHOT_BASE_URL || 'http://localhost:3000';

/** Desktop framing matches the guides, which describe full-width layouts. */
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 414, height: 896 };

const args = process.argv.slice(2);
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;
const headed = args.includes('--headed');

/**
 * The dashboard and most list pages fetch on mount, and several render a
 * skeleton first. Waiting for network idle alone still catches mid-animation
 * frames, so settle on both.
 */
async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(700);
}

/**
 * A page whose module has no seeded records renders an empty state instead of
 * the populated view the guides describe. Publishing one of those in place of a
 * placeholder would replace an accurate description with a misleading picture,
 * so shots are flagged here and the applier leaves the placeholder alone.
 */
const EMPTY_STATE = /\bno [a-z .'-]{2,40}\b(found|yet|scheduled|available|to show)|get started by (creating|adding)|nothing (here|to show)/i;

async function detectEmptyState(page) {
  const text = await page.locator('main, body').first().innerText().catch(() => '');
  const match = text.match(EMPTY_STATE);
  return match ? match[0].trim() : null;
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.getByLabel(/username|email/i).first().fill(DEMO_CREDENTIALS.username);
  await page.getByLabel(/password/i).first().fill(DEMO_CREDENTIALS.password);
  await page.getByRole('button', { name: /sign in|log ?in/i }).first().click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await settle(page);
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  // PLAYWRIGHT_CHROMIUM_PATH lets an environment that ships a pre-installed
  // Chromium (whose build number may not match this Playwright release) point
  // at it directly instead of downloading a second copy.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  const browser = await chromium.launch({
    headless: !headed,
    ...(executablePath ? { executablePath } : {}),
  });
  const contextOptions = {
    viewport: DESKTOP,
    // 1x, not 2x: a 1440px-wide capture is already legible in the guides, and
    // retina captures tripled the repository weight for no readability gain.
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  };

  const authed = await browser.newContext(contextOptions);
  const authedPage = await authed.newPage();
  await login(authedPage);

  // Signed-out pages (login, SSO, password reset) get their own context.
  // Clearing cookies in the shared one would silently break every later shot.
  const anon = await browser.newContext(contextOptions);
  const anonPage = await anon.newPage();

  const results = [];
  const shots = SHOTS.filter((shot) => !only || shot.id.startsWith(only));
  for (const shot of shots) {
    const target = resolve(OUTPUT_DIR, `${shot.id}.png`);
    const page = shot.auth === 'anonymous' ? anonPage : authedPage;
    try {
      await page.setViewportSize(shot.viewport === 'mobile' ? MOBILE : DESKTOP);
      await page.goto(`${BASE_URL}${shot.route}`, { waitUntil: 'domcontentloaded' });
      await settle(page);
      if (shot.prepare) {
        await shot.prepare(page);
        await settle(page);
      }
      const clip = shot.selector ? await page.locator(shot.selector).first() : null;
      if (clip) {
        await clip.screenshot({ path: target });
      } else {
        await page.screenshot({ path: target, fullPage: Boolean(shot.fullPage) });
      }
      const emptyState = shot.allowEmptyState ? null : await detectEmptyState(page);
      results.push({
        id: shot.id,
        status: 'ok',
        file: `${shot.id}.png`,
        doc: shot.doc,
        line: shot.line,
        alt: shot.alt,
        ...(emptyState ? { emptyState } : {}),
      });
      console.log(`  ${emptyState ? '~' : '+'} ${shot.id}${emptyState ? ` (empty: "${emptyState}")` : ''}`);
    } catch (error) {
      results.push({ id: shot.id, status: 'failed', error: String(error).split('\n')[0] });
      console.log(`  ! ${shot.id}: ${String(error).split('\n')[0]}`);
    }
  }

  await writeFile(
    resolve(HERE, 'capture-report.json'),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  await browser.close();

  const failed = results.filter((r) => r.status === 'failed');
  const empty = results.filter((r) => r.emptyState);
  console.log(`\n${results.length - failed.length}/${results.length} screenshots captured.`);
  if (empty.length) {
    console.log(`${empty.length} show an empty state and need richer seed data before they can be applied.`);
  }
  if (failed.length) {
    process.exitCode = 1;
  }
}

await main();
