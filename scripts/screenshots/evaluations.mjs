/**
 * Screenshots for the Performance Evaluations guide (wiki/Module-Evaluations.md).
 *
 * Separate from `capture.mjs` because that pipeline fills placeholders in
 * `docs/training/*.md`, and the wiki guide has none: its images are named here
 * and embedded by hand. Output goes to `wiki/images/evaluations-*.png`.
 *
 * The shots are the evaluations `seed_demo_data.py` creates for guide 02: the
 * "Annual Member Evaluation" form, the 2025 and 2026 periods, three finalized
 * 2025 reviews, one still in progress, and Ingrid Solberg's 2026 review, which
 * the administrator conducts and which carries the Last review card. Nothing
 * here changes that data: every dialog is opened and then cancelled.
 *
 *   node scripts/screenshots/evaluations.mjs                 # all
 *   node scripts/screenshots/evaluations.mjs --only conduct  # ids containing "conduct"
 *
 * Needs the stack from `dev_env.sh`, a seeded department, and
 * SCREENSHOT_ADMIN_PASSWORD (see README.md).
 */

import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { DEMO_CREDENTIALS } from "./manifest.mjs";
import {
  TOTP_PERIOD_SECONDS,
  readAdminTotpSecret,
  totpForStep,
  totpStep,
} from "./totp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../../wiki/images");
const BASE_URL = process.env.SCREENSHOT_BASE_URL || "http://localhost:3000";

// The member whose 2025 review is finalized and whose 2026 review is open
// (EVALUATION_REVIEWED_MEMBER in seed_demo_data.py). Seeded members share the
// demo member password.
const REVIEWED_MEMBER = { username: "isolberg", password: "DemoMember!2026" };
const REVIEWED_MEMBER_NAME = "Solberg";
const PERIOD_LAST_YEAR = "2025";
const PERIOD_THIS_YEAR = "2026";

const execFileAsync = promisify(execFile);

/**
 * Shrink a PNG with pngquant, as capture.mjs does: a reduced palette takes
 * most of the size off a flat UI screenshot with no visible difference.
 * Missing pngquant is not fatal; the image is only larger.
 */
async function optimize(path) {
  try {
    await execFileAsync("pngquant", [
      "--quality=70-92",
      "--speed",
      "1",
      "--force",
      "--output",
      path,
      path,
    ]);
  } catch {
    // Left as captured.
  }
}

const WIDE = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null;

if (!DEMO_CREDENTIALS.password) {
  throw new Error(
    "SCREENSHOT_ADMIN_PASSWORD must be set to the password used during bootstrap",
  );
}

async function settle(page) {
  // Not caught: a page that never goes idle fails its shot through the
  // per-shot try/catch, rather than being photographed half-loaded.
  await page.waitForLoadState("networkidle", { timeout: 15_000 });
  // Fonts and the lazy route chunk settle a beat after the network does.
  await page.waitForTimeout(500);
}

let lastAdminStep = -1;
async function freshAdminCode(page) {
  let step = totpStep();
  if (step <= lastAdminStep) {
    step = lastAdminStep + 1;
    await page.waitForTimeout(
      Math.max(0, step * TOTP_PERIOD_SECONDS * 1000 - Date.now() + 1000),
    );
  }
  lastAdminStep = step;
  return totpForStep(readAdminTotpSecret(), step);
}

async function signIn(page, credentials, { admin = false } = {}) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page
    .getByLabel(/username|email/i)
    .first()
    .fill(credentials.username);
  await page
    .getByLabel(/password/i)
    .first()
    .fill(credentials.password);
  await page
    .getByRole("button", { name: /sign in|log ?in/i })
    .first()
    .click();
  await page.waitForFunction(
    () =>
      !window.location.pathname.startsWith("/login") ||
      document.querySelector("#mfa-code") !== null,
    null,
    { timeout: 30_000 },
  );
  if (new URL(page.url()).pathname.startsWith("/login")) {
    if (!admin) throw new Error(`${credentials.username} asked for a code`);
    await page.locator("#mfa-code").fill(await freshAdminCode(page));
    await page.getByRole("button", { name: /^verify$/i }).click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 30_000,
  });
  if (/change-password|force-password/i.test(page.url())) {
    throw new Error(
      `${credentials.username} must change its password; re-run seed_demo_data.py`,
    );
  }
  await settle(page);
}

