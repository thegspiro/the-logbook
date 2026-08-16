/**
 * Database-free capture of the guided inventory setup workflow.
 *
 * `scripts/screenshots/capture.mjs` is the pipeline of record and owns every
 * populated screen in this workflow. This owns the two it cannot reach:
 *
 *   05-72-setup-prompt   the admin hub's "Finish inventory setup" banner
 *   05-73-setup-rooms    step 1 with no rooms declared yet
 *
 * Both picture a department that has *not* finished setting up, and seeding is
 * precisely what ends that state — verified: run against the seeded demo
 * department, 05-72 captures a hub with no banner on it at all. Those two ids
 * carry `capturedElsewhere` in the manifest so capture.mjs skips rather than
 * overwrites them; nothing else here writes a file, so the two sources never
 * race for the same name.
 *
 * It also walks all five steps at phone width and fails on horizontal
 * overflow, which needs no seeded data to be worth running.
 *
 * Usage:
 *   npm run build && npx vite preview --port 4173
 *   node scripts/screenshots/inventory-setup.mjs [outDir]
 *
 * CHROMIUM_PATH points at an existing Chromium where Playwright's pinned
 * revision is not installed.
 */

import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

const run = promisify(execFile);

/**
 * Quantise in place, exactly as capture.mjs does — Playwright writes 24-bit
 * PNGs around four times the size of the palette images already in
 * docs/training/images. Missing pngquant is not fatal, just larger files.
 */
async function optimize(target) {
  await run("pngquant", [
    "--quality=70-92",
    "--speed",
    "1",
    "--force",
    "--output",
    target,
    target,
  ]).catch(() => {});
}

const BASE = process.env.PREVIEW_URL ?? "http://localhost:4173";

// Same framing as capture.mjs, so these sit beside the other guide images
// rather than looking like they came from a different machine.
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 414, height: 896 };
const OUT = process.argv[2] ?? "docs/training/images";

const USER = {
  id: "user-1",
  username: "gspiro",
  email: "quartermaster@example.org",
  first_name: "Sam",
  last_name: "Rivera",
  full_name: "Sam Rivera",
  organization_id: "org-1",
  timezone: "America/New_York",
  roles: ["admin"],
  positions: ["quartermaster"],
  rank: null,
  membership_type: "member",
  permissions: ["*"],
  is_active: true,
  email_verified: true,
  mfa_enabled: false,
  password_expired: false,
  must_change_password: false,
};

