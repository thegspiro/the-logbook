/**
 * Capture the six setup-wizard shots, five of which need the wizard PAST the
 * screen they picture.
 *
 *   20-01  /onboarding/prepare        the two lists and the "9 of 11 optional" footer
 *   20-08  step 1, member numbering   two collapsed things opened first
 *   20-02  step 3, progress strip     mid-flow, so completed ticks exist
 *   20-03  step 4, rank ladder        clipped out of a ~5,200px page
 *   20-09  step 4, tier rights        one tier OPEN -- what 08-80 cannot show
 *   20-10  step 4, permission rows    module-filtered; must run LAST
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
 * Run the backend with RATE_LIMIT_ENABLED=false: the wizard's own asset and API
 * traffic trips the 60/minute default partway through step 1.
 *
 * The serial `POST /onboarding/start` this used to require is no longer needed.
 * It worked around ONBOARD-7, where the wizard's own parallel page load created
 * duplicate `onboarding_status` rows and left /onboarding/status 500ing
 * permanently; that is fixed (unique index plus a retrying get-or-create), and
 * twenty concurrent starts now yield one row. Issuing one first is harmless if
 * an older checkout still does it.
 *
 * The order is not arrangeable. 20-08 is on the step-1 form, which stops
 * existing the moment step 1 is submitted; 20-02 needs steps 1-2 already
 * ticked; and 20-10's subject is the "N modules you did not enable are hidden"
 * notice, which only exists once the Modules step has run -- the filter FAILS
 * OPEN on an empty answer, showing every module and no notice at all.
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

  // ---- Shot: the member-numbering block (step 1) ---------------------------
  // Two things are closed by default and both have to be opened, or the shot
  // pictures an accordion instead of the feature: "Department Identifiers"
  // starts collapsed (`identifiers: false` in OrganizationSetup), and the
  // prefix and starting-number fields render only while the switch is on.
  //
  // Filled with real values rather than left blank. The placeholders are grey
  // helper text that photographs as an empty form, and the caption is about
  // what a member number looks like.
  await page
    .getByRole("button", { name: /Department Identifiers/i })
    .first()
    .click();
  const numberingToggle = page
    .locator("label")
    .filter({ hasText: "Our members have member numbers" })
    .last()
    .locator('input[type="checkbox"]');
  await numberingToggle.waitFor({ timeout: 15_000 });
  await numberingToggle.check();
  await page.fill("#member-number-prefix", "FD-");
  await page.fill("#member-number-start", "100");
  // Drop focus. Filled last, the starting-number box keeps its focus ring, and
  // a ring in a documentation image reads as "type here" rather than as a
  // value that is already set.
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
  await page.waitForTimeout(500);

  // The innermost div holding BOTH the switch and the prefix field is the
  // block. Ancestors match too and come first in document order, so .last()
  // is the one that is only this feature -- .first() would be the page.
  const numbering = page
    .locator("div")
    .filter({ hasText: "Our members have member numbers" })
    .filter({ has: page.locator("#member-number-prefix") })
    .last();
  await numbering.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const numberingText = await numbering.innerText();
  // Asserted on the clip's own text, not the page's: the section tab above it
  // carries the heading, so checking for that would pass on a frame that had
  // cropped the block out entirely.
  for (const phrase of [
    "Our members have member numbers",
    "Prefix",
    "Start numbering at",
  ]) {
    if (!numberingText.includes(phrase)) {
      throw new Error(
        `member-numbering clip is missing ${JSON.stringify(phrase)}: ${numberingText.replace(/\n+/g, " | ").slice(0, 160)}`,
      );
    }
  }
  const numberingTarget = `${OUT}/20-08-onboarding-member-numbering.png`;
  await numbering.screenshot({ path: numberingTarget });
  await optimize(numberingTarget);
  console.log("  + 20-08-onboarding-member-numbering (clipped)");

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

  // ---- Shot: the tier ladder with one tier's rights open -------------------
  // 08-80 already pictures this editor at its Settings address, so the frame
  // that earns its place here is the one 08-80 does not have: a tier OPENED,
  // showing the three rights a tier actually decides. The clip is the
  // fieldset, which is what holds the automatic-advancement switch and the
  // tier list together -- the caption names both, so both have to be in frame.
  //
  // Active Member, specifically -- not whichever tier is first. First is
  // Probationary, whose rights are all OFF at the shipped defaults: accurate,
  // but it photographs as an empty form and invites the reader to conclude no
  // tier votes. Active Member is the tier most members hold and the one whose
  // rights are on, so the controls read as live toggles.
  const TIER = "Active Member";
  // The nearest ancestor div that carries the row's own toggle. Anchoring on
  // the name input and walking UP is what keeps this pointed at one tier:
  // filtering divs by `hasText` cannot work here at all, because a tier's name
  // lives in an input's `value` and innerText never contains it.
  const tierRow = page
    .locator(`input[value="${TIER}"]`)
    .locator(
      'xpath=ancestor::div[.//button[normalize-space()="Rights" or normalize-space()="Hide"]][1]',
    );
  if (!(await tierRow.count())) {
    const names = await page
      .locator('input[aria-label="Tier name"], input[value]')
      .evaluateAll((els) =>
        els.map((e) => e.getAttribute("value")).filter(Boolean),
      );
    throw new Error(
      `no tier row named ${JSON.stringify(TIER)} to open; tiers on screen: ${JSON.stringify(names)}`,
    );
  }
  const rights = tierRow
    .getByRole("button", { name: /^(Rights|Hide)$/ })
    .first();
  await rights.waitFor({ timeout: 15_000 });
  await rights.click();
  await page.waitForTimeout(600);
  // The toggle reads "Hide" only while ITS OWN tier is open, so this is the
  // one check that proves the right row opened -- the control labels below
  // would read identically whichever tier was expanded.
  const toggleText = (await rights.innerText()).trim();
  if (toggleText !== "Hide") {
    throw new Error(
      `${TIER} did not open: its toggle still reads ${JSON.stringify(toggleText)}`,
    );
  }

  const tierPanel = page
    .locator("fieldset")
    .filter({ hasText: "Advance members automatically by years of service" })
    .last();
  await tierPanel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const tierText = await tierPanel.innerText();
  // Which tier is open was settled by the toggle check above. These assert the
  // clip actually FRAMES the controls -- the fieldset is the subject, and a
  // clip that missed it would still satisfy any page-level check.
  for (const phrase of [
    "Advance members automatically by years of service",
    "Can vote in elections",
    "Can hold elected office",
    "Must meet a meeting-attendance threshold to vote",
  ]) {
    if (!tierText.includes(phrase)) {
      throw new Error(
        `tier clip is missing ${JSON.stringify(phrase)} -- the tier probably did not open: ${tierText.replace(/\n+/g, " | ").slice(0, 200)}`,
      );
    }
  }
  const tierTarget = `${OUT}/20-09-onboarding-tier-rights.png`;
  await tierPanel.screenshot({ path: tierTarget });
  await optimize(tierTarget);
  console.log("  + 20-09-onboarding-tier-rights (clipped)");

  // ---- Shot: the permission rows, module-filtered --------------------------
  // LAST, and deliberately against a SMALL module selection. The subject is
  // the "N modules you did not enable are hidden" line, and against a full
  // module set that line does not render at all -- the frame would argue the
  // opposite of its caption.
  //
  // The small selection is not staged: the Modules step enables only the
  // `essential` modules by default, and `moduleStatuses` is in the onboarding
  // store's persisted allowlist, so it survives the page.goto that brought us
  // here. That matters because `visibleCategoryIds` FAILS OPEN -- an empty
  // answer returns every category and hiddenModuleCount becomes 0 -- so a run
  // that never reached the Modules step produces no message to photograph.
  //
  // IT Manager is skipped on purpose: it renders "full access to all
  // features" instead of a permission grid, so it has no rows and no filter
  // notice.
  const positionHeaders = page.locator(
    '[aria-label*="click to expand permissions"]',
  );
  const headerCount = await positionHeaders.count();
  let opened = null;
  for (let i = 0; i < headerCount; i += 1) {
    const header = positionHeaders.nth(i);
    const label = (await header.getAttribute("aria-label")) ?? "";
    if (/IT Manager/i.test(label)) continue;
    await header.scrollIntoViewIfNeeded();
    await header.click();
    await page.waitForTimeout(700);
    opened = label.replace(/ - click to.*$/, "");
    break;
  }
  if (!opened) {
    throw new Error(
      `no non-IT position to expand (found ${headerCount} position headers)`,
    );
  }
  console.log(`  opened permissions for: ${opened}`);

  const permPanel = page
    .locator("div")
    .filter({ hasText: "you did not enable" })
    .filter({ has: page.locator('button:has-text("Show all modules")') })
    .last();
  await permPanel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const permText = await permPanel.innerText();
  if (!/module[s]? you did not enable/.test(permText)) {
    throw new Error(
      `permission clip has no module-filter notice -- the run probably skipped the Modules step, which makes the filter fail open: ${permText.replace(/\n+/g, " | ").slice(0, 200)}`,
    );
  }
  const permTarget = `${OUT}/20-10-onboarding-permission-rows.png`;
  await permPanel.screenshot({ path: permTarget });
  await optimize(permTarget);
  console.log("  + 20-10-onboarding-permission-rows (clipped)");
} finally {
  await browser.close();
}