/** The id of the reviewed member's evaluation for a period, from the API. */
async function evaluationId(page, periodName) {
  const response = await page
    .context()
    .request.get(`${BASE_URL}/api/v1/evaluations`);
  if (!response.ok())
    throw new Error(`listing evaluations: ${response.status()}`);
  const rows = await response.json();
  const row = rows.find(
    (r) =>
      r.period_name === periodName &&
      r.member?.name?.includes(REVIEWED_MEMBER_NAME),
  );
  if (!row)
    throw new Error(`no ${periodName} evaluation for ${REVIEWED_MEMBER_NAME}`);
  return row.id;
}

const adminShots = [
  {
    id: "evaluations-setup",
    alt: "Templates & periods: the section strip, the published Annual Member Evaluation form and the 2025 and 2026 review periods",
    route: "/reports/evaluations",
  },
  {
    id: "evaluations-new-template",
    alt: "The New evaluation template dialog with the Annual Member Evaluation starter chosen, filling in the name, kind and who it applies to",
    route: "/reports/evaluations",
    prepare: async (page) => {
      await page.getByRole("button", { name: "New template" }).click();
      const start = page.getByLabel("Start from");
      // The plain annual starter: the officer one needs the department's
      // ranks, and the demo department has none, so it shows only its gate.
      const option = await start
        .locator("option", { hasText: /^Annual Member Evaluation$/ })
        .first()
        .getAttribute("value");
      if (option) await start.selectOption(option);
      await page.waitForTimeout(400);
    },
    clip: (page) => page.getByRole("dialog").last(),
  },
  {
    id: "evaluations-template-builder",
    alt: "The template builder for the Annual Member Evaluation, with its sections, items and weights",
    route: "/reports/evaluations",
    prepare: async (page) => {
      await page
        .getByRole("link", { name: /Open builder/ })
        .first()
        .click();
      await page.waitForURL(/\/reports\/evaluations\/templates\//);
      await settle(page);
      // The route-change bar at the top of the page fades out after load.
      await page.waitForTimeout(1500);
    },
  },
  {
    id: "evaluations-conduct-period-results",
    alt: "All evaluations filtered to the 2025 period: the Overall grade column and the Period results card with Grades by evaluator, Export CSV and Download signed PDFs",
    route: "/reports/evaluations/conduct",
    prepare: async (page) => {
      const period = page.getByLabel("Period");
      const value = await period
        .locator("option", { hasText: PERIOD_LAST_YEAR })
        .first()
        .getAttribute("value");
      await period.selectOption(value ?? "");
      await settle(page);
    },
    fullPage: true,
  },
  {
    id: "evaluations-new-evaluation",
    alt: "The New evaluation dialog: member, review period, kind, the Form choice and the evaluator",
    route: "/reports/evaluations/conduct",
    prepare: async (page) => {
      await page.getByRole("button", { name: "New evaluation" }).click();
      await page.getByLabel("Member").waitFor();
      await page.waitForTimeout(300);
    },
    clip: (page) => page.getByRole("dialog").last(),
  },
  {
    id: "evaluations-draft-period",
    alt: "Draft a review period: the preview lists each current member with the form and evaluator they would get, or why they are left out",
    route: "/reports/evaluations/conduct",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Draft a review period" }).click();
      const dlg = page.getByRole("dialog").last();
      const period = dlg.getByLabel(/period/i).first();
      const value = await period
        .locator("option", { hasText: PERIOD_THIS_YEAR })
        .first()
        .getAttribute("value");
      if (value) await period.selectOption(value);
      await dlg.getByRole("button", { name: "Preview members" }).click();
      await settle(page);
    },
    clip: (page) => page.getByRole("dialog").last(),
  },
  {
    id: "evaluations-in-progress",
    alt: "An evaluation in progress, seen by its evaluator: the steps, the member's figures for the period, and the evaluator's form",
    route: async (page) =>
      `/reports/evaluations/${await evaluationId(page, PERIOD_THIS_YEAR)}`,
  },
  {
    id: "evaluations-last-review",
    alt: "The Last review card: last year's overall and section grades, and the goals set then, with Open the last review",
    route: async (page) =>
      `/reports/evaluations/${await evaluationId(page, PERIOD_THIS_YEAR)}`,
    clip: (page) =>
      page
        .getByRole("heading", { name: "Last review" })
        .locator("xpath=ancestor::section[1]"),
  },
  {
    id: "evaluations-assign-step",
    alt: "The Who takes Calibration dialog: whoever is named completes the step in place of the position's holders, chosen under Completed by",
    route: async (page) =>
      `/reports/evaluations/${await evaluationId(page, PERIOD_THIS_YEAR)}`,
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^(Assign|Change)/ })
        .first()
        .click();
      await settle(page);
    },
    clip: (page) => page.getByRole("dialog").last(),
  },
  {
    id: "evaluations-finalized",
    alt: "A finalized evaluation: every step done, the signatures, Download PDF and the review history",
    route: async (page) =>
      `/reports/evaluations/${await evaluationId(page, PERIOD_LAST_YEAR)}`,
  },
];