const ROOMS = [
  {
    id: "room-1",
    organization_id: "org-1",
    name: "Gear Room",
    building: "Station 1",
    room_number: "103",
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "room-2",
    organization_id: "org-1",
    name: "Supply Closet",
    building: "Station 1",
    room_number: "110",
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

const area = (id, name, storage_type) => ({
  id,
  organization_id: "org-1",
  name,
  storage_type,
  location_id: "room-1",
  sort_order: 0,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  children: [],
  item_count: 0,
});

const AREAS = [
  area("area-1", "Rack A", "rack"),
  area("area-2", "Rack B", "rack"),
  area("area-3", "Boot Shelf", "shelf"),
  area("area-4", "SCBA Locker", "cabinet"),
];

const category = (id, name, item_type, extra = {}) => ({
  id,
  organization_id: "org-1",
  name,
  item_type,
  requires_assignment: false,
  requires_serial_number: false,
  requires_maintenance: false,
  nfpa_tracking_enabled: false,
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...extra,
});

const CATEGORIES = [
  category("cat-1", "Turnout Gear", "ppe", {
    requires_assignment: true,
    requires_serial_number: true,
    requires_maintenance: true,
    nfpa_tracking_enabled: true,
  }),
  category("cat-2", "Helmets", "ppe", {
    requires_serial_number: true,
    requires_maintenance: true,
  }),
  category("cat-3", "Station Uniforms", "uniform", {
    requires_assignment: true,
    low_stock_threshold: 10,
  }),
  category("cat-4", "Hand Tools", "tool", { requires_maintenance: true }),
];

const preset = (key, name, description, item_type, flags = {}) => ({
  key,
  name,
  description,
  item_type,
  requires_assignment: false,
  requires_serial_number: false,
  requires_maintenance: false,
  nfpa_tracking_enabled: false,
  low_stock_threshold: null,
  exists: false,
  ...flags,
});

const PRESETS = [
  preset(
    "turnout_gear",
    "Turnout Gear",
    "Coats, pants, and liners issued to a member.",
    "ppe",
    {
      requires_assignment: true,
      requires_serial_number: true,
      requires_maintenance: true,
      nfpa_tracking_enabled: true,
    },
  ),
  preset(
    "helmets",
    "Helmets",
    "Structural and wildland helmets, shields, and liners.",
    "ppe",
    {
      requires_assignment: true,
      requires_serial_number: true,
      requires_maintenance: true,
      nfpa_tracking_enabled: true,
    },
  ),
  preset(
    "boots_gloves_hoods",
    "Boots, Gloves & Hoods",
    "Sized PPE issued per member and replaced on wear.",
    "ppe",
    {
      requires_assignment: true,
      low_stock_threshold: 10,
    },
  ),
  preset(
    "scba",
    "SCBA",
    "Packs, masks, and cylinders on a flow-test cycle.",
    "ppe",
    {
      requires_serial_number: true,
      requires_maintenance: true,
      nfpa_tracking_enabled: true,
    },
  ),
  preset(
    "station_uniforms",
    "Station Uniforms",
    "Job shirts, t-shirts, and duty pants kept in sizes.",
    "uniform",
    {
      requires_assignment: true,
      low_stock_threshold: 10,
    },
  ),
  preset(
    "dress_uniforms",
    "Dress Uniforms",
    "Class A coats, trousers, covers, and insignia.",
    "uniform",
    {
      requires_assignment: true,
    },
  ),
  preset(
    "hand_tools",
    "Hand Tools",
    "Irons, axes, hooks, and other truck-company tools.",
    "tool",
    {
      requires_maintenance: true,
    },
  ),
  preset(
    "power_equipment",
    "Power Equipment",
    "Saws, fans, and extrication tools on a service cycle.",
    "tool",
    {
      requires_serial_number: true,
      requires_maintenance: true,
    },
  ),
  preset(
    "hose_appliances",
    "Hose & Appliances",
    "Hose, nozzles, and adapters carried on apparatus.",
    "equipment",
    {
      requires_maintenance: true,
    },
  ),
  preset(
    "ladders",
    "Ladders",
    "Ground ladders on an annual test cycle.",
    "equipment",
    {
      requires_serial_number: true,
      requires_maintenance: true,
    },
  ),
  preset(
    "radios",
    "Radios & Pagers",
    "Portables, chargers, and pagers issued by serial.",
    "electronics",
    {
      requires_assignment: true,
      requires_serial_number: true,
    },
  ),
  preset(
    "ems_supplies",
    "EMS Supplies",
    "Consumables restocked by quantity and expiration.",
    "consumable",
    {
      low_stock_threshold: 20,
    },
  ),
  preset(
    "station_supplies",
    "Station Supplies",
    "Cleaning and household stock reordered by quantity.",
    "consumable",
    {
      low_stock_threshold: 15,
    },
  ),
];

const SUMMARY = {
  total_items: 148,
  items_by_status: {
    available: 96,
    assigned: 38,
    checked_out: 9,
    in_maintenance: 3,
    retired: 2,
  },
  items_by_condition: { excellent: 40, good: 90, fair: 18 },
  total_value: 184300,
  active_checkouts: 9,
  overdue_checkouts: 2,
  maintenance_due_count: 6,
};

/** Fixture sets, one per scenario. */
const scenarios = {
  /** Nothing set up yet — what a brand-new quartermaster sees. */
  empty: {
    // Summary overridden too: a department with no items must not be shown
    // 148 of them in the same screenshot as "items still to set up".
    "/inventory/summary": {
      ...SUMMARY,
      total_items: 0,
      items_by_status: {},
      items_by_condition: {},
      total_value: 0,
      active_checkouts: 0,
      overdue_checkouts: 0,
      maintenance_due_count: 0,
    },
    "/inventory/setup/status": {
      rooms: 0,
      storage_areas: 0,
      categories: 0,
      items: 0,
      is_complete: false,
    },
    "/inventory/setup/category-presets": PRESETS,
    "/locations": [],
    "/inventory/storage-areas": [],
    "/inventory/categories": [],
  },
  /** Rooms declared; the rest still to do. */
  rooms: {
    "/inventory/setup/status": {
      rooms: 2,
      storage_areas: 0,
      categories: 0,
      items: 0,
      is_complete: false,
    },
    "/inventory/setup/category-presets": PRESETS,
    "/locations": ROOMS,
    "/inventory/storage-areas": [],
    "/inventory/categories": [],
  },
  /** Rooms + storage; categories partly picked already. */
  storage: {
    "/inventory/setup/status": {
      rooms: 2,
      storage_areas: 4,
      categories: 0,
      items: 0,
      is_complete: false,
    },
    "/inventory/setup/category-presets": PRESETS.map((p) =>
      ["turnout_gear", "helmets"].includes(p.key) ? { ...p, exists: true } : p,
    ),
    "/locations": ROOMS,
    "/inventory/storage-areas": AREAS,
    "/inventory/categories": [],
  },
  /** Everything but the items. */
  categories: {
    "/inventory/setup/status": {
      rooms: 2,
      storage_areas: 4,
      categories: 4,
      items: 0,
      is_complete: false,
    },
    "/inventory/setup/category-presets": PRESETS.map((p) =>
      ["turnout_gear", "helmets", "station_uniforms", "hand_tools"].includes(
        p.key,
      )
        ? { ...p, exists: true }
        : p,
    ),
    "/locations": ROOMS,
    "/inventory/storage-areas": AREAS,
    "/inventory/categories": CATEGORIES,
  },
  /** Setup finished. */
  done: {
    "/inventory/setup/status": {
      rooms: 2,
      storage_areas: 4,
      categories: 4,
      items: 148,
      is_complete: true,
    },
    "/inventory/setup/category-presets": PRESETS.map((p) =>
      ["turnout_gear", "helmets", "station_uniforms", "hand_tools"].includes(
        p.key,
      )
        ? { ...p, exists: true }
        : p,
    ),
    "/locations": ROOMS,
    "/inventory/storage-areas": AREAS,
    "/inventory/categories": CATEGORIES,
  },
};

/** Responses shared by every scenario (the admin hub's other panels). */
const COMMON = {
  "/auth/me": USER,
  "/inventory/summary": SUMMARY,
  "/inventory/low-stock": [],
  "/inventory/return-requests": [],
  "/inventory/requests": { requests: [], total: 0 },
  "/inventory/members-summary": { members: [], total: 0 },
  "/notifications": { notifications: [], total: 0, unread_count: 0 },
};

function bodyFor(pathname, fixtures) {
  const key = pathname.replace(/^\/api\/v1/, "").replace(/\/$/, "");
  if (key in fixtures) return fixtures[key];
  if (key in COMMON) return COMMON[key];
  // Anything unfixtured answers empty rather than 404, so an unrelated panel
  // renders its own empty state instead of an error toast over the shot.
  return [];
}

async function installRoutes(context, fixtures) {
  await context.unrouteAll?.().catch(() => {});
  await context.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(bodyFor(url.pathname, fixtures)),
    });
  });
}

