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

import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEMO_CREDENTIALS, SHOTS } from "./manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const OUTPUT_DIR = resolve(REPO_ROOT, "docs", "training", "images");
const BASE_URL = process.env.SCREENSHOT_BASE_URL || "http://localhost:3000";

const run = promisify(execFile);

/**
 * Shrink a capture in place with pngquant.
 *
 * Playwright's PNGs are 24-bit and run ~500 KB each; full coverage of the
 * guides would put well over 100 MB of binaries into git history. Git LFS is
 * the usual answer but this environment's network policy blocks the LFS
 * endpoint, so the bytes have to come out of the file itself. Quantising to a
 * palette takes roughly 75% off with no visible difference on flat UI
 * screenshots — text stays crisp, which is the only thing that matters here.
 *
 * Missing pngquant is not fatal: the capture is still correct, just larger.
 */
async function optimize(target) {
  try {
    const before = (await stat(target)).size;
    await run("pngquant", [
      "--quality=70-92",
      "--speed",
      "1",
      "--force",
      "--output",
      target,
      target,
    ]);
    return before - (await stat(target)).size;
  } catch {
    return 0;
  }
}

/** Desktop framing matches the guides, which describe full-width layouts. */
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 414, height: 896 };

const args = process.argv.slice(2);
const onlyIndex = args.indexOf("--only");
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;
const headed = args.includes("--headed");

/**
 * The dashboard and most list pages fetch on mount, and several render a
 * skeleton first. Waiting for network idle alone still catches mid-animation
 * frames, so settle on both.
 */
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
  // Then wait out any spinner. A tab switch mounts its panel, which fetches on
  // mount — the request has not been issued yet when networkidle resolves, so
  // the wait above returns while the panel is still a spinner and the shot
  // captures loading state instead of content. Bounded and best-effort: a page
  // that legitimately spins forever should still produce an image to look at.
  await page
    .waitForFunction(
      () => document.querySelectorAll(".animate-spin").length === 0,
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => {});
}

/**
 * A page whose module has no seeded records renders an empty state instead of
 * the populated view the guides describe. Publishing one of those in place of a
 * placeholder would replace an accurate description with a misleading picture,
 * so shots are flagged here and the applier leaves the placeholder alone.
 */
const EMPTY_STATE =
  /\bno [a-z .'-]{2,40}\b(found|yet|scheduled|available|to show)|get started by (creating|adding)|nothing (here|to show)/i;

/**
 * The app's ErrorBoundary renders this when a page throws during render. It is
 * a normal-looking screenshot of a broken page — no exception reaches
 * Playwright, the capture "succeeds", and without this check the error card
 * gets published into a guide as though it were the feature. Treated as a hard
 * failure rather than an empty state: an empty module is a fact about the demo
 * data, a crash is a bug to fix.
 */
const CRASHED = /Oops! Something went wrong|Show error details/i;

/**
 * Pages that render an in-page error instead of content — a print view opened
 * without the record id it expects, a detail page whose id does not resolve.
 * Like a crash this screenshots as a normal page and reads as a broken feature,
 * and unlike an empty state it is the shot's own fault: the manifest sent the
 * page somewhere it cannot render. Failing the shot is what surfaces that.
 */
const PAGE_ERROR =
  /no [a-z ]{2,30} (id |ids )?(provided|specified|selected)|failed to load|could not be loaded|unable to load|invalid (id|request)|go back to [a-z ]{2,30} and select/i;

async function detectPageError(page) {
  const text = await pageText(page);
  const match = text.match(PAGE_ERROR);
  return match ? match[0].trim() : null;
}

async function pageText(page) {
  return page
    .locator("main, body")
    .first()
    .innerText()
    .catch(() => "");
}

async function detectCrash(page) {
  const text = await pageText(page);
  return CRASHED.test(text);
}

async function detectEmptyState(page, selector) {
  // Scan what the image will actually contain. A clipped shot pictures one
  // section, and scanning the whole page around it flags copy that is nowhere
  // in the screenshot — the account security tab says "nothing here is
  // required for membership", which is prose, not an empty state.
  const text = selector
    ? await page
        .locator(selector)
        .first()
        .innerText()
        .catch(() => "")
    : await pageText(page);
  const match = text.match(EMPTY_STATE);
  return match ? match[0].trim() : null;
}

async function signIn(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page
    .getByLabel(/username|email/i)
    .first()
    .fill(DEMO_CREDENTIALS.username);
  await page
    .getByLabel(/password/i)
    .first()
    .fill(DEMO_CREDENTIALS.password);
  await page
    .getByRole("button", { name: /sign in|log ?in/i })
    .first()
    .click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 30_000,
  });
  await settle(page);
}