const memberShots = [
  {
    id: "evaluations-my-evaluations",
    alt: "My evaluations: the member's own evaluations and their figures for the current review period",
    route: "/reports/evaluations/mine",
  },
  {
    id: "evaluations-my-evaluations-phone",
    alt: "My evaluations on a phone",
    route: "/reports/evaluations/mine",
    viewport: PHONE,
  },
  {
    id: "evaluations-member-response",
    alt: "The member's finalized evaluation, with the written response box and Submit response",
    route: async (page) => {
      const response = await page
        .context()
        .request.get(`${BASE_URL}/api/v1/evaluations/mine`);
      const rows = await response.json();
      const row = rows.find((r) => r.period_name === PERIOD_LAST_YEAR);
      if (!row) throw new Error("the member has no finalized 2025 evaluation");
      return `/reports/evaluations/${row.id}`;
    },
    clip: (page) =>
      page
        .getByRole("heading", { name: "Your written response" })
        .locator("xpath=ancestor::section[1]"),
  },
];

function chromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH)
    return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const preinstalled = "/opt/pw-browsers/chromium";
  return existsSync(preinstalled) ? preinstalled : undefined;
}

async function run(browser, credentials, shots, options) {
  const wanted = shots.filter(
    (shot) => !only || only.split(",").some((part) => shot.id.includes(part)),
  );
  if (wanted.length === 0) return 0;
  const context = await browser.newContext({
    viewport: WIDE,
    deviceScaleFactor: 2,
    colorScheme: "light",
  });
  const page = await context.newPage();
  await signIn(page, credentials, options);
  let failed = 0;
  for (const shot of wanted) {
    try {
      await page.setViewportSize(shot.viewport || WIDE);
      const route =
        typeof shot.route === "function" ? await shot.route(page) : shot.route;
      await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
      await settle(page);
      if (shot.prepare) await shot.prepare(page);
      const path = resolve(OUT_DIR, `${shot.id}.png`);
      const target = shot.clip ? shot.clip(page) : null;
      if (target) await target.screenshot({ path });
      else await page.screenshot({ path, fullPage: Boolean(shot.fullPage) });
      await optimize(path);
      console.log(`ok   ${shot.id}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${shot.id}: ${String(error.message).split("\n")[0]}`);
    }
  }
  await context.close();
  return failed;
}

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ executablePath: chromiumPath() });
let failed = 0;
failed += await run(browser, DEMO_CREDENTIALS, adminShots, { admin: true });
failed += await run(browser, REVIEWED_MEMBER, memberShots);
await browser.close();
process.exit(failed ? 1 : 0);