const shots = [];
const problems = [];

/**
 * Nothing on a page should push it wider than the viewport — a sideways-
 * scrolling page is the failure mode a phone screenshot hides, because a
 * full-page capture silently widens to fit and looks correct. Checking it
 * here is what caught a footer row whose three no-wrap controls did not fit
 * at 390px.
 */
async function assertNoHorizontalOverflow(page, name) {
  const result = await page.evaluate(() => {
    const de = document.documentElement;
    if (de.scrollWidth <= de.clientWidth + 1) return null;
    const culprits = [...document.querySelectorAll("body *")]
      .filter((el) => {
        const position = getComputedStyle(el).position;
        if (position === "fixed" || position === "absolute") return false;
        return el.getBoundingClientRect().right > de.clientWidth + 1;
      })
      .slice(0, 3)
      .map(
        (el) =>
          `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 70)}">`,
      );
    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      culprits,
    };
  });
  if (result) {
    problems.push(
      `${name}: page scrolls sideways (${result.scrollWidth}px in a ${result.clientWidth}px viewport)` +
        `${result.culprits.length ? ` — widest in-flow: ${result.culprits.join(", ")}` : ""}`,
    );
  }
}

async function shoot(
  page,
  name,
  { fullPage = true, checkOverflow = false } = {},
) {
  if (checkOverflow) await assertNoHorizontalOverflow(page, name);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  await optimize(file);
  shots.push(file);
  process.stdout.write(`  ✓ ${file}\n`);
}

