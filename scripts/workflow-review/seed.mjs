#!/usr/bin/env node
/**
 * Seed a fresh review database the way a department would: onboard through
 * the setup screens, turn every module on, and add one member per role a
 * review needs to act as, each signed in once so the driver can resume their
 * session with `wr.as(role)`.
 *
 *   scripts/workflow-review/start.sh --reset
 *   node scripts/workflow-review/seed.mjs
 *
 * Accounts go through the real paths — POST /users as the administrator, then
 * the first sign-in and the forced password change — so a seed that fails is
 * itself a finding about those paths, not a fixture problem.
 *
 * Passwords are generated per run and written to accounts.json in the state
 * directory (mode 0600, gitignored). Nothing here is a real credential.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  ACCOUNTS_FILE,
  LOGIN_INTERVAL_MS,
  apiCall,
  authFile,
  launchBrowser,
  readEnv,
  readJson,
  signIn,
} from "./lib.mjs";

/**
 * Who a review can act as. `positions` are the slugs onboarding seeds; each
 * account also holds the baseline `member` position every member holds.
 * `login: false` members fill out the roster for lists, pickers and bulk
 * actions, and are never signed in.
 */
const ROLES = [
  {
    role: "chief",
    first: "Casey",
    last: "Morgan",
    rank: "fire_chief",
    positions: ["fire_chief"],
  },
  {
    role: "training_officer",
    first: "Tariq",
    last: "Nolan",
    rank: "captain",
    positions: ["training_officer"],
  },
  {
    role: "secretary",
    first: "Sam",
    last: "Ortiz",
    rank: "lieutenant",
    positions: ["secretary"],
  },
  {
    role: "treasurer",
    first: "Tess",
    last: "Park",
    rank: "firefighter",
    positions: ["treasurer"],
  },
  {
    role: "quartermaster",
    first: "Quinn",
    last: "Reyes",
    rank: "firefighter",
    positions: ["quartermaster"],
  },
  {
    role: "scheduling_officer",
    first: "Skyler",
    last: "Shah",
    rank: "lieutenant",
    positions: ["scheduling_officer"],
  },
  {
    role: "membership_coordinator",
    first: "Morgan",
    last: "Tate",
    rank: "firefighter",
    positions: ["membership_coordinator"],
  },
  {
    role: "member",
    first: "Jordan",
    last: "Avery",
    rank: "firefighter",
    positions: [],
  },
  {
    role: "member2",
    first: "Alex",
    last: "Brooks",
    rank: "emt",
    positions: [],
  },
];

const ROSTER = [
  ["Blair", "Carter", "firefighter"],
  ["Cameron", "Diaz", "emt"],
  ["Devon", "Ellis", "firefighter"],
  ["Emery", "Foster", "engineer"],
  ["Finley", "Grant", "firefighter"],
  ["Harper", "Hayes", "emt"],
  ["Jesse", "Irwin", "firefighter"],
  ["Kai", "Jensen", "lieutenant"],
  ["Logan", "Kim", "firefighter"],
  ["Micah", "Lane", "emt"],
];

const DEPARTMENT = {
  name: "Review Valley Fire Department",
  timezone: "America/Chicago",
  street: "100 Main Street",
  city: "Springfield",
  state: "IL",
  zip: "62701",
};

