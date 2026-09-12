/**
 * Capture the two setup-wizard shots that need the wizard PAST step 1.
 *
 * capture.mjs cannot take these. It runs against the seeded demo department,
 * and the wizard only serves while `needs_onboarding` is true -- so by the time
 * every other shot is takeable, /onboarding redirects to sign-in. These have to
 * run against an empty database, and reaching step 4 means actually creating
 * the organization and the administrator, which is what ends that window.
 *
 * So this walks the real wizard, captures, and the caller then drops the
 * database and re-runs bootstrap_demo.py for everything else.
 *
 * PREREQUISITE -- issue one `POST /api/v1/onboarding/start` serially, before
 * opening a browser:
 *
 *     curl -s -X POST http://127.0.0.1:3001/api/v1/onboarding/start
 *
 * `start_onboarding` is an unguarded read-then-write, and the wizard's own page
 * load fires it in parallel. Two callers both read "none exists", both insert,
 * and `needs_onboarding()` then raises MultipleResultsFound out of
 * `scalar_one_or_none()` -- so /onboarding/status 500s permanently and the run
 * dies partway through. A row that already exists makes every later call take
 * the "return existing" branch, so the race cannot fire. See ONBOARD-7 in
 * docs/KNOWN_LIMITATIONS.md.
 *
 * Also run the backend with RATE_LIMIT_ENABLED=false: the wizard's own asset
 * and API traffic trips the 60/minute default partway through step 1.
 *
 * Framing matches capture.mjs exactly (1440x900, deviceScaleFactor 1, pngquant
 * --quality=70-92) so the outputs are interchangeable with the rest.
 */
import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const BASE = process.env.SCREENSHOT_BASE_URL || "http://localhost:3000";
const OUT = "docs/training/images";
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium";

async function optimize(target) {
  try {
    await run("pngquant", [
      "--quality=70-92",
      "--speed",
      "1",
      "--force",
      "--output",
      target,
      target,
    ]);
  } catch {
    // pngquant missing is not fatal -- the capture is correct, just larger.
  }
}