/**
 * Sign in, retrying a slow first attempt.
 *
 * The Vite dev server compiles on first request, so the navigation right after
 * a frontend restart can exceed the 30s timeout while the app is merely slow
 * rather than broken. Failing there aborts the whole run before a single shot
 * is taken — an hour of capture lost to a cold cache. The second attempt hits
 * a warm bundle and succeeds.
 */
async function login(page) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await signIn(page);
      return;
    } catch (error) {
      if (attempt >= 2) throw error;
      console.log(`  … login attempt ${attempt + 1} timed out, retrying`);
    }
  }
}

/**
 * Write the report, merging a `--only` run into what is already there.
 *
 * The applier reads this file to decide which placeholders to fill, so a
 * narrow re-capture that replaced it would silently drop every other shot from
 * the next apply — the images stay on disk and the placeholders stay open,
 * which looks like the applier failing rather than the report being partial.
 */
async function writeReport(results) {
  const path = resolve(HERE, "capture-report.json");
  let merged = results;
  if (only) {
    let previous = [];
    try {
      previous = JSON.parse(await readFile(path, "utf8"));
    } catch {
      previous = [];
    }
    const fresh = new Set(results.map((r) => r.id));
    merged = [...previous.filter((r) => !fresh.has(r.id)), ...results];
  }
  await writeFile(path, `${JSON.stringify(merged, null, 2)}\n`);
}

function resolveChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  }
  const pool = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!pool) return undefined;
  const symlink = resolve(pool, "chromium");
  return existsSync(symlink) ? symlink : undefined;
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  // PLAYWRIGHT_CHROMIUM_PATH lets an environment that ships a pre-installed
  // Chromium (whose build number may not match this Playwright release) point
  // at it directly instead of downloading a second copy. When the browser pool
  // in PLAYWRIGHT_BROWSERS_PATH carries a version-agnostic `chromium` symlink,
  // use it without being asked — bumping @playwright/test otherwise breaks
  // capture on every such machine until someone sets the variable by hand.
  const executablePath = resolveChromium();
  const browser = await chromium.launch({
    headless: !headed,
    ...(executablePath ? { executablePath } : {}),
  });
  const contextOptions = {
    viewport: DESKTOP,
    // 1x, not 2x: a 1440px-wide capture is already legible in the guides, and
    // retina captures tripled the repository weight for no readability gain.
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
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
    const page = shot.auth === "anonymous" ? anonPage : authedPage;
    try {
      await page.setViewportSize(shot.viewport === "mobile" ? MOBILE : DESKTOP);
      await page.goto(`${BASE_URL}${shot.route}`, {
        waitUntil: "domcontentloaded",
      });
      await settle(page);
      if (shot.prepare) {
        await shot.prepare(page);
        await settle(page);
      }
      const clip = shot.selector
        ? await page.locator(shot.selector).first()
        : null;
      if (clip) {
        await clip.screenshot({ path: target });
      } else {
        await page.screenshot({
          path: target,
          fullPage: Boolean(shot.fullPage),
        });
      }
      await optimize(target);
      const emptyState = shot.allowEmptyState
        ? null
        : await detectEmptyState(page, shot.selector);
      if (await detectCrash(page)) {
        throw new Error("page hit the ErrorBoundary — the app crashed here");
      }
      const pageError = await detectPageError(page);
      if (pageError) {
        throw new Error(`page rendered an error: "${pageError}"`);
      }
      results.push({
        id: shot.id,
        status: "ok",
        file: `${shot.id}.png`,
        doc: shot.doc,
        line: shot.line,
        anchor: shot.anchor,
        alt: shot.alt,
        ...(emptyState ? { emptyState } : {}),
        ...(shot.holdBack ? { holdBack: shot.holdBack } : {}),
      });
      console.log(
        `  ${emptyState ? "~" : "+"} ${shot.id}${emptyState ? ` (empty: "${emptyState}")` : ""}`,
      );
    } catch (error) {
      results.push({
        id: shot.id,
        status: "failed",
        error: String(error).split("\n")[0],
      });
      console.log(`  ! ${shot.id}: ${String(error).split("\n")[0]}`);
    }
  }

  await writeReport(results);
  await browser.close();

  const failed = results.filter((r) => r.status === "failed");
  const empty = results.filter((r) => r.emptyState);
  console.log(
    `\n${results.length - failed.length}/${results.length} screenshots captured.`,
  );
  if (empty.length) {
    console.log(
      `${empty.length} show an empty state and need richer seed data before they can be applied.`,
    );
  }
  if (failed.length) {
    process.exitCode = 1;
  }
}

await main();