const log = (msg) => console.log(`[workflow-review seed] ${msg}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A password the app accepts: 12+ characters with upper, lower, digit and
 * symbol, and — per validate_password_strength — no character three times in
 * a row and no ascending run such as "abc" or "123". Random output trips the
 * last two often enough that a draw is checked and redrawn rather than hoped.
 */
function newPassword() {
  const ascendingRun = (text) => {
    const lower = text.toLowerCase();
    for (let i = 0; i + 2 < lower.length; i++) {
      const a = lower.charCodeAt(i);
      const isRunChar = (c) => (c >= 48 && c <= 57) || (c >= 97 && c <= 122);
      if (
        isRunChar(a) &&
        lower.charCodeAt(i + 1) === a + 1 &&
        lower.charCodeAt(i + 2) === a + 2
      )
        return true;
    }
    return false;
  };
  for (;;) {
    const candidate = `Wr-${randomBytes(9).toString("base64url")}a7!Q`;
    if (!/(.)\1\1/.test(candidate) && !ascendingRun(candidate))
      return candidate;
  }
}

async function onboard(page, admin) {
  await page.goto("/");
  await page.getByRole("button", { name: /get started/i }).click();
  await page.getByRole("button", { name: /start setup/i }).click();

  await page.locator("#org-name").fill(DEPARTMENT.name);
  await page.locator("#org-timezone").selectOption(DEPARTMENT.timezone);
  await page.locator("#mailing-line1").fill(DEPARTMENT.street);
  await page.locator("#mailing-city").fill(DEPARTMENT.city);
  await page.locator("#mailing-state").selectOption(DEPARTMENT.state);
  await page.locator("#mailing-zip").fill(DEPARTMENT.zip);
  await page.getByRole("button", { name: /^continue/i }).click();

  await page.waitForURL("**/onboarding/system-owner");
  await page.locator("#firstName").fill(admin.first);
  await page.locator("#lastName").fill(admin.last);
  await page.locator("#username").fill(admin.username);
  await page.locator("#email").fill(admin.email);
  await page.locator("#password").fill(admin.password);
  await page.locator("#confirmPassword").fill(admin.password);
  await page.getByRole("button", { name: /create system owner/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/system-owner"), {
    timeout: 20000,
  });

  // Every remaining step is optional. Take its skip where it has one and its
  // continue otherwise, and stop the moment a step offers neither: a new
  // required step should fail the seed loudly, not be guessed through.
  const skip = /^(skip|i'll add these later)/i;
  const advance =
    /^(continue|save & continue)|go to dashboard|complete setup|finish setup/i;
  const labels = () =>
    page.$$eval("main button", (buttons) =>
      buttons.map((b) =>
        (
          b.innerText.trim().split("\n")[0] ||
          b.getAttribute("aria-label") ||
          ""
        ).trim(),
      ),
    );
  // Steps render in stages (the completion page lists its next steps before
  // its own Skip), so look again briefly before concluding a button is absent.
  const press = async (pattern) => {
    let index = -1;
    for (let attempt = 0; attempt < 6 && index < 0; attempt++) {
      if (attempt) await page.waitForTimeout(500);
      index = (await labels()).findIndex((label) => pattern.test(label));
    }
    if (index < 0) return false;
    await page.locator("main button").nth(index).click();
    return true;
  };

  // The route changes before the next step's page replaces the last one's, so
  // a button list read straight after navigating can belong to the step just
  // left — and clicking its index on the new page presses something else. It
  // once pressed "Remove Quartermaster position" on Ranks & Positions that
  // way. Wait for the heading to change before reading anything.
  const heading = () =>
    page
      .locator("main h1, main h2")
      .first()
      .textContent({ timeout: 10000 })
      .catch(() => "");
  let previousHeading = "";
  for (let step = 0; step < 20; step++) {
    const path = new URL(page.url()).pathname;
    if (!path.startsWith("/onboarding")) return;
    await page.waitForFunction(
      (prev) => {
        const h = document.querySelector("main h1, main h2");
        return Boolean(h) && h.textContent !== prev;
      },
      previousHeading,
      { timeout: 15000 },
    );
    previousHeading = await heading();
    // A step renders its buttons after its own data loads.
    await page
      .waitForLoadState("networkidle", { timeout: 10000 })
      .catch(() => {});
    await page.locator("main button").first().waitFor({ timeout: 10000 });
    // Ranks & Positions refuses Continue while the membership ladder holds
    // edits nobody saved (RoleSetup's handleContinue), and a new department's
    // ladder opens that way. Pressing Continue then only raises a toast and
    // the step never advances. Keep the ladder as offered, as an administrator
    // pressing Save tiers would, and wait for the save to land.
    if (path === "/onboarding/positions" && (await press(/^save tiers$/i))) {
      await page
        .locator("main button", { hasText: /^save tiers$/i })
        .waitFor({ state: "detached", timeout: 15000 });
    }
    // Finish setup stays disabled until a navigation layout is picked, and
    // the step has no Skip. Take the first layout offered.
    if (path === "/onboarding/navigation-choice") {
      await page
        .locator("main button", { hasText: /^top navigation/i })
        .first()
        .click();
    }
    // The modules step has a Skip on every module card; skipping one is a
    // choice about that module, not about the step. Modules are enabled over
    // the API afterwards.
    const skipped = path !== "/onboarding/modules" && (await press(skip));
    await page.waitForTimeout(800);
    const moved = new URL(page.url()).pathname !== path;
    if (!moved && !(await press(advance)) && !skipped) {
      throw new Error(
        `onboarding stopped at ${path}; buttons: ${(await labels()).filter(Boolean).join(" | ")}`,
      );
    }
    await page
      .waitForURL((url) => url.pathname !== path, { timeout: 20000 })
      .catch(async () => {
        throw new Error(
          `onboarding did not leave ${path}; buttons: ${(await labels()).filter(Boolean).join(" | ")}`,
        );
      });
  }
  throw new Error(`onboarding did not finish; last page ${page.url()}`);
}

async function enableEveryModule(context) {
  const current = await apiCall(context, "GET", "/organization/modules");
  if (current.status !== 200)
    throw new Error(`GET /organization/modules: ${current.status}`);
  const all = Object.fromEntries(
    Object.keys(current.body.module_settings).map((key) => [key, true]),
  );
  const updated = await apiCall(context, "PATCH", "/organization/modules", all);
  if (updated.status !== 200) {
    throw new Error(
      `PATCH /organization/modules: ${updated.status} ${JSON.stringify(updated.body)}`,
    );
  }
  return updated.body.enabled_modules;
}

async function createMember(context, positionIds, spec, username, password) {
  const missing = spec.positions.filter((slug) => !positionIds[slug]);
  if (missing.length)
    throw new Error(
      `onboarding did not seed position(s): ${missing.join(", ")}`,
    );
  const res = await apiCall(context, "POST", "/users", {
    username,
    email: `${username}@example.org`,
    first_name: spec.first,
    last_name: spec.last,
    rank: spec.rank,
    password,
    send_welcome_email: false,
    role_ids: [...spec.positions, "member"]
      .map((slug) => positionIds[slug])
      .filter(Boolean),
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(
      `POST /users ${username}: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
}