async function shoot(page, id, opts = {}) {
  const target = `${OUT}/${id}.png`;
  await page.screenshot({ path: target, fullPage: Boolean(opts.fullPage) });
  await optimize(target);
  console.log(`  + ${id}`);
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
page.on("console", (m) => {
  if (m.type() === "error")
    console.log("    [console]", m.text().slice(0, 160));
});

try {
  // ---- Setup Prerequisites (not a step; nothing is saved) -------------------
  await page.goto(`${BASE}/onboarding/prepare`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .locator('h2:text-is("What setup will ask for")')
    .waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await shoot(page, "20-01-onboarding-prepare", { fullPage: true });

  // ---- Step 1: organization -------------------------------------------------
  await page.goto(`${BASE}/onboarding/start`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("#org-name").waitFor({ timeout: 30_000 });
  await page.fill("#org-name", "Anytown Volunteer Fire Department");
  await page.selectOption("#org-type", { index: 1 });
  await page
    .selectOption("#org-timezone", { label: /New_York|Eastern/ })
    .catch(async () => {
      await page.selectOption("#org-timezone", { index: 1 });
    });
  await page.fill("#mailing-line1", "1 Main Street");
  await page.fill("#mailing-city", "Anytown");
  await page.selectOption("#mailing-state", { index: 1 });
  await page.fill("#mailing-zip", "12345");
  console.log("  step 1 filled");

  const next = page.getByRole("button", { name: /continue|next|save/i }).last();
  await next.click();
  await page.waitForURL((u) => !u.pathname.endsWith("/start"), {
    timeout: 60_000,
  });
  console.log("  ->", new URL(page.url()).pathname);

  // ---- Step 2: administrator account ---------------------------------------
  await page.waitForTimeout(2000);
  const pw = process.env.SCREENSHOT_ADMIN_PASSWORD;
  const set = async (sel, value) => {
    const el = page.locator(sel).first();
    if (await el.count()) await el.fill(value);
  };
  await set('input[id*="first" i]', "Alex");
  await set('input[id*="last" i]', "Rivera");
  await set('input[id*="username" i]', "chief");
  await set('input[type="email"]', "alex.rivera@anytown-vfd.example.org");
  const pwFields = page.locator('input[type="password"]');
  const n = await pwFields.count();
  for (let i = 0; i < n; i += 1) await pwFields.nth(i).fill(pw);
  console.log(`  step 2 filled (${n} password fields)`);

  await page
    .getByRole("button", { name: /continue|next|create/i })
    .last()
    .click();
  await page.waitForURL((u) => !u.pathname.includes("system-owner"), {
    timeout: 60_000,
  });
  await page.waitForTimeout(3000);
  console.log("  ->", new URL(page.url()).pathname);

  // ---- Shot: the progress indicator, mid-flow -------------------------------
  // Taken on Modules (step 3) -- far enough in that completed, current and
  // pending steps are all on screen at once, which is what the placeholder
  // asks for. A shot on step 1 shows nothing completed.
  await page.goto(`${BASE}/onboarding/modules`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(3000);
  // Clipped to the progress strip, not the whole modules page. The subject is
  // the indicator; a fullPage shot of this screen renders it as a 145px band at
  // the foot of a 3400px image, which pictures the module grid instead.
  //
  // It has to be taken inside THIS session. A fresh browser has no onboarding
  // session, so the strip resets to "Step 1 of 11" and the completed ticks on
  // steps 1 and 2 -- the whole point of a mid-flow shot -- disappear.
  const strip = page
    .locator("div.max-w-2xl")
    .filter({ hasText: "Setup Progress" })
    .last();
  await strip.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const stripText = await strip.innerText();
  if (!/Step 3 of 11/.test(stripText)) {
    throw new Error(
      `progress strip is not mid-flow: ${stripText.replace(/\n+/g, " | ").slice(0, 120)}`,
    );
  }
  const stripTarget = `${OUT}/20-02-onboarding-progress-order.png`;
  await strip.screenshot({ path: stripTarget });
  await optimize(stripTarget);
  console.log("  + 20-02-onboarding-progress-order (clipped)");

  // ---- Shot: step 4, the rank ladder ---------------------------------------
  await page.goto(`${BASE}/onboarding/positions`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(4000);
  const headings = await page.locator("h1,h2,h3").allInnerTexts();
  console.log("  positions headings:", JSON.stringify(headings.slice(0, 8)));

  // Clipped to the rank-ladder card. Step 4 is a 5,200px page carrying the
  // membership ladder, the rank ladder and the full position picker; a
  // fullPage shot of it renders the ladder as one band among many and
  // pictures the position templates instead.
  //
  // Like the progress strip, this only exists inside the walk's own session:
  // a fresh browser at /onboarding/positions is redirected to
  // /onboarding/start, so there is no card to clip.
  // The innermost div holding BOTH the heading and the Add Rank control is the
  // card. Filtering on the heading alone matches every ancestor and, with
  // .last(), returns the heading's own wrapper -- which has no controls in it.
  const ladderTarget = `${OUT}/20-03-onboarding-rank-ladder.png`;
  const ladder = page
    .locator("div")
    .filter({ hasText: "Your Rank Ladder" })
    .filter({ hasText: "Add Rank" })
    .last();

  let clipped = false;
  if (await ladder.count()) {
    await ladder.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const box = await ladder.boundingBox();
    console.log(`  ladder box: ${JSON.stringify(box)}`);
    if (box && box.height > 200 && box.height < 2400) {
      await ladder.screenshot({ path: ladderTarget });
      await optimize(ladderTarget);
      console.log("  + 20-03-onboarding-rank-ladder (clipped)");
      clipped = true;
    }
  }
  if (!clipped) {
    // Never end the run with nothing: a full-page shot is worse framing but is
    // still the right screen, and it can be re-clipped later.
    console.log(
      "  ! could not clip the rank-ladder card - falling back to fullPage",
    );
    await shoot(page, "20-03-onboarding-rank-ladder", { fullPage: true });
  }
} finally {
  await browser.close();
}
