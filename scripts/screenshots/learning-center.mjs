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
 *   node scripts/screenshots/learning-center.mjs --only gear      # ids containing "gear"; comma-separate several
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

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const installBanner = (page) =>
  page
    .getByText("Install The Logbook")
    .first()
    .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");

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
    id: "getting-started-account",
    route: "/account?tab=account",
    clip: (page) => page.locator("main").first(),
    crop: { top: 0, height: 760 },
  },
  {
    id: "mobile-install-android",
    route: "/dashboard",
    viewport: PHONE,
    prepare: async (page) => {
      // Chromium only fires this for an installable site over HTTPS, so the
      // dev server never does; the banner is the app's own response to it.
      await page.evaluate(() =>
        window.dispatchEvent(new Event("beforeinstallprompt")),
      );
      await page.getByText("Install The Logbook").waitFor();
    },
    clip: installBanner,
  },
  {
    id: "mobile-install-iphone",
    route: "/dashboard",
    viewport: PHONE,
    freshPage: true,
    beforeNavigate: async (page) => {
      await page.addInitScript((userAgent) => {
        Object.defineProperty(navigator, "userAgent", {
          get: () => userAgent,
        });
      }, IPHONE_SAFARI);
    },
    prepare: async (page) => {
      await page.getByText("Install The Logbook").waitFor();
    },
    clip: installBanner,
  },
  {
    id: "mobile-push",
    route: "/account?tab=notifications",
    // The switch renders only where the browser supports push AND the server
    // has VAPID keys, which the demo backend does not.
    beforeNavigate: async (page) => {
      await page.route("**/notifications/push/config", (route) =>
        route.fulfill({
          json: { enabled: true, public_key: "BDemoKeyForScreenshotOnly" },
        }),
      );
    },
    prepare: async (page) => {
      await page.getByText("Push Notifications on This Device").waitFor();
    },
    clip: (page) => page.locator("main").first(),
    crop: { top: 0, height: 640 },
  },
  {
    id: "events-rsvp-card",
    route: "/events",
    clip: (page) =>
      page
        .getByRole("button", { name: "Not Going" })
        .first()
        .locator("xpath=ancestor::*[contains(@class,'card')][1]"),
  },
  {
    id: "events-missed-checkin",
    route: "/events",
    prepare: async (page) => {
      await page.getByRole("button", { name: /^Past/ }).first().click();
      await page.getByText("Pump Panel Practice").first().click();
      await page.getByRole("button", { name: "I was there" }).waitFor();
    },
    clip: (page) =>
      page
        .getByRole("button", { name: "I was there" })
        .locator("xpath=ancestor::*[contains(@class,'card')][1]"),
  },
  {
    id: "training-history",
    route: "/training/my-training",
    clip: (page) => page.locator("main").first(),
    crop: { top: 0, height: 900 },
  },
  {
    id: "gear-sizes",
    route: "/inventory/my-equipment",
    prepare: async (page) => {
      await page.getByRole("button", { name: "My Sizes" }).click();
      await page.getByRole("dialog").waitFor();
    },
    clip: (page) => page.getByRole("dialog").locator(".modal-panel").first(),
  },
  {
    id: "gear-request",
    route: "/inventory/my-equipment",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Request Equipment" }).click();
      await page.getByRole("dialog").waitFor();
    },
    clip: (page) => page.getByRole("dialog").locator(".modal-panel").first(),
  },
  {
    id: "getting-started-needs-you",
    route: "/dashboard",
    // The demo member has no certification inside the readiness window, so one
    // is added to the real my-training answer; every other field is the live
    // response.
    beforeNavigate: async (page) => {
      await page.route(
        /\/training\/module-config\/my-training(\?|$)/,
        async (route) => {
          const response = await route.fetch();
          const body = await response.json();
          const expires = new Date(Date.now() + 21 * 86_400_000);
          body.certifications = [
            {
              id: "screenshot-cert",
              course_name: "EMT-Basic Recertification",
              expiration_date: expires.toISOString().slice(0, 10),
              is_expired: false,
              days_until_expiry: 21,
            },
            ...(body.certifications ?? []),
          ];
          await route.fulfill({ response, json: body });
        },
      );
    },
    prepare: async (page) => {
      await page.getByText("Needs you").first().waitFor();
    },
    clip: (page) =>
      page.getByText("Needs you").first().locator("xpath=ancestor::section[1]"),
  },
  {
    id: "events-waitlist",
    route: "/events",
    // A full roster is the state; the demo's events all have room, so one
    // event the member has not answered is reported as full.
    beforeNavigate: async (page) => {
      await page.route(/\/api\/v1\/events(\?|$)/, async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        const list = Array.isArray(body)
          ? body
          : (body.items ?? body.events ?? []);
        for (const event of list) {
          if (
            event.title === "Monthly Officers Meeting" &&
            !event.user_rsvp_status
          ) {
            event.max_attendees = 12;
            event.going_count = 12;
            event.occupied_seats = 12;
          }
        }
        await route.fulfill({ response, json: body });
      });
    },
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "Join Waitlist" })
        .first()
        .waitFor();
    },
    clip: (page) =>
      page
        .getByRole("button", { name: "Join Waitlist" })
        .first()
        .locator("xpath=ancestor::*[contains(@class,'card')][1]"),
  },
  {
    id: "events-check-in-page",
    route: "/events",
    prepare: async (page) => {
      await page.getByRole("link", { name: "Check In" }).first().click();
      await page.waitForURL(/\/check-in$/);
      await page
        .getByRole("button", { name: "Check In to This Event" })
        .waitFor();
    },
    clip: (page) =>
      page
        .getByRole("heading", { name: "Event Check-In" })
        .locator("xpath=ancestor::div[contains(@class,'shadow')][1]"),
  },
  {
    id: "scheduling-not-eligible",
    route: "/scheduling?tab=open-shifts",
    // Every seeded member is cleared for something, so the server's answer for
    // one shift is replaced with "not cleared".
    beforeNavigate: async (page) => {
      await page.route("**/scheduling/eligibility/positions?*", (route) =>
        route.fulfill({
          json: { positions: [], open_positions: [], is_excluded: true },
        }),
      );
    },
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /Sign up for shift/ })
        .first()
        .click();
      await page.getByText("You are not eligible").waitFor();
    },
    clip: (page) =>
      page
        .getByRole("heading", { name: "Sign Up for Shift" })
        .locator(
          "xpath=ancestor::div[.//button[normalize-space()='Cancel']][1]",
        ),
  },
  {
    id: "scheduling-pick-up",
    route: "/scheduling?tab=requests",
    // A second member's open swap; the demo's one open swap is the viewer's own.
    beforeNavigate: async (page) => {
      const swapDate = new Date(Date.now() + 9 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      await page.route("**/scheduling/swap-requests/open", (route) =>
        route.fulfill({
          json: [
            {
              swap_request_id: "screenshot-swap",
              shift_id: "screenshot-shift",
              shift_date: swapDate,
              start_time: `${swapDate}T11:00:00Z`,
              end_time: `${swapDate}T23:00:00Z`,
              position: "firefighter",
              requesting_user_name: "Yuki Tanaka",
              apparatus_label: "Engine 1",
              reason: "Family commitment that evening",
            },
          ],
        }),
      );
    },
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^Pick up/ })
        .first()
        .waitFor();
    },
    clip: (page) =>
      page
        .getByRole("button", { name: /^Pick up/ })
        .first()
        .locator("xpath=ancestor::section[1]"),
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
  if (only && !only.split(",").some((part) => shot.id.includes(part))) continue;
  const shotPage = shot.freshPage ? await context.newPage() : page;
  try {
    await shotPage.setViewportSize(shot.viewport || WIDE);
    if (shot.beforeNavigate) await shot.beforeNavigate(shotPage);
    await shotPage.goto(`${BASE_URL}${shot.route}`, {
      waitUntil: "domcontentloaded",
    });
    await settle(shotPage);
    if (shot.prepare) await shot.prepare(shotPage);
    const target = shot.clip ? shot.clip(shotPage) : null;
    const path = resolve(OUT_DIR, `${shot.id}.png`);
    if (target && shot.crop) {
      // Tall enough that nothing scrolls, so the box is in page coordinates.
      const width = (shot.viewport || WIDE).width;
      await shotPage.setViewportSize({ width, height: 2600 });
      await shotPage.waitForTimeout(400);
      const box = await target.boundingBox();
      if (!box) throw new Error("clip region is not on the page");
      const height = Math.min(shot.crop.height, box.height - shot.crop.top);
      await shotPage.screenshot({
        path,
        clip: { x: box.x, y: box.y + shot.crop.top, width: box.width, height },
      });
    } else if (target) await target.screenshot({ path });
    else await shotPage.screenshot({ path });
    console.log(`ok   ${shot.id}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${shot.id}: ${String(error.message).split("\n")[0]}`);
  } finally {
    if (shot.cleanup) {
      try {
        await shot.cleanup(shotPage);
      } catch (error) {
        failed += 1;
        console.log(
          `FAIL ${shot.id} cleanup: ${String(error.message).split("\n")[0]}`,
        );
      }
    }
    // A mocked route must not outlive its shot on the shared page.
    await shotPage.unrouteAll({ behavior: "ignoreErrors" });
    if (shot.freshPage) await shotPage.close();
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
