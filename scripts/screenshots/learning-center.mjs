/**
 * Screenshots for the in-app Learning Center lessons.
 *
 * Separate from `capture.mjs` on purpose: that pipeline is keyed to
 * placeholders in `docs/training/*.md`, and a lesson step has none. Output goes
 * to `frontend/public/lesson-images/`, which `LearningPathPage` serves outside
 * the service worker's precache.
 *
 * Every shot is taken as the ordinary demo member, at a narrow desktop width and
 * clipped to the region the lesson is about, because a lesson column is ~700px
 * wide and a full 1440px page shrinks its text past reading.
 *
 *   node scripts/screenshots/learning-center.mjs                  # all
 *   node scripts/screenshots/learning-center.mjs --only gear      # ids containing "gear"
 *
 * Run `seed_demo_data.py` first (see README.md). Needs the stack from
 * `dev_env.sh`.
 */

import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEMO_MEMBER_CREDENTIALS } from "./manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../../frontend/public/lesson-images");
const BASE_URL = process.env.SCREENSHOT_BASE_URL || "http://localhost:3000";

const WIDE = { width: 1100, height: 800 };
const PHONE = { width: 390, height: 844 };

const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex > -1 ? process.argv[onlyIndex + 1] : null;

const settle = async (page) => {
  await page.waitForLoadState("networkidle", { timeout: 15_000 });
  await page.waitForTimeout(400);
};

/**
 * Each shot: `id` is the file name, `route` the page, `viewport` defaults to
 * WIDE, `prepare` drives the UI into the pictured state, `clip` picks the
 * region (a locator factory; omitted means the viewport) and `crop` keeps only
 * the top `height` pixels of that region, below `top`. A lesson column is
 * ~700px wide, so a full-length page is trimmed to the part the step is about.
 */
const shots = [
  {
    id: "getting-started-dashboard",
    route: "/dashboard",
    clip: (page) => page.locator("[data-page-main], main").first(),
    crop: { top: 0, height: 830 },
  },
  {
    id: "getting-started-notifications",
    route: "/account?tab=notifications",
    clip: (page) => page.locator("main").first(),
    crop: { top: 0, height: 700 },
  },
  {
    id: "getting-started-directory",
    route: "/account?tab=privacy",
    clip: (page) => page.locator("main").first(),
    crop: { top: 0, height: 780 },
  },
  {
    id: "mobile-offline",
    route: "/dashboard",
    prepare: async (page) => {
      await page.context().setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await page.waitForTimeout(600);
    },
    cleanup: async (page) => {
      await page.context().setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
    },
    clip: (page) =>
      page
        .getByText(/^Offline/)
        .first()
        .locator("xpath=.."),
  },
  {
    id: "events-checkin",
    route: "/events",
    clip: (page) => page.locator("main").first(),
    crop: { top: 0, height: 640 },
  },
  {
    id: "training-submit",
    route: "/training/submit",
    clip: (page) => page.locator("main").first(),
    crop: { top: 0, height: 1250 },
  },
  {
    id: "training-verify",
    route: "/training/submit",
    clip: (page) =>
      page.getByText("Recent Submissions").first().locator("xpath=../.."),
  },
  {
    id: "scheduling-my-shifts",
    route: "/scheduling?tab=my-shifts",
    clip: (page) => page.locator("main").first(),
    crop: { top: 0, height: 830 },
  },
  {
    id: "scheduling-open-shifts",
    route: "/scheduling?tab=open-shifts",
    clip: (page) => page.locator("main").first(),
    crop: { top: 0, height: 620 },
  },
  {
    id: "scheduling-requests",
    route: "/scheduling?tab=requests",
    clip: (page) => page.locator("main").first(),
    crop: { top: 0, height: 390 },
  },
  {
    id: "gear-issued",
    route: "/inventory/my-equipment",
    clip: (page) => page.locator("main").first(),
    crop: { top: 0, height: 560 },
  },
];

async function signIn(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page
    .getByLabel(/username|email/i)
    .first()
    .fill(DEMO_MEMBER_CREDENTIALS.username);
  await page
    .getByLabel(/password/i)
    .first()
    .fill(DEMO_MEMBER_CREDENTIALS.password);
  await page
    .getByRole("button", { name: /sign in|log ?in/i })
    .first()
    .click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 30_000,
  });
  await settle(page);
}

function chromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH)
    return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const preinstalled = "/opt/pw-browsers/chromium";
  return existsSync(preinstalled) ? preinstalled : undefined;
}

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ executablePath: chromiumPath() });
const context = await browser.newContext({
  viewport: WIDE,
  deviceScaleFactor: 1,
  colorScheme: "light",
});
const page = await context.newPage();
await signIn(page);

let failed = 0;
for (const shot of shots) {
  if (only && !shot.id.includes(only)) continue;
  try {
    await page.setViewportSize(shot.viewport || WIDE);
    await page.goto(`${BASE_URL}${shot.route}`, {
      waitUntil: "domcontentloaded",
    });
    await settle(page);
    if (shot.prepare) await shot.prepare(page);
    const target = shot.clip ? shot.clip(page) : null;
    const path = resolve(OUT_DIR, `${shot.id}.png`);
    if (target && shot.crop) {
      // Tall enough that nothing scrolls, so the box is in page coordinates.
      const width = (shot.viewport || WIDE).width;
      await page.setViewportSize({ width, height: 2600 });
      await page.waitForTimeout(400);
      const box = await target.boundingBox();
      if (!box) throw new Error("clip region is not on the page");
      const height = Math.min(shot.crop.height, box.height - shot.crop.top);
      await page.screenshot({
        path,
        clip: { x: box.x, y: box.y + shot.crop.top, width: box.width, height },
      });
    } else if (target) await target.screenshot({ path });
    else await page.screenshot({ path });
    console.log(`ok   ${shot.id}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${shot.id}: ${String(error.message).split("\n")[0]}`);
  } finally {
    if (shot.cleanup) {
      try {
        await shot.cleanup(page);
      } catch (error) {
        failed += 1;
        console.log(
          `FAIL ${shot.id} cleanup: ${String(error.message).split("\n")[0]}`,
        );
      }
    }
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
