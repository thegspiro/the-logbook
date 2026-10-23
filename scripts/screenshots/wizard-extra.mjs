/**
 * Photograph the setup-wizard steps `wizard-walk.mjs` stops short of.
 *
 * The IT contacts step and the apparatus step only serve while the department
 * is still being set up, so like the rest of the wizard they cannot be taken
 * from the seeded demo. This creates the organization and administrator the
 * way the wizard does, then opens those two steps directly (every step is its
 * own address) and writes their images.
 *
 * Run it against an empty database, with the backend started with
 * RATE_LIMIT_ENABLED=false as `wizard-walk.mjs` asks:
 *
 *   SCREENSHOT_ADMIN_PASSWORD=... SCREENSHOT_BASE_URL=http://localhost:3100 \
 *     node scripts/screenshots/wizard-extra.mjs
 *
 * Names are made up and addresses are example.org. The administrator password
 * is typed on a page that is gone before the steps photographed here open.
 */
import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const BASE = process.env.SCREENSHOT_BASE_URL || "http://localhost:3000";
const OUT = process.env.SCREENSHOT_OUT_DIR || "docs/training/images";
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const PASSWORD = process.env.SCREENSHOT_ADMIN_PASSWORD;
if (!PASSWORD) {
  throw new Error("SCREENSHOT_ADMIN_PASSWORD must be set");
}

async function shoot(page, id, opts = {}) {
  const target = `${OUT}/${id}.png`;
  if (opts.locator) await opts.locator.screenshot({ path: target });
  else
    await page.screenshot({ path: target, fullPage: Boolean(opts.fullPage) });
  await run("pngquant", [
    "--quality=70-92",
    "--speed",
    "1",
    "--force",
    "--output",
    target,
    target,
  ]).catch(() => {});
  console.log(`  + ${id}`);
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

try {
  await page.goto(`${BASE}/onboarding/start`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("#org-name").waitFor({ timeout: 30_000 });
  await page.fill("#org-name", "Anytown Volunteer Fire Department");
  await page.selectOption("#org-type", { index: 1 });
  await page.selectOption("#org-timezone", { index: 1 });
  await page.fill("#mailing-line1", "1 Main Street");
  await page.fill("#mailing-city", "Anytown");
  await page.selectOption("#mailing-state", { index: 1 });
  await page.fill("#mailing-zip", "12345");
  await page
    .getByRole("button", { name: /continue|next|save/i })
    .last()
    .click();
  await page.waitForURL((u) => !u.pathname.endsWith("/start"), {
    timeout: 60_000,
  });

  await page.waitForTimeout(2000);
  const set = async (sel, value) => {
    const el = page.locator(sel).first();
    if (await el.count()) await el.fill(value);
  };
  await set('input[id*="first" i]', "Alex");
  await set('input[id*="last" i]', "Rivera");
  await set('input[id*="username" i]', "chief");
  await set('input[type="email"]', "alex.rivera@example.org");
  const passwords = page.locator('input[type="password"]');
  for (let i = 0; i < (await passwords.count()); i += 1) {
    await passwords.nth(i).fill(PASSWORD);
  }
  await page
    .getByRole("button", { name: /continue|next|create/i })
    .last()
    .click();
  await page.waitForURL((u) => !u.pathname.includes("system-owner"), {
    timeout: 60_000,
  });
  console.log("  administrator created ->", new URL(page.url()).pathname);

  await page.goto(`${BASE}/onboarding/it-team`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByText("Optional. Choose Skip for now")
    .waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: /Add Member/ }).click();
  const name = page.locator('input[id^="it-contact-"][id$="-name"]').first();
  await name.waitFor({ timeout: 15_000 });
  await name.fill("Jordan Park");
  await page.locator('input[id$="-role"]').first().fill("IT Manager");
  await page
    .locator('input[id$="-email"]')
    .first()
    .fill("jordan.park@example.org");
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(500);
  console.log(
    "  IT step:",
    (await page.locator("main").innerText())
      .replace(/\n+/g, " | ")
      .slice(0, 900),
  );
  await shoot(page, "08-116-onboarding-it-team", { fullPage: true });

  await page.goto(`${BASE}/onboarding/apparatus`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: /Add Apparatus/ })
    .first()
    .click();
  const unit = page.locator('input[placeholder="E-1"]').first();
  await unit.waitFor({ timeout: 15_000 });
  await unit.fill("E-1");
  await page.locator('input[placeholder="Engine 1"]').first().fill("Engine 1");
  const card = page
    .locator("div")
    .filter({ has: page.locator('input[placeholder="Engine 1"]') })
    .filter({ hasText: "Riding Positions" })
    .last();
  console.log(
    "  seats now:",
    (await card.innerText()).replace(/\n+/g, " | ").slice(0, 500),
  );
  for (const seat of [
    "officer",
    "driver",
    "firefighter",
    "firefighter",
    "emt",
  ]) {
    const chip = card.getByRole("button", {
      name: new RegExp(`^\\+ ${seat === "emt" ? "EMT" : seat}$`, "i"),
    });
    if ((await chip.count()) > 0) await chip.first().click();
  }
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(500);
  console.log(
    "  seats after:",
    (await card.innerText()).replace(/\n+/g, " | ").slice(0, 600),
  );
  await shoot(page, "08-117-onboarding-apparatus-seats", { locator: card });
} finally {
  await browser.close();
}