/** Give lazy chunks, fonts, and the fade-in a beat to settle. */
async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  // CHROMIUM_PATH lets a machine whose Chromium build predates this
  // Playwright's pinned revision reuse the one it already has.
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  );

  const desktop = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  await desktop.addInitScript(() => {
    localStorage.setItem("has_session", "1");
    localStorage.setItem("theme", "light");
  });

  const page = await desktop.newPage();

  // 1 — the admin hub, with the prompt that leads into the workflow
  await installRoutes(desktop, scenarios.empty);
  await page.goto(`${BASE}/inventory/admin`);
  await page.getByText("Finish inventory setup").waitFor();
  await settle(page);
  await shoot(page, "05-72-setup-prompt");

  // 2 — step 1, rooms, with nothing declared yet
  await page.goto(`${BASE}/inventory/admin/setup?step=0`);
  await page.getByRole("heading", { name: "Rooms" }).waitFor();
  await settle(page);
  await shoot(page, "05-73-setup-rooms");

  // Everything past step 1 is a populated screen that the seeded department
  // renders truthfully, so `capture.mjs` owns those ids (05-74 through 05-78,
  // 05-81) and this stops here. Writing them from fixtures too would mean two
  // sources racing for the same filenames, and the last one run would win.
  //
  // The remaining steps are still *walked* below, at phone width, for the
  // layout check — which needs no seeded data to be worth running.

  // Phone width: every step checked for overflow, one of them photographed.
  const phone = await browser.newContext({
    viewport: MOBILE,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    colorScheme: "light",
  });
  await phone.addInitScript(() => {
    localStorage.setItem("has_session", "1");
    localStorage.setItem("theme", "light");
  });
  const phonePage = await phone.newPage();

  // Every step gets the overflow check at phone width — the footer row differs
  // per step (the last one swaps Continue for a wider link), and each preset
  // card, select and button is a chance to push the page sideways. Only the
  // step a guide actually pictures is written out; an unreferenced PNG in git
  // is just weight.
  const phoneSteps = [
    { step: 0, scenario: scenarios.empty, heading: "Rooms" },
    { step: 1, scenario: scenarios.rooms, heading: "Storage areas" },
    { step: 2, scenario: scenarios.storage, heading: "Categories" },
    { step: 3, scenario: scenarios.categories, heading: "First items" },
    { step: 4, scenario: scenarios.done, heading: "Setup complete" },
  ];

  for (const { step, scenario, heading, shot } of phoneSteps) {
    await installRoutes(phone, scenario);
    await phonePage.goto(`${BASE}/inventory/admin/setup?step=${step}`);
    await phonePage.getByRole("heading", { name: heading }).waitFor();
    await settle(phonePage);
    if (shot) {
      await shoot(phonePage, shot, { checkOverflow: true });
    } else {
      await assertNoHorizontalOverflow(
        phonePage,
        `step ${step} at phone width`,
      );
      process.stdout.write(`  · step ${step} checked at phone width\n`);
    }
  }

  await browser.close();
  process.stdout.write(`\n${shots.length} screenshots written to ${OUT}\n`);

  if (problems.length > 0) {
    process.stderr.write(
      `\nLayout problems found:\n${problems.map((p) => `  ✗ ${p}`).join("\n")}\n`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack ?? err)}\n`);
  process.exit(1);
});