/** The first sign-in: the app sends a new member to /account to replace the admin-set password. */
async function firstSignIn(browser, baseURL, account, temporary) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const landed = await signIn(page, account.username, temporary);
  if (landed === "/account") {
    await page.locator("#currentPassword").fill(temporary);
    await page.locator("#newPassword").fill(account.password);
    await page.locator("#confirmPassword").fill(account.password);
    await page.locator("#confirmPassword").press("Enter");
    // Changing a password ends every session, this one included, so the app
    // returns to the sign-in screen and the new password signs in afresh.
    await page.waitForURL("**/login**", { timeout: 15000 });
    await sleep(LOGIN_INTERVAL_MS);
    const after = await signIn(page, account.username, account.password);
    if (after === "/account" || after === "/login") {
      throw new Error(
        `${account.username}: the new password did not take (landed on ${after})`,
      );
    }
  } else {
    throw new Error(
      `${account.username}: expected the forced password change, landed on ${landed}`,
    );
  }
  await context.storageState({ path: authFile(account.role) });
  await context.close();
}

async function main() {
  const env = readEnv();
  const status = await fetch(`${env.backendUrl}/api/v1/onboarding/status`).then(
    (r) => r.json(),
  );
  if (!status.needs_onboarding) {
    const existing = readJson(ACCOUNTS_FILE, null);
    if (existing) {
      log(
        `already seeded (${Object.keys(existing).length} accounts); run start.sh --reset for a fresh install`,
      );
      return;
    }
    throw new Error(
      `${env.database} is onboarded but has no accounts.json; run start.sh --reset`,
    );
  }

  const accounts = {
    admin: {
      role: "admin",
      username: "review_admin",
      email: "review_admin@example.org",
      first: "Riley",
      last: "Owner",
      password: newPassword(),
      positions: ["it_manager"],
    },
  };

  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ baseURL: env.baseUrl });
    const page = await context.newPage();

    log("onboarding through the setup screens");
    await onboard(page, accounts.admin);
    await context.storageState({ path: authFile("admin") });

    const modules = await enableEveryModule(context);
    log(`enabled ${modules.length} modules`);

    const positions = await apiCall(context, "GET", "/roles");
    if (positions.status !== 200)
      throw new Error(`GET /roles: ${positions.status}`);
    const positionIds = Object.fromEntries(
      positions.body.map((p) => [p.slug, p.id]),
    );

    const temporary = {};
    for (const spec of ROLES) {
      const username = `review_${spec.role}`;
      temporary[spec.role] = newPassword();
      await createMember(
        context,
        positionIds,
        spec,
        username,
        temporary[spec.role],
      );
      accounts[spec.role] = {
        role: spec.role,
        username,
        email: `${username}@example.org`,
        first: spec.first,
        last: spec.last,
        rank: spec.rank,
        password: newPassword(),
        positions: [...spec.positions, "member"],
      };
    }
    for (const [first, last, rank] of ROSTER) {
      const username = `${first}_${last}`.toLowerCase();
      await createMember(
        context,
        positionIds,
        { first, last, rank, positions: [] },
        username,
        newPassword(),
      );
    }
    log(
      `added ${ROLES.length} role accounts and ${ROSTER.length} roster members`,
    );
    await context.close();

    // Written before the sign-ins so a failure part-way still leaves the
    // administrator's credentials behind.
    writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), {
      mode: 0o600,
    });

    for (const spec of ROLES) {
      log(`first sign-in: ${spec.role}`);
      await firstSignIn(
        browser,
        env.baseUrl,
        accounts[spec.role],
        temporary[spec.role],
      );
      await sleep(LOGIN_INTERVAL_MS);
    }
  } finally {
    await browser.close();
  }
  log(
    `done: ${Object.keys(accounts).join(", ")} (credentials in ${ACCOUNTS_FILE})`,
  );
}

main().catch((err) => {
  console.error(`[workflow-review seed] FAILED: ${err?.stack ?? err}`);
  process.exit(1);
});
