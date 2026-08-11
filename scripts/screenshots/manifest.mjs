/**
 * Declarative list of documentation screenshots.
 *
 * Each entry ties one placeholder in `docs/training/*.md` to the application
 * state that fills it:
 *
 *   id       output filename (without .png) and the key `apply_placeholders.py`
 *            matches on — keep it stable once a shot has been applied
 *   doc      training guide the placeholder lives in
 *   line     1-based line number of the `> **Screenshot ...` marker as of the
 *            time the entry was written; only a hint, since applying an earlier
 *            shot shifts every line below it
 *   anchor   opening words of the placeholder's own description; how the applier
 *            finds the placeholder once the line hint has gone stale
 *   alt      alt text written into the markdown image tag
 *   route    path to visit, relative to the dev server root
 *   auth     'admin' (default), 'member' to shoot what an ordinary member sees,
 *            or 'anonymous' for a signed-out page. Each runs in its own browser
 *            context, created on first use
 *   theme    'dark' to shoot in dark mode; default light. The app's theme
 *            defaults to "system", so this is driven by the context's
 *            colorScheme rather than by clicking the theme switcher
 *   prepare  optional async (page) => void that drives the UI into the pictured
 *            state (open a modal, switch a tab, expand a panel)
 *   selector optional CSS/locator to clip to instead of the full viewport
 *   fullPage capture the whole scroll height rather than the viewport
 *   viewport 'mobile' to shoot at phone width instead of desktop
 *   holdBack why the shot must not be applied yet, even though it captures
 *            cleanly — for a page that renders a misleading picture rather than
 *            an empty one, which the empty-state check cannot see
 *
 * Entries are grouped by guide and ordered by the placeholder's position in it.
 * This file covers the placeholders a plain route visit satisfies; the ones
 * that picture a modal, a specific tab, or a hover state still need `prepare`
 * steps and are tracked in `docs/training/SCREENSHOT_STATUS.md`.
 */

export const DEMO_CREDENTIALS = {
  username: "chief",
  password: "DemoP@ssw0rd!2026",
};

/**
 * An ordinary member — no `training.manage`, no officer position.
 *
 * Shots marked `auth: "member"` sign in as this account. It is not
 * interchangeable with the administrator: several routes render a different
 * page for a member than for an officer (`/training/skills-testing` is the
 * member's Available Tests / My Results view, not the template library), so a
 * placeholder describing what a member sees can only be filled from a member's
 * session.
 *
 * Kept in step with DEMO_MEMBER_USERNAME / DEMO_MEMBER_PASSWORD in
 * seed_demo_data.py, which also guarantees this account exists, is not an
 * officer, and is not being forced to change its password.
 */
export const DEMO_MEMBER_CREDENTIALS = {
  username: "nbelhaj",
  password: "DemoMember!2026",
};

/**
 * Click a control by its visible label.
 *
 * Matches buttons, tabs and links, because which of the three a given tab strip
 * uses is not predictable from the outside — Settings renders its sections as
 * links while Medical Screening renders the same shape as buttons, and a
 * button-only lookup simply times out on the former.
 */
export function clickByName(name) {
  return async (page) => {
    const target = page
      .getByRole("button", { name })
      .or(page.getByRole("tab", { name }))
      .or(page.getByRole("link", { name }))
      // Last resort: an <a> with no href, or a div wired up with onClick, has
      // no implicit role at all, so match the visible text directly.
      .or(page.locator("a, [role='tab'], button").filter({ hasText: name }));
    // Responsive layouts render the same nav twice — a horizontal strip for
    // phones and a sidebar for desktop — and the phone copy comes first in the
    // DOM. It is display:none at this viewport, so clicking it just times out.
    // Take the first *visible* match instead of the first match.
    const visible = target.locator("visible=true");
    const control = (await visible.count()) ? visible.first() : target.first();
    // Settings renders its section tabs below the fold on a 900px viewport, and
    // Playwright's actionability check times out on a control it cannot reach.
    await control.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
    await control.click({ timeout: 10_000 });
  };
}

/**
 * Navigate to a public room-display route.
 *
 * Both the kiosk and the guest sign-in page are addressed by the *location's*
 * display code plus, for the sign-in page, the event id — neither of which the
 * manifest can know, since the seeder mints the code and the event afresh. The
 * lookup runs against the public display API rather than a signed-in one: these
 * shots have no session, which is the point of the feature.
 *
 * `routeFor` receives (displayCode, eventId).
 */
export function withDisplayCode(routeFor) {
  return async (page, { lookupPage }) => {
    const admin = await lookupPage();
    const codes = await admin.evaluate(async () => {
      const response = await fetch("/api/v1/locations", {
        credentials: "include",
      });
      if (!response.ok) return [];
      const body = await response.json();
      const rows = Array.isArray(body) ? body : body.locations || [];
      return rows
        .map((row) => row.display_code || row.displayCode)
        .filter(Boolean);
    });
    for (const code of codes) {
      const event = await page.evaluate(async (displayCode) => {
        const response = await fetch(`/api/public/v1/display/${displayCode}`);
        if (!response.ok) return null;
        const body = await response.json();
        // Guest check-in is the whole subject of these shots, so a room whose
        // live event does not have it on is the wrong room, not a fallback.
        return (
          (body.current_events || []).find((e) => e.allow_guest_check_in) ??
          null
        );
      }, code);
      if (event) {
        await page.goto(
          `${new URL(page.url()).origin}${routeFor(code, event.event_id)}`,
          {
            waitUntil: "domcontentloaded",
          },
        );
        return;
      }
    }
    throw new Error(
      "withDisplayCode: no room display has a live event with guest check-in on",
    );
  };
}

/**
 * Open the first shift report card in whichever view is showing.
 *
 * A report card is a collapsed summary; everything a reviewer acts on — the
 * reviewer's note, Re-Review Report, the draft's Edit, a trainee's Acknowledge
 * — is inside it. The header is a plain <button> with no accessible name of
 * its own (its content is the trainee name and a row of stat spans), so it is
 * reached positionally rather than by label.
 */
export async function expandFirstReportCard(page) {
  const header = page
    .locator("div.rounded-xl > button:visible")
    .filter({ hasText: /\d+(\.\d+)?h/ })
    .first();
  await header.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
  await header.click({ timeout: 10_000 });
  // The body animates open; the shot is otherwise taken mid-expand.
  await page.waitForTimeout(400);
}

/**
 * Select a section in the Shift Reports settings panel.
 *
 * The panel renders its section list *twice* — a label-only strip for phones
 * and a label-plus-description sidebar for desktop — and hides whichever does
 * not match the viewport. So the desktop button's accessible name is the label
 * followed by its description ("Checklist Timing Start/end of shift checklist
 * windows"), which an exact-label match never matches, while the label-only
 * match resolves to the phone strip and times out clicking something hidden.
 * Anchoring on the label text inside a *visible* button avoids both.
 */
export function clickSettingsSection(label) {
  return async (page) => {
    const button = page
      .locator(
        "nav[aria-label='Shift report settings sections'] button:visible",
      )
      .filter({ has: page.getByText(label, { exact: true }) })
      .first();
    await button.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
    await button.click({ timeout: 10_000 });
  };
}

/**
 * Navigate to a detail page whose id the manifest cannot know.
 *
 * Record ids are minted by the seeder on every run, so detail shots have to
 * discover one at capture time. Clicking through the list is fragile — some
 * lists render anchors, some clickable rows, some cards whose only link is an
 * action icon — so this asks the API instead, using the page's own session, and
 * navigates straight to the resulting route.
 *
 *   apiPath   collection endpoint, relative to /api/v1
 *   routeFor  (id) => path to visit
 *   listKey   optional container key when the response is not a bare array
 *   match     optional (record) => boolean picking which record to open
 *
 * `match` matters more than it looks. Without it a shot opens whatever the API
 * returns first, which is not a stable choice: adding back-dated events to the
 * seeder silently repointed the event-detail shot at an old event with no RSVPs
 * and emptied a screenshot that had been correct for weeks. A shot that needs a
 * record in a particular state should say so.
 */
export function openFirstFromApi(apiPath, routeFor, listKey, match) {
  return async (page) => {
    const records = await page.evaluate(
      async ([path, key]) => {
        const response = await fetch(`/api/v1${path}`, {
          credentials: "include",
        });
        if (!response.ok) return [];
        const body = await response.json();
        return Array.isArray(body)
          ? body
          : body[key] || body.items || body.results || body.data || [];
      },
      [apiPath, listKey ?? ""],
    );
    const chosen = match ? records.find(match) : records[0];
    if (!chosen?.id) {
      throw new Error(
        `openFirstFromApi: ${apiPath} returned no ${match ? "matching " : ""}records`,
      );
    }
    await page.goto(new URL(routeFor(chosen.id), page.url()).toString(), {
      waitUntil: "domcontentloaded",
    });
  };
}

/** True for an event that has started but not finished. */
export const isInProgress = (event) => {
  const now = new Date().toISOString();
  const start = event.start_datetime ?? event.startDatetime ?? "";
  const end = event.end_datetime ?? event.endDatetime ?? "";
  return start <= now && end >= now;
};

/** True for an event still in the future, which is where the RSVPs are. */
export const isUpcoming = (event) => {
  const start = event.start_datetime ?? event.startDatetime ?? "";
  return start > new Date().toISOString();
};

/**
 * True for an event still open for RSVPs.
 *
 * "Upcoming" is not enough. The RSVP button needs `requires_rsvp` *and* a
 * deadline still in the future, and the seeder sets that deadline a day before
 * the event — so the nearest upcoming event, the one `isUpcoming` picks first,
 * has usually closed already. That is what left the RSVP modal shot clicking a
 * button that was not on the page.
 *
 * The list response carries `requires_rsvp` but not `rsvp_deadline`, so the
 * window is inferred from the start: two days' margin clears the seeder's
 * one-day lead with room to spare.
 */
export const isRsvpOpen = (event) => {
  if (!(event.requires_rsvp ?? event.requiresRsvp)) return false;
  if (event.is_cancelled ?? event.isCancelled) return false;
  const start = event.start_datetime ?? event.startDatetime ?? "";
  const margin = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  return start > margin;
};

/**
 * Re-open the current route with query parameters taken from an API record.
 *
 * The print views are addressed by query string rather than path — they read
 * `?id=` and render "No member ID provided" without it. Same reasoning as
 * openFirstFromApi: the id is minted per seed, so it has to be discovered at
 * capture time.
 */
export function withQueryFromApi(apiPath, listKey, paramsFor, match) {
  return async (page) => {
    const records = await page.evaluate(
      async ([path, key]) => {
        const response = await fetch(`/api/v1${path}`, {
          credentials: "include",
        });
        if (!response.ok) return [];
        const body = await response.json();
        return Array.isArray(body)
          ? body
          : body[key] || body.items || body.results || body.data || [];
      },
      [apiPath, listKey ?? ""],
    );
    const chosen = match ? records.find(match) : records[0];
    if (!chosen) {
      throw new Error(
        `withQueryFromApi: ${apiPath} returned no ${match ? "matching " : ""}records`,
      );
    }
    const url = new URL(page.url());
    for (const [key, value] of Object.entries(paramsFor(chosen))) {
      if (value != null) url.searchParams.set(key, String(value));
    }
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  };
}

/**
 * Re-open the current route with `?ids=` naming several records at once.
 *
 * The shared label print page renders one label per id in that parameter, so a
 * sheet has to be addressed with the whole set — unlike the print views
 * withQueryFromApi serves, which take a single record.
 */
export function withIdsFromApi(apiPath, listKey, limit = 6) {
  return async (page) => {
    const ids = await page.evaluate(
      async ([path, key, max]) => {
        const response = await fetch(`/api/v1${path}`, {
          credentials: "include",
        });
        if (!response.ok) return [];
        const body = await response.json();
        const records = Array.isArray(body)
          ? body
          : body[key] || body.items || body.results || body.data || [];
        return records
          .map((record) => record.id)
          .filter(Boolean)
          .slice(0, max);
      },
      [apiPath, listKey ?? "", limit],
    );
    if (!ids.length) {
      throw new Error(`withIdsFromApi: ${apiPath} returned no records`);
    }
    const url = new URL(page.url());
    url.searchParams.set("ids", ids.join(","));
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  };
}

/**
 * Fill the Create Training Session form's start date and time.
 *
 * Two controls below it are conditional on it: the Quick Duration row renders
 * only once `start_datetime` is set, and the recurrence block's preview has
 * nothing to describe without one. The date is fixed rather than computed from
 * today so the shot does not change every day it is re-taken.
 */
export async function setSessionStart(page) {
  const block = page
    .locator("div")
    .filter({ has: page.locator("label", { hasText: "Start Date & Time" }) })
    .filter({ has: page.locator('input[type="date"]') })
    .last();
  await block.waitFor({ timeout: 15_000 });
  await block.locator('input[type="date"]').first().fill("2026-09-15");
  // Three selects, not one: hour (12-hour), minute (00/15/30/45) and AM/PM.
  // They are addressed by index because their aria-labels are built from a
  // placeholder the caller supplies, which this form leaves unset.
  const times = block.locator("select");
  await times.nth(0).selectOption("9");
  await times.nth(1).selectOption("00");
  await times.nth(2).selectOption("AM");
  await page.waitForTimeout(600);
}

/**
 * Advance the Create Training Session wizard to its Training Info step.
 *
 * The form is a four-step wizard — Event Details, Training Info, Settings,
 * Review — and the course picker lives on step 2, not on the page the route
 * opens. Step 1 needs a title and a start/end time before Next will move.
 */
export async function openSessionTrainingInfo(page) {
  await page
    .getByPlaceholder("e.g., CPR/AED Renewal Training")
    .fill("Quarterly Pump Operations Refresher", { timeout: 15_000 });
  await setSessionStart(page);
  await page
    .getByRole("button", { name: /^2 hours$/ })
    .click({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^Next$/ }).click({ timeout: 10_000 });
  await page.waitForTimeout(900);
}

/** True for a shift whose date has passed — where the logged runs are. */
export const isPastShift = (shift) => {
  const day = shift.shift_date ?? shift.shiftDate ?? "";
  return day && day < new Date().toISOString().slice(0, 10);
};

/** True for a shift still to come — where the assign and edit controls are. */
export const isFutureShift = (shift) => {
  const day = shift.shift_date ?? shift.shiftDate ?? "";
  return day && day > new Date().toISOString().slice(0, 10);
};

/**
 * True for a shift that actually has people on it.
 *
 * The seeder tolerates the API refusing to double-book a member across
 * overlapping shifts, so some seeded shifts end up with no crew at all. A panel
 * shot that lands on one of those reads "No crew assigned yet", which is not
 * what the shift guide is illustrating.
 */
export const isStaffedShift = (shift) =>
  Boolean(shift.shift_officer_id ?? shift.shiftOfficerId);

/** True for a staffed shift that also has runs logged against it. */
export const hasLoggedCalls = (shift) =>
  isStaffedShift(shift) && (shift.call_count ?? shift.callCount ?? 0) > 0;

/**
 * Open the shift detail panel on a shift that actually has a crew.
 *
 * The shift list carries no assignment count, and `shift_officer_id` turned out
 * to be a poor proxy — a shift can name an officer whose assignment the API
 * refused as a double-booking, leaving the panel reading "No crew assigned yet".
 * So this asks each candidate's detail endpoint in turn and takes the first one
 * that really is staffed.
 *
 *   extraMatch  optional further condition on the list record (past, future, …)
 */
export function openStaffedShift(extraMatch) {
  return async (page) => {
    const id = await page.evaluate(
      async ([extra]) => {
        const pickList = (body) =>
          Array.isArray(body) ? body : body.shifts || body.items || [];
        const response = await fetch("/api/v1/scheduling/shifts?limit=100", {
          credentials: "include",
        });
        if (!response.ok) return null;
        // eslint-disable-next-line no-new-func
        const matches = extra ? new Function(`return ${extra}`)() : () => true;
        for (const shift of pickList(await response.json()).filter(matches)) {
          // The roster comes from the assignments collection. The shift detail
          // response has no assignment list, and its `attendees` field is
          // check-in attendance — a different thing that is empty on a shift
          // nobody has checked into yet.
          const detail = await fetch(
            `/api/v1/scheduling/shifts/${shift.id}/assignments`,
            { credentials: "include" },
          );
          if (!detail.ok) continue;
          const body = await detail.json();
          const crew = Array.isArray(body) ? body : body.assignments || [];
          if (crew.length) return shift.id;
        }
        return null;
      },
      [extraMatch ? extraMatch.toString() : ""],
    );
    if (!id) throw new Error("openStaffedShift: no shift with a crew found");
    const url = new URL(page.url());
    url.searchParams.set("shift", id);
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  };
}

/**
 * Open an election's detail page and switch to one of its workflow tabs.
 *
 * The tabs are component state rather than a query parameter, so they can only
 * be reached by clicking. Matched on the tab's `id` rather than its label: the
 * Ballot tab renders a count badge inside the button, so its accessible name is
 * "Ballot 1" and an anchored label match never fires. The election id is minted
 * per seed, hence the lookup.
 */
/**
 * The seeded election that has candidates. Elections are listed newest-first
 * and the draft bylaw vote comes back before the officer election, so a shot
 * that just takes the first record lands on an election nobody has been
 * nominated for and every tab shows its empty state.
 */
/**
 * Open the prospective-members settings page with a pipeline selected.
 *
 * The page renders a "Select a pipeline" placeholder until one is chosen from
 * the list on the left — every configuration panel the guides describe is
 * behind that click.
 */
/**
 * Open a named applicant's detail drawer.
 *
 * Table view is the reliable entry: the name cell carries the click handler,
 * where the kanban card's clickable region is a styled div with no role.
 */
/**
 * Pick a room on the Storage Areas page.
 *
 * The page lists nothing until a room is chosen — its area query is keyed on
 * the room id — so every shot of it has to make that choice first. Takes the
 * first room that actually has areas under it rather than the first in the
 * list, since a room with none renders the same empty prompt.
 */
export async function selectStorageRoom(page) {
  const room = page.locator("#room-select");
  await room.waitFor({ timeout: 10_000 });
  const options = await room
    .locator("option")
    .evaluateAll((nodes) => nodes.map((n) => n.value).filter(Boolean));
  for (const value of options) {
    await room.selectOption(value);
    await page.waitForTimeout(600);
    if (
      await page.getByRole("button", { name: /^Show \d+ items? in / }).count()
    ) {
      return;
    }
  }
}

/**
 * Open a named integration's connect dialog.
 *
 * Every card carries an identical "Connect" button and the dialog is component
 * state with no URL of its own, so the click has to be scoped to the card by
 * the provider's name.
 */
export function openIntegrationConnect(providerName) {
  return async (page) => {
    const card = page
      .locator(".stat-card")
      .filter({ hasText: providerName })
      .first();
    await card.waitFor({ timeout: 10_000 });
    await card
      .getByRole("button", { name: "Connect" })
      .click({ timeout: 10_000 });
  };
}

export function openApplicantDrawer(name) {
  return async (page) => {
    await clickByName(/^table$/i)(page);
    await page
      .getByText(name, { exact: true })
      .first()
      .click({ timeout: 10_000 });
    await page.waitForTimeout(600);
  };
}

export function openPipelineSettings() {
  return async (page) => {
    await page
      .getByText(/pipeline$/i)
      .filter({ hasText: /pipeline/i })
      .first()
      .click({ timeout: 10_000 });
    await page.waitForTimeout(500);
  };
}

export const isNominatingElection = (election) =>
  (election.status ?? "") === "nominations";

export function openElectionTab(tabId, match) {
  return async (page) => {
    await openFirstFromApi(
      "/elections?limit=20",
      (id) => `/elections/${id}`,
      "elections",
      match,
    )(page);
    const tab = page.locator(`#tab-${tabId}`);
    await tab.waitFor({ timeout: 10_000 });
    await tab.click({ timeout: 10_000 });
  };
}

/**
 * Open the shift detail panel on the first future shift with exactly one seat
 * still open.
 *
 * One open seat, not two: the board then shows a full set of crew rows with
 * their own controls *and* a single Assign / Sign Up row, which is what the
 * permission placeholders are about. The 2+-open case is already pictured by
 * 03-54, and its board is mostly empty rows.
 */
function openPartStaffedShift(shotId) {
  return async (page) => {
    const id = await page.evaluate(async () => {
      const response = await fetch("/api/v1/scheduling/shifts?limit=200", {
        credentials: "include",
      });
      if (!response.ok) return null;
      const body = await response.json();
      const rows = Array.isArray(body) ? body : body.shifts || body.items || [];
      const today = new Date().toISOString().slice(0, 10);
      for (const shift of rows) {
        const day = shift.shift_date ?? shift.shiftDate ?? "";
        if (day <= today) continue;
        const seats = (shift.positions ?? []).length;
        if (!seats) continue;
        const detail = await fetch(
          `/api/v1/scheduling/shifts/${shift.id}/assignments`,
          { credentials: "include" },
        );
        if (!detail.ok) continue;
        const crew = await detail.json();
        const list = Array.isArray(crew) ? crew : crew.assignments || [];
        // `assignment_status`, not `status` — the latter is undefined here and
        // silently counts cancelled members toward the crew.
        const active = list.filter((row) =>
          ["assigned", "confirmed"].includes(
            row.assignment_status ?? row.assignmentStatus,
          ),
        );
        if (seats - active.length === 1) return shift.id;
      }
      return null;
    });
    if (!id) throw new Error(`${shotId}: no future shift has exactly one open seat`);
    const url = new URL(page.url());
    url.searchParams.set("shift", id);
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
  };
}

/** Open the Shift Reports tab and switch to one of its views. */
function openReportView(name) {
  return async (page) => {
    await page
      .getByRole("button", { name })
      .first()
      .click({ timeout: 20_000 });
    await page.waitForTimeout(2500);
  };
}

/**
 * Open the New Shift Completion Report form on a past ladder shift, fill the
 * shared data, and open the one trainee's evaluation panel with three skills
 * scored and a task added.
 *
 * A ladder rather than an engine because its apparatus-type mapping is the one
 * whose skills (aerial placement, ground ladder throw) could not be mistaken
 * for the department-wide defaults — which is the whole point of the mapping.
 */
async function openBatchReportForm(page) {
  await page
    .getByRole("button", { name: /New/ })
    .first()
    .click({ timeout: 20_000 });
  await page.waitForTimeout(2500);
  // The shift picker is a list of cards, not a select — the first ladder shift
  // in it is the one whose crew carries a trainee.
  await page
    .getByText(/Ladder 4 — \d{4}-\d{2}-\d{2}/)
    .first()
    .click({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  await page
    .getByRole("button", { name: /^Evaluate$/ })
    .first()
    .click({ timeout: 20_000 });
  await page.waitForTimeout(2000);
  // Three skills at three different scores, so the row reads as a scale rather
  // than as a single highlighted button.
  const scored = [
    ["Aerial placement", "4"],
    ["Forcible entry", "2"],
    ["Ventilation", "3"],
  ];
  for (const [skill] of scored) {
    await page
      .getByRole("button", { name: new RegExp(`^${skill}$`) })
      .first()
      .click({ timeout: 15_000 });
    await page.waitForTimeout(400);
  }
  for (const [skill, score] of scored) {
    const row = page
      .locator("div")
      .filter({ has: page.getByRole("button", { name: `\u2713 ${skill}` }) })
      .last();
    await row.getByRole("button", { name: score, exact: true }).first().click();
    await page.waitForTimeout(300);
  }
  // One task, to show the row the "+ Add" control appends pre-filled from the
  // apparatus-type mapping.
  await page
    .getByRole("button", { name: /^Add$/ })
    .first()
    .click({ timeout: 15_000 });
  await page.waitForTimeout(1200);
}

/**
 * Fill the impact planner's filters and run an analysis.
 *
 * A size breakdown and a stock category, or the results are a member list with
 * none of the per-size shortfall and cost columns — and none of the four
 * actions the guide documents underneath them.
 */
async function runImpactAnalysis(page) {
  const sizeField = page.locator('select[aria-label="Size needed"]');
  const sizes = await sizeField
    .locator("option")
    .evaluateAll((els) => els.map((e) => e.getAttribute("value")).filter(Boolean));
  if (sizes[0]) await sizeField.selectOption(sizes[0]);
  await page.waitForTimeout(600);
  // The stock select only renders once a size field is chosen, and only a
  // stock category turns the size panel into shortfall-and-cost columns.
  const stock = page
    .locator("select")
    .filter({ hasText: /subtract current stock/i });
  const opts = await stock
    .locator("option")
    .evaluateAll((els) => els.map((e) => e.getAttribute("value")).filter(Boolean));
  if (opts[0]) await stock.selectOption(opts[0]);
  await page.waitForTimeout(400);
  await page
    .getByRole("button", { name: /Analyze Impact/i })
    .click({ timeout: 15_000 });
  // The analysis is a round trip over the whole roster.
  await page.waitForTimeout(3000);
}

export const SHOTS = [
  {
    id: "03-63-batch-report-form",
    doc: "03-scheduling.md",
    line: 1632,
    anchor: "Screenshot of the batch report creation form",
    alt: "The batch shift-report form — shared hours and calls, the whole crew, and one trainee's evaluation open",
    route: "/scheduling?tab=shift-reports",
    prepare: openBatchReportForm,
    fullPage: true,
  },
  {
    id: "03-64-skill-score-buttons",
    doc: "03-scheduling.md",
    line: 1705,
    anchor: "Screenshot of the skills section in the evaluation panel",
    alt: "Skills Observed — three skills scored 1-5, each showing the department's label for the score chosen",
    route: "/scheduling?tab=shift-reports",
    prepare: openBatchReportForm,
    // Clipped to the block: the score rows are small, and a full-page frame of
    // the form renders them at a size the caption cannot rescue.
    selector: "div:has(> label:text-is('Skills Observed'))",
  },
  {
    id: "03-66-print-report",
    doc: "03-scheduling.md",
    line: 1806,
    anchor: "Screenshot of the print-formatted shift report",
    alt: "The print layout of a shift report — its sections, the skills and tasks tables, and the two signature lines",
    // The page needs a report id, and it calls window.print() 600ms after
    // loading. Stubbing print has to happen before the navigation, so this
    // shot arrives on /scheduling and then goes to the print page itself.
    route: "/scheduling",
    prepare: async (page) => {
      const id = await page.evaluate(async () => {
        const response = await fetch("/api/v1/training/shift-reports/all?limit=50", {
          credentials: "include",
        });
        if (!response.ok) return null;
        const rows = await response.json();
        const list = Array.isArray(rows) ? rows : rows.reports || [];
        // A reviewed one: the printed sheet carries a reviewer block, and the
        // guide lists it among what is included.
        const reviewed = list.find(
          (row) => (row.review_status ?? row.reviewStatus) === "approved",
        );
        return (reviewed || list[0] || {}).id ?? null;
      });
      if (!id) throw new Error("03-66: no shift report to print");
      await page.addInitScript(() => {
        // Headless Chromium does not raise a print dialog, but the page also
        // races the screenshot against it. Stubbed so the capture is of the
        // page rather than of whatever the browser does with a print request.
        window.print = () => {};
      });
      await page.goto(
        new URL(
          `/scheduling/shift-reports/print?id=${id}`,
          page.url(),
        ).toString(),
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForTimeout(2500);
    },
    // The letter-width sheet, not the browser tab around it. The page opens in
    // the app shell — the print stylesheet drops the navigation, but on screen
    // it is still there, and the sheet is what the placeholder is about.
    selector: "div.max-w-\\[8\\.5in\\]",
  },
  {
    id: "03-65-review-modal-full",
    doc: "03-scheduling.md",
    line: 1211,
    anchor: "Screenshot of the review modal scrolled to its foot",
    alt: "The review modal scrolled to its foot — the redaction choices, the reviewer comment box, and Flag for Revision and Approve",
    route: "/scheduling?tab=shift-reports",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /Review Queue/ })
        .first()
        .click({ timeout: 20_000 });
      await page.waitForTimeout(2500);
      // The Review Report button is inside the opened card, not on the
      // collapsed one — the card header is the disclosure control.
      await page
        .locator("div.rounded-xl > button")
        .first()
        .click({ timeout: 15_000 });
      await page.waitForTimeout(1200);
      await page
        .getByRole("button", { name: /^Review Report$/ })
        .first()
        .click({ timeout: 15_000 });
      await page.waitForTimeout(1800);
      // The dialog is taller than the viewport and scrolls in its own
      // container, so neither a viewport shot nor an element clip reaches the
      // reviewer-notes field or the Approve / Flag buttons. Scroll the dialog
      // itself to its end: the controls are what this shot is for, and the
      // report content above them is already pictured on the flagged card.
      await page.evaluate(() => {
        const dialog = document.querySelector("div.fixed.inset-0");
        if (!dialog) return;
        const scroller = [...dialog.querySelectorAll("*")].find(
          (el) => el.scrollHeight > el.clientHeight + 40,
        );
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
      await page.waitForTimeout(700);
    },
    selector: "div.fixed.inset-0 > div",
  },
  {
    id: "03-57-shift-assignment-controls",
    doc: "03-scheduling.md",
    line: 1022,
    anchor: "Screenshot of the shift detail panel's crew board",
    alt: "A shift's crew board with its per-member controls, an open seat, and the Edit and Delete buttons in the header",
    route: "/scheduling",
    prepare: openPartStaffedShift("03-57"),
    fullPage: false,
  },
  {
    id: "03-58-assign-member-form",
    doc: "03-scheduling.md",
    line: 1278,
    anchor: "Screenshot of the Assign Member form",
    alt: "The Assign Member form on a shift, with its position and member pickers",
    route: "/scheduling",
    prepare: async (page) => {
      await openPartStaffedShift("03-58")(page);
      // The form is behind "Assign Member" on a board with riding positions,
      // and behind "Assign" on one without. Either name opens the same form.
      await page
        .getByRole("button", { name: /^Assign( Member)?$/ })
        .first()
        .click({ timeout: 15_000 });
      // Wait for the member list to load rather than for a fixed pause: the
      // select renders empty first and a fixed wait pictured it that way.
      await page
        .locator("#assign-member-search")
        .waitFor({ timeout: 15_000 });
      await page.waitForTimeout(1500);
    },
    // Clipped to the form. The panel scrolls in its own container, so
    // `window.scrollBy` moves the calendar behind it and leaves the form
    // hanging off the bottom of the frame; an element screenshot brings it
    // into view by itself, and the form is the subject anyway.
    selector: "div.rounded-lg:has(> h4:text-is('Assign Member'))",
  },
  {
    id: "03-59-open-shifts-signup",
    doc: "03-scheduling.md",
    line: 1285,
    anchor: "Screenshot of the Open Shifts tab showing shift cards",
    alt: "The Open Shifts tab as an ordinary member sees it, each card carrying its own Sign Up button",
    // A member, not the administrator: the placeholder is about a non-admin
    // seeing the button at all.
    auth: "member",
    route: "/scheduling?tab=open-shifts",
    prepare: async (page) => {
      // By the aria-label, not the visible text: the label overrides it for
      // the accessible name, and the text itself is `sm:inline` — on a narrow
      // viewport the button is the icon alone.
      await page
        .getByLabel("Sign up for this shift")
        .first()
        .waitFor({ timeout: 20_000 });
      await page.waitForTimeout(800);
    },
    fullPage: false,
  },
  {
    id: "03-60-dashboard-my-shifts",
    doc: "03-scheduling.md",
    line: 1304,
    anchor: 'Screenshot of the Dashboard "My Upcoming Shifts" panel',
    alt: "The dashboard's My Upcoming Shifts panel, listing only shifts the member is still on",
    auth: "member",
    route: "/dashboard",
    prepare: async (page) => {
      // The heading text sits in a span inside the h3, so `text-is` on the h3
      // does not match it; `has-text` does. Scrolled into view first because a
      // clipped element still below the fold never settles for a screenshot.
      const panel = page
        .locator("div.card:has(h3:has-text('My Upcoming Shifts'))")
        .first();
      await panel.waitFor({ timeout: 20_000 });
      await panel.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(1200);
    },
    // Clipped to the card, trailing space and all: it is a grid cell stretched
    // to match the notifications panel beside it. The viewport alternative puts
    // that panel in half the frame, and it is a column of near-identical
    // skills-test notices that reads as the subject of the shot.
    selector: "div.card:has(h3:has-text('My Upcoming Shifts'))",
  },
  {
    id: "03-61-review-queue-batch",
    doc: "03-scheduling.md",
    line: 1144,
    anchor: "Screenshot of the Review Queue with some but not all reports",
    alt: "The Review Queue with several reports selected and the batch approve and flag actions above them",
    route: "/scheduling?tab=shift-reports",
    prepare: async (page) => {
      await openReportView(/Review Queue/)(page);
      // Select some but not all, so the picture shows a partial selection
      // rather than a select-all that could be mistaken for the default.
      const boxes = page.locator("input.form-checkbox");
      await boxes.first().waitFor({ timeout: 15_000 });
      for (const index of [1, 2, 3]) {
        await boxes.nth(index).check({ force: true });
      }
      await page.waitForTimeout(900);
      await page.evaluate(() => window.scrollTo(0, 0));
    },
    fullPage: false,
  },
  {
    id: "03-62-flagged-queue",
    doc: "03-scheduling.md",
    line: 1160,
    anchor: "Screenshot of the Flagged view with one card opened",
    alt: "The Flagged view — two reports, one expanded to its reviewer's reason and Re-Review Report button",
    route: "/scheduling?tab=shift-reports",
    prepare: async (page) => {
      await openReportView(/^Flagged$/)(page);
      // The reason and the Re-Review action are in the expanded card, not on
      // the collapsed one; a list of collapsed cards shows only the badge.
      await page
        .getByRole("button", { name: /Re-Review Report/ })
        .first()
        .waitFor({ timeout: 20_000 })
        .catch(async () => {
          await page.locator("div.rounded-xl > button").first().click();
          await page.waitForTimeout(1200);
        });
      await page.waitForTimeout(800);
      await page.evaluate(() => window.scrollTo(0, 0));
    },
    fullPage: true,
  },
  {
    id: "03-50-vehicle-preset-picker",
    doc: "03-scheduling.md",
    line: 736,
    anchor:
      "Screenshot of the vehicle check preset picker showing the pre-built",
    alt: "The vehicle preset picker listing each pre-built check with its section and item counts",
    route: "/scheduling/equipment-check-templates/new",
    prepare: async (page) => {
      // A new template starts as "equipment", and Load Vehicle Preset only
      // renders on a vehicle or combined one.
      await page
        .locator("select")
        .filter({ hasText: /Vehicle/i })
        .first()
        .selectOption("vehicle", { timeout: 10_000 });
      await page.waitForTimeout(600);
      await page
        .getByRole("button", { name: /Load Vehicle Preset/i })
        .click({ timeout: 15_000 });
      await page.waitForTimeout(600);
    },
    selector: "div.border-orange-500\\/20",
  },
  {
    id: "03-51-admin-subpage-header",
    doc: "03-scheduling.md",
    line: 703,
    anchor: "Screenshot of one of the scheduling admin sub-pages",
    alt: "A scheduling admin sub-page with its back arrow and page header",
    // Patterns rather than Templates: the guide already pictures Templates
    // 460 lines above, and the point here is the header the four sub-pages
    // share, not that particular page.
    route: "/scheduling/patterns",
    fullPage: false,
  },
  {
    id: "05-60-admin-hub-groups",
    doc: "05-inventory.md",
    line: 1279,
    anchor:
      "Screenshot of the Inventory Admin hub showing the low-stock banner",
    alt: "The inventory admin hub with its cards grouped into sections",
    route: "/inventory/admin",
    fullPage: true,
  },
  {
    id: "05-61-item-barcode-fields",
    doc: "05-inventory.md",
    line: 1355,
    anchor:
      "Screenshot of an item detail page showing Barcode and Asset Tag in its",
    alt: "An item's barcode and asset tag on its detail page",
    route: "/inventory/items",
    prepare: openFirstFromApi(
      "/inventory/items?limit=20",
      (id) => `/inventory/items/${id}`,
      "items",
      (item) => Boolean(item.asset_tag ?? item.assetTag),
    ),
    fullPage: false,
  },
  {
    id: "03-56-bulk-confirm-shifts",
    doc: "03-scheduling.md",
    line: 1308,
    anchor:
      "Screenshot of the My Shifts tab with the outstanding assignments selected",
    alt: "The My Shifts bulk bar — every pending assignment selected, with Confirm All and Decline All",
    // A member's own assignments; the bar is about confirming your own shifts.
    auth: "member",
    route: "/scheduling?tab=my-shifts",
    prepare: async (page) => {
      // The bar renders only with more than one pending assignment, and the
      // buttons only once something is selected.
      const selectAll = page.getByText(/Select all \d+ pending/).first();
      await selectAll.waitFor({ timeout: 15_000 });
      await selectAll.click();
      await page.waitForTimeout(700);
      await page.evaluate(() => window.scrollTo(0, 0));
    },
    fullPage: false,
  },
  {
    id: "03-55-staffing-status-cards",
    doc: "03-scheduling.md",
    line: 1331,
    anchor: "Screenshot of the weekly schedule, its cards tinted green",
    alt: "The weekly schedule, its cards tinted green when fully staffed and amber when short",
    route: "/scheduling",
    prepare: async (page) => {
      // The staffing ratio only appears once a shift knows how many positions
      // it has, so wait for a card to render one rather than a fixed pause.
      await page
        .getByText(/\d+\/\d+/)
        .first()
        .waitFor({ timeout: 15_000 });
      await page.waitForTimeout(800);
      await page.evaluate(() => window.scrollTo(0, 0));
    },
    fullPage: false,
  },
  {
    id: "03-54-crew-board-open-slots",
    doc: "03-scheduling.md",
    line: 987,
    anchor: "Screenshot of a shift's Crew Board with one position filled",
    alt: "A shift's crew board — one filled position and three open, each with Assign and Sign Up",
    route: "/scheduling",
    prepare: async (page) => {
      // A shift with several slots still open: that is what puts open-position
      // rows on the board and brings up the bulk "Fill All Open" action, which
      // only appears once more than one slot is unfilled.
      const id = await page.evaluate(async () => {
        const response = await fetch("/api/v1/scheduling/shifts?limit=200", {
          credentials: "include",
        });
        if (!response.ok) return null;
        const body = await response.json();
        const rows = Array.isArray(body)
          ? body
          : body.shifts || body.items || [];
        const today = new Date().toISOString().slice(0, 10);
        for (const shift of rows) {
          const day = shift.shift_date ?? shift.shiftDate ?? "";
          if (day <= today) continue;
          const detail = await fetch(
            `/api/v1/scheduling/shifts/${shift.id}/assignments`,
            { credentials: "include" },
          );
          if (!detail.ok) continue;
          const crew = await detail.json();
          const list = Array.isArray(crew) ? crew : crew.assignments || [];
          const needed = shift.min_staffing ?? shift.minStaffing ?? 0;
          if (list.length >= 1 && needed - list.length >= 2) return shift.id;
        }
        return null;
      });
      if (!id)
        throw new Error("03-54: no future shift is part-staffed with 2+ open");
      const url = new URL(page.url());
      url.searchParams.set("shift", id);
      await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
    },
    fullPage: false,
  },
  {
    id: "03-52-apparatus-required-evoc",
    doc: "03-scheduling.md",
    line: 1536,
    anchor:
      "Screenshot of the Required EVOC Level control on an apparatus edit form",
    alt: "The Required EVOC Level control on an apparatus, set to the level needed to drive it",
    route: "/apparatus",
    prepare: async (page) => {
      // The control is on the apparatus *edit form*, not the detail page, and
      // it renders only once the organization has EVOC levels configured.
      const rig = await page.evaluate(async () => {
        const response = await fetch("/api/v1/apparatus?limit=100", {
          credentials: "include",
        });
        if (!response.ok) return null;
        const body = await response.json();
        // The list is paginated under `items`, not `apparatus`.
        const rows = Array.isArray(body)
          ? body
          : body.items || body.apparatus || [];
        // The rig with the highest requirement — the aerial — because it is
        // also the one whose pump, tank and ladder specs are all filled in.
        // The list item does not carry the spec fields, so the level number
        // is what the choice is made on.
        const level = (row) =>
          (row.requiredEvocLevel || row.required_evoc_level || {})
            .levelNumber ?? 0;
        const withLevel = rows
          .filter(
            (row) => row.required_evoc_level_id || row.requiredEvocLevelId,
          )
          .sort((a, b) => level(b) - level(a));
        return withLevel[0] ? withLevel[0].id : null;
      });
      if (!rig)
        throw new Error("03-52: no apparatus has a required EVOC level");
      await page.goto(
        new URL(`/apparatus/${rig}/edit`, page.url()).toString(),
        {
          waitUntil: "domcontentloaded",
        },
      );
      const block = page.locator(
        "div:has(> label:has-text('Required EVOC Level'))",
      );
      await block.first().waitFor({ timeout: 15_000 });
      await block.first().scrollIntoViewIfNeeded({ timeout: 10_000 });
      await page.waitForTimeout(600);
    },
    selector: "div.grid:has(label:has-text('Required EVOC Level'))",
  },
  {
    id: "03-53-template-position-required",
    doc: "03-scheduling.md",
    line: 1346,
    anchor:
      "Screenshot of the Crew Positions block with Officer and Driver/Operator",
    alt: "Template crew positions, each with a button reading Required or Optional",
    route: "/scheduling/templates",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /New Template/i })
        .first()
        .click({ timeout: 15_000 });
      await page.waitForTimeout(900);
      const dialog = page.locator("div.fixed.inset-0");
      await dialog
        .getByPlaceholder(/e\.g\.|name/i)
        .first()
        .fill("Engine 1 — Night Shift")
        .catch(() => {});
      // A start and end time, so the template is not pictured with its two
      // required time fields blank.
      // Addressed by the accessible names TimeQuarterHour gives its three
      // selects. Counting selects from the top of the dialog puts these three
      // off, because the Vehicle picker precedes them.
      await page.waitForTimeout(400);
      // Three distinct positions, the last flipped to Optional, so the shot
      // shows the control in both states over a realistic crew rather than a
      // column of identical Firefighter rows.
      const addPosition = dialog
        .getByRole("button", { name: /Add Position/i })
        .first();
      const positionIndexes = async () =>
        dialog
          .locator("select")
          .evaluateAll((els) =>
            els
              .map((el, i) =>
                /Firefighter/.test(el.textContent || "") ? i : -1,
              )
              .filter((i) => i >= 0),
          );
      while ((await positionIndexes()).length < 3) {
        await addPosition.click({ timeout: 10_000 });
        await page.waitForTimeout(400);
      }
      // Indexes resolved once: changing a row's value drops it out of a
      // "contains Firefighter" filter, which shifts every later match.
      const rows = await positionIndexes();
      // By value, not label: the second option reads "Driver/Operator".
      for (const [offset, role] of ["officer", "driver"].entries()) {
        await dialog.locator("select").nth(rows[offset]).selectOption(role);
        await page.waitForTimeout(250);
      }
      await page.waitForTimeout(400);
      const toggles = dialog.getByRole("button", {
        name: /^(Required|Optional)$/,
      });
      const count = await toggles.count();
      if (count) await toggles.nth(count - 1).click();
      await page.waitForTimeout(600);
      await toggles
        .first()
        .scrollIntoViewIfNeeded({ timeout: 10_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
    // Clipped to the crew block. The dialog's Start/End Time selects sit
    // above it and stay unset — the shot is about the position rows, and a
    // pair of blank required fields in frame reads as a half-filled form.
    selector: "div:has(> label:has-text('Crew Positions'))",
    viewport: { width: 1440, height: 1300 },
  },
  {
    id: "05-64-label-settings",
    doc: "05-inventory.md",
    line: 593,
    anchor: "Screenshot of the label settings panel's orientation block",
    alt: "The label settings panel — size presets, auto-rotate, and the test-label download",
    route: "/inventory/print-labels",
    prepare: async (page) => {
      await withIdsFromApi("/inventory/items?limit=6", "items", 6)(page);
      await page
        .getByRole("button", { name: /^Settings$/ })
        .click({ timeout: 15_000 });
      await page.waitForTimeout(800);
      // A landscape preset, so the feed-direction diagram and the auto-rotate
      // note render — on a portrait label there is nothing to rotate and the
      // whole block the section is about stays hidden. The presets are
      // clickable cards, not a dropdown.
      await page
        .getByText('Rollo / Thermal 2" x 1"', { exact: true })
        .click({ timeout: 15_000 });
      await page.waitForTimeout(900);
      // Scrolled to the test-label button at the foot of the panel, so the
      // orientation block above it is in frame with it.
      await page
        .getByRole("button", { name: /Test Label/i })
        .first()
        .scrollIntoViewIfNeeded({ timeout: 15_000 });
      await page.waitForTimeout(600);
    },
    fullPage: false,
  },
  {
    id: "05-62-generate-variants",
    doc: "05-inventory.md",
    line: 251,
    anchor:
      "Screenshot of the Add Item dialog with Generate Sizes & Styles switched on",
    alt: "The Generate Sizes & Styles block with sizes and styles picked and the resulting item count",
    route: "/inventory/items",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /Add Item/i })
        .first()
        .click({ timeout: 15_000 });
      await page.waitForTimeout(800);
      // The toggle only renders for a category whose item type supports
      // variants — uniform, PPE, tool or equipment — so the category has to
      // be chosen before it appears.
      const category = page
        .locator("select")
        .filter({ hasText: /categor/i })
        .first();
      const options = await category.locator("option").evaluateAll((els) =>
        els
          .filter((e) => /uniform|ppe|gear|clothing/i.test(e.textContent || ""))
          .map((e) => e.getAttribute("value"))
          .filter(Boolean),
      );
      if (options[0]) await category.selectOption(options[0]);
      await page.waitForTimeout(500);
      // The checkbox is sr-only inside a label that wraps only the toggle
      // track; the caption beside it is a sibling span, so clicking the words
      // does nothing at all.
      await page
        .locator("fieldset input[type='checkbox']")
        .first()
        .check({ force: true, timeout: 10_000 });
      await page.waitForTimeout(700);
      for (const size of ["S", "M", "L", "XL"]) {
        await page
          .getByRole("button", { name: size, exact: true })
          .first()
          .click({ timeout: 5_000 })
          .catch(() => {});
      }
      for (const style of ["Short Sleeve", "Long Sleeve"]) {
        await page
          .getByRole("button", { name: style, exact: true })
          .first()
          .click({ timeout: 5_000 })
          .catch(() => {});
      }
      await page
        .getByPlaceholder("e.g. Navy, White, Red (comma-separated, optional)")
        .fill("Navy, White", { timeout: 10_000 });
      // A name, so the form is not pictured with its one required field
      // blank. Scoped to the dialog — the page's own search box is the first
      // input on the document and swallowed the text.
      await page
        .locator("div.fixed.inset-0 form input:not([type])")
        .first()
        .fill("Uniform Polo Shirt", { timeout: 10_000 });
      await page.waitForTimeout(700);
    },
    // The toggle and the chips are two sibling fieldsets, so a clip to
    // either shows half the story; the modal panel frames both.
    selector: "div.fixed.inset-0 > div",
    viewport: { width: 1440, height: 1400 },
  },
  {
    id: "05-63-variant-group-modal",
    doc: "05-inventory.md",
    line: 901,
    anchor:
      "Screenshot of the Add Variant Group dialog filled in for a structural coat",
    alt: "The variant group form with its name, category, pricing and unit-of-measure fields",
    route: "/inventory/admin/variant-groups",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /Add Group/i })
        .first()
        .click({ timeout: 15_000 });
      await page.waitForTimeout(800);
      // Filled in, so the shot shows what a group is rather than an empty
      // form: a turnout coat carried in sizes S–4XL.
      const dialog = page.locator("div.fixed.inset-0");
      await dialog
        .getByPlaceholder("e.g. Class A Dress Uniform")
        .fill("Structural Coat");
      await dialog
        .getByPlaceholder("Optional description")
        .fill(
          "NFPA 1971 structural firefighting coat, carried in sizes S through 4XL.",
        );
      const category = dialog.locator("select").first();
      const categories = await category.locator("option").evaluateAll((els) =>
        els
          .filter((e) => /ppe|gear|protect/i.test(e.textContent || ""))
          .map((e) => e.getAttribute("value"))
          .filter(Boolean),
      );
      if (categories[0]) await category.selectOption(categories[0]);
      const money = dialog.locator('input[placeholder="0.00"]');
      await money.nth(0).fill("895.00");
      await money.nth(1).fill("1200.00");
      await dialog.getByPlaceholder("e.g. each, pair, set").fill("each");
      await page.waitForTimeout(600);
    },
    selector: "div.fixed.inset-0 > div",
  },
  {
    // NOT YET CAPTURABLE — four approaches tried on 2026-08-10, all timing out
    // on the pencil: a hasText row filter, a two-`has` filter, walking up 6
    // then 12 ancestors from the button, and restricting to `:visible`. The
    // page itself is fine (a full-page shot shows the row, its "8 items"
    // subtitle and the pencil), so the next attempt should skip the list
    // entirely and open the editor by URL if the modal is addressable, or
    // click the pencil by bounding box from the row's text node. Left in place
    // rather than deleted so the reconnaissance is not repeated.
    id: "02-89-officer-only-steps",
    doc: "02-training.md",
    line: 347,
    anchor: "The requirement editor's checklist steps editor",
    alt: "The checklist steps editor, with two steps toggled to officer-only",
    route: "/training/programs",
    prepare: async (page) => {
      await openFirstFromApi(
        "/training/programs/programs",
        (id) => `/training/programs/${id}`,
        "programs",
        (program) => /Probationary/i.test(program.name || ""),
      )(page);
      await page.waitForTimeout(1500);
      // The checklist requirement is the only one with steps to hide.
      // Walk up from the pencil to whichever ancestor names the requirement.
      // Locator filters could not express this: the name and the action
      // buttons sit in sibling subtrees, so no single div both contains the
      // exact text and the button.
      const index = await page
        .locator('button[aria-label="Edit requirement"]:visible')
        .evaluateAll((buttons) =>
          buttons.findIndex((button) => {
            let node = button;
            for (let up = 0; up < 12 && node; up += 1) {
              if (
                (node.textContent || "").includes("Station Duties Checklist")
              ) {
                return true;
              }
              node = node.parentElement;
            }
            return false;
          }),
        );
      if (index < 0) throw new Error("02-89: no checklist requirement row");
      const pencil = page
        .locator('button[aria-label="Edit requirement"]:visible')
        .nth(index);
      await pencil.scrollIntoViewIfNeeded({ timeout: 15_000 });
      await pencil.click({ timeout: 15_000 });
      await page.waitForTimeout(1200);
      // Scroll to the last step rather than the section heading: the two
      // officer-only rows are at the foot of the list.
      await page
        .getByText("Background check returned")
        .first()
        .scrollIntoViewIfNeeded({ timeout: 15_000 });
      await page.waitForTimeout(600);
    },
    fullPage: false,
  },
  {
    id: "02-90-phase-prerequisites",
    doc: "02-training.md",
    line: 401,
    anchor: "The phase editor showing the prerequisite picker",
    alt: "A phase's prerequisite picker, with the helper text separating phase order from prerequisites",
    route: "/training/programs",
    prepare: async (page) => {
      await openFirstFromApi(
        "/training/programs/programs",
        (id) => `/training/programs/${id}`,
        "programs",
        (program) => /Probationary/i.test(program.name || ""),
      )(page);
      await page.waitForTimeout(1500);
      // The picker lists only *earlier* phases, so editing phase 1 renders
      // nothing at all — take the last phase on the page.
      const edit = page.locator('button[aria-label="Edit phase"]');
      await edit.first().waitFor({ timeout: 15_000 });
      await edit.last().click();
      await page.waitForTimeout(1200);
      const picker = page
        .locator("div")
        .filter({ has: page.getByText("Finish these phases first") })
        .last();
      await picker.scrollIntoViewIfNeeded({ timeout: 15_000 });
      // Ticked, not left blank: the section is about a phase held back until
      // earlier ones finish, and an untouched picker shows the opposite.
      const boxes = picker.locator('input[type="checkbox"]');
      const count = await boxes.count();
      for (let i = 0; i < count; i += 1) await boxes.nth(i).check();
      await page.waitForTimeout(600);
    },
    fullPage: false,
  },
  {
    id: "02-88-member-checklist-view",
    doc: "02-training.md",
    line: 332,
    anchor: "The member's view of the same checklist requirement",
    alt: "A member's progression view of a checklist, with the officer-only steps summarised beneath",
    // Only the member whose enrollment it is can open this view.
    auth: "member",
    route: "/training/my-training",
    prepare: async (page) => {
      await openFirstFromApi(
        "/training/programs/enrollments/me",
        (id) => `/training/my-progress/${id}`,
        "enrollments",
      )(page);
      await page.waitForTimeout(1500);
      // Scrolled to the "+N more steps your officer records" line rather than
      // to the requirement's heading: that line is the point of the section
      // and it sits at the foot of the block, below the fold otherwise.
      await page
        .getByText(/more steps? your officer records/)
        .first()
        .scrollIntoViewIfNeeded({ timeout: 15_000 });
      await page.waitForTimeout(700);
    },
    fullPage: false,
  },
  {
    id: "02-87-checklist-steps",
    doc: "02-training.md",
    line: 331,
    anchor: "An officer's view of a checklist requirement on a",
    alt: "A checklist requirement expanded to its steps, each with its own tick box",
    route: "/training/programs",
    prepare: async (page) => {
      // The probationary pipeline is the one carrying a checklist
      // requirement; the driver pipeline has none to expand.
      await openFirstFromApi(
        "/training/programs/programs",
        (id) => `/training/programs/${id}?tab=enrollments`,
        "programs",
        (program) => /Probationary/i.test(program.name || ""),
      )(page);
      await page.waitForTimeout(1500);
      // The member with real progress — two of the three enrolments sit at
      // 0%, and a progress panel of empty rows shows nothing being tracked.
      await page.getByText("Saoirse Nolan").first().click({ timeout: 15_000 });
      await page.waitForTimeout(1500);
      const checklist = page.getByText("Station Duties Checklist").first();
      await checklist.scrollIntoViewIfNeeded({ timeout: 15_000 });
      await checklist.click();
      await page.waitForTimeout(900);
    },
    fullPage: false,
  },
  {
    id: "02-85-syllabus-builder",
    doc: "02-training.md",
    line: 153,
    anchor: "Screenshot of the Course Syllabus Builder showing an ordered list",
    alt: "The syllabus builder listing a recruit school's classes with their day offsets and gaps",
    route: "/training/admin?tab=courses",
    prepare: async (page) => {
      const open = page.locator(
        'button[aria-label="Manage classes for Recruit School"]',
      );
      await open.waitFor({ timeout: 15_000 });
      await open.click();
      await page.waitForTimeout(1200);
    },
    // Clipped to the panel, on a viewport tall enough to hold every class:
    // at 900px the fifth row falls below the fold and the course library
    // shows through above and below the modal.
    selector: "div.fixed.inset-0 > div",
    viewport: { width: 1440, height: 1400 },
  },
  {
    id: "02-86-cohort-classes",
    doc: "02-training.md",
    line: 201,
    anchor:
      "Screenshot of a cohort's Classes tab, showing the numbered class timeline",
    alt: "A cohort's class timeline with dates, credit hours and sign-up counts",
    route: "/training/admin?tab=cohorts",
    prepare: async (page) => {
      await openFirstFromApi(
        "/training/cohorts",
        (id) => `/training/cohorts/${id}`,
        "cohorts",
      )(page);
      await page.waitForTimeout(1500);
    },
    fullPage: false,
  },
  {
    id: "02-80-session-course-autopopulate",
    doc: "02-training.md",
    line: 1728,
    anchor: "Screenshot of the course picker with an existing course chosen",
    alt: "The course picker with an existing course chosen and its details preview card underneath",
    route: "/training/admin?tab=sessions",
    prepare: async (page) => {
      await openSessionTrainingInfo(page);
      // Step 2 defaults to "Create new course for this training", which has
      // no picker and no preview card — the section is about the other branch.
      await page
        .getByText("Use existing course template", { exact: true })
        .click({ timeout: 15_000 });
      await page.waitForTimeout(500);
      const picker = page
        .locator("select")
        .filter({ hasText: "Select a course" })
        .first();
      const options = await picker
        .locator("option")
        .evaluateAll((els) =>
          els.map((e) => e.getAttribute("value")).filter(Boolean),
        );
      if (!options[0]) throw new Error("02-80: no course templates seeded");
      await picker.selectOption(options[0]);
      await page.waitForTimeout(600);
    },
    selector: "div:has(> select):has(> div.border-blue-500\\/30)",
  },
  {
    id: "02-81-session-quarter-hour",
    doc: "02-training.md",
    line: 1693,
    anchor: "Screenshot of the Start Date & Time control",
    alt: "The start date/time control — a date field beside hour, minute and AM/PM dropdowns",
    route: "/training/admin?tab=sessions",
    prepare: setSessionStart,
    // The start half only. The end field beside it is still blank at this
    // point, and a shot of one filled control next to one empty one reads as
    // a half-finished form rather than as the control being described.
    selector: "div:has(> label:has-text('Start Date & Time'))",
  },
  {
    id: "02-82-session-quick-duration",
    doc: "02-training.md",
    line: 1701,
    anchor: "Screenshot of the Quick Duration row",
    alt: "The Quick Duration row — 1 hour, 2 hours, 4 hours and 8 hours",
    route: "/training/admin?tab=sessions",
    prepare: async (page) => {
      // The row is conditional on a start time being set: with the field
      // empty there is nothing to add a duration to and nothing renders.
      await setSessionStart(page);
    },
    selector: "div:has(> span:text-is('Quick Duration'))",
    viewport: { width: 1440, height: 1100 },
  },
  {
    id: "02-83-session-recurrence",
    doc: "02-training.md",
    line: 1718,
    anchor: "Screenshot of the recurrence block with",
    alt: "The recurrence block with Monthly (by weekday) chosen and its ordinal and weekday pickers",
    route: "/training/admin?tab=sessions",
    prepare: async (page) => {
      await setSessionStart(page);
      await page
        .getByLabel(/Make this a recurring training session/i)
        .check({ timeout: 15_000 });
      await page.waitForTimeout(500);
      const block = page.locator("div.border-l-2").first();
      await block
        .locator("select")
        .first()
        .selectOption({ label: "Monthly (by weekday)" });
      await page.waitForTimeout(600);
      // Fill the whole block. Left at their defaults the two dropdowns read
      // "1st"/"Mon" with an empty Repeat Until beside them, which pictures the
      // controls without picturing a pattern.
      await block.locator('input[type="date"]').first().fill("2027-09-15");
      const pickers = block.locator("select");
      await pickers.nth(1).selectOption({ label: "2nd" });
      await pickers.nth(2).selectOption({ label: "Tue" });
      await page.waitForTimeout(600);
    },
    selector: "div.border-l-2:has(select)",
    viewport: { width: 1440, height: 1200 },
  },
  {
    id: "02-84-record-category-field",
    doc: "02-training.md",
    line: 1801,
    anchor:
      "Screenshot of the Submit External Training form showing the Training Category dropdown",
    alt: "The Training Category dropdown on the submission form, listing the organization's categories",
    // A member filing their own record is who this field is described for.
    auth: "member",
    route: "/training/submit",
    prepare: async (page) => {
      const picker = page
        .locator("select")
        .filter({ hasText: "Select a category" })
        .first();
      await picker.waitFor({ timeout: 15_000 });
      await picker.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
      const options = await picker
        .locator("option")
        .evaluateAll((els) =>
          els.map((e) => e.getAttribute("value")).filter(Boolean),
        );
      if (!options[0]) throw new Error("02-84: no training categories seeded");
      await picker.selectOption(options[0]);
      await page.waitForTimeout(500);
    },
  },
  {
    id: "02-79-training-attachments",
    doc: "02-training.md",
    line: 1591,
    anchor: "The Attachments panel for a training record showing an uploaded",
    alt: "The attachments panel for a training record, listing an uploaded certificate",
    route: "/members",
    prepare: async (page) => {
      // The member holding the seeded certificate, and then the record that
      // carries it — any other row opens an empty panel.
      const owner = await page.evaluate(async () => {
        const r = await fetch("/api/v1/training/records?limit=200", {
          credentials: "include",
        });
        const body = await r.json();
        const list = Array.isArray(body) ? body : body.records || [];
        const withFile = list.find((x) => (x.attachments || []).length > 0);
        return withFile
          ? { userId: withFile.user_id, title: withFile.title }
          : null;
      });
      if (!owner) throw new Error("no training record carries an attachment");
      await page.goto(
        new URL(`/members/${owner.userId}/training`, page.url()).toString(),
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForTimeout(2000);
      // The page opens filtered to this month, which hides older records —
      // and the seeded certificate is on one of them.
      await page
        .getByRole("button", { name: /^All Time$/ })
        .click({ timeout: 10_000 })
        .catch(() => {});
      await page.waitForTimeout(1200);
      const button = page.getByRole("button", { name: /^Files$/ }).first();
      await button.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
      await button.click({ timeout: 15_000, force: true });
      await page.waitForTimeout(1200);
    },
    fullPage: false,
  },
  {
    id: "02-78-my-training-toolbar",
    doc: "02-training.md",
    line: 70,
    anchor: "The My Training records toolbar showing the date-range picker",
    alt: "The My Training date-range toolbar with its helper text and the two export buttons",
    // A member's own overview: the toolbar is about exporting *your* records.
    auth: "member",
    route: "/training/my-training",
    // Clipped to the toolbar. It is one bar on a long page, and a page shot
    // renders the helper text too small to read.
    selector:
      "div.rounded-lg.border:has(label:text-is('Training records date range'))",
  },
  {
    id: "04-37-hour-tracking-mapping",
    doc: "04-events-meetings.md",
    line: 1196,
    anchor:
      "Screenshot of Events Settings > Hour Tracking showing each event source",
    alt: "Event hour-tracking settings mapping event types to admin hour categories",
    route: "/events/admin?tab=settings",
    prepare: clickByName(/^Hour Tracking/),
    fullPage: true,
  },
  {
    id: "04-38-rolling-recurrence",
    doc: "04-events-meetings.md",
    line: 1136,
    anchor:
      'Screenshot of the recurrence block with "Rolling 12-month cycle" ticked',
    alt: "The recurrence controls with the rolling 12-month cycle ticked",
    route: "/events/admin?tab=create",
    prepare: async (page) => {
      await page
        .getByLabel(/Make this a recurring event/i)
        .check({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await page
        .getByLabel(/Rolling 12-month cycle/i)
        .check({ timeout: 10_000 });
      await page.waitForTimeout(500);
    },
    // Clipped to the recurrence block. The whole form is already pictured
    // under "Recurring Events"; what this section adds is the rolling option
    // and the note under it.
    selector: "div.border-l-2:has(#recurrence-pattern)",
  },
  {
    id: "04-39-delete-event-series",
    doc: "04-events-meetings.md",
    line: 1151,
    anchor: "Screenshot of the delete series confirmation dialog",
    alt: "The Delete Event dialog on a recurring event, with the single/series choice",
    route: "/events",
    prepare: async (page) => {
      // The series choice only renders on a recurring event, so the shot has
      // to open one of those rather than whatever the list returns first.
      await openFirstFromApi(
        "/events?limit=100",
        (id) => `/events/${id}`,
        "events",
        (event) =>
          Boolean(
            event.is_recurring ??
            event.isRecurring ??
            event.recurrence_pattern ??
            event.recurrencePattern,
          ),
      )(page);
      await clickByName(/^More$|^Actions$/)(page).catch(async () => {
        // The menu button has no label of its own — it is an icon — so fall
        // back to the control that sits beside End Event / Edit.
        await page
          .locator("button:has(svg)")
          .filter({ hasNot: page.locator("span") })
          .last()
          .click({ timeout: 10_000 });
      });
      await page.waitForTimeout(600);
      await page
        .getByRole("button", { name: /^Delete Event$/ })
        .first()
        .click({ timeout: 10_000 });
      await page.waitForTimeout(800);
      await page
        .getByText("Delete all events in this series")
        .click({ timeout: 10_000 });
      await page.waitForTimeout(500);
    },
    selector: "div.bg-theme-surface-modal.relative",
  },
  {
    id: "04-40-end-event",
    doc: "04-events-meetings.md",
    line: 1176,
    anchor:
      'Screenshot of the event detail page showing the "End Event" button',
    alt: "The End Event action on an event that is currently running",
    route: "/events",
    prepare: async (page) => {
      // In progress *and* staffed. The guest open house is also live — the
      // seeder keeps it that way for the room-display shots — but nobody has
      // checked into it, and a bulk-checkout button over "Attendance (0)"
      // illustrates the opposite of the feature.
      const id = await page.evaluate(async () => {
        const response = await fetch("/api/v1/events?limit=100", {
          credentials: "include",
        });
        if (!response.ok) return null;
        const body = await response.json();
        const rows = Array.isArray(body)
          ? body
          : body.events || body.items || [];
        const now = new Date().toISOString();
        for (const event of rows) {
          const start = event.start_datetime ?? event.startDatetime ?? "";
          const end = event.end_datetime ?? event.endDatetime ?? "";
          if (!(start <= now && end >= now)) continue;
          const stats = await fetch(`/api/v1/events/${event.id}/stats`, {
            credentials: "include",
          });
          if (!stats.ok) continue;
          const body2 = await stats.json();
          if ((body2.checked_in_count ?? body2.checkedInCount ?? 0) > 0) {
            return event.id;
          }
        }
        return null;
      });
      if (!id) throw new Error("04-40: no running event has anyone checked in");
      await page.goto(new URL(`/events/${id}`, page.url()).toString(), {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(1200);
    },
    fullPage: false,
  },
  {
    id: "04-41-event-create-layout",
    doc: "04-events-meetings.md",
    line: 1199,
    anchor:
      "Screenshot of the Attendance and RSVP Settings sections sitting side by side",
    alt: "Attendance and RSVP settings side by side on the event creation form",
    route: "/events/admin?tab=create",
    prepare: async (page) => {
      await page
        .getByPlaceholder("e.g., Monthly Business Meeting")
        .fill("Quarterly Safety Stand-Down", { timeout: 15_000 });
      await page.waitForTimeout(500);
      // The paired sections are the layout the guide is describing; the top
      // of the form is a single column of full-width cards. Both sections
      // collapse to a single checkbox until their options are switched on,
      // so the pairing is only visible with something turned on in each.
      await page.getByText("Mandatory attendance", { exact: true }).click();
      await page.getByText("Require RSVP", { exact: true }).click();
      await page.waitForTimeout(700);
      await page
        .getByText("Attendance", { exact: true })
        .first()
        .scrollIntoViewIfNeeded({ timeout: 15_000 });
      await page.waitForTimeout(500);
    },
    selector:
      "div.grid:has(span:text-is('Attendance')):has(span:text-is('RSVP Settings'))",
    // Wider than the default: at 1440 the RSVP deadline's meridiem select
    // overflows its column and the clip cuts it in half.
    viewport: { width: 1800, height: 1300 },
  },
  {
    id: "05-65-reorder-shortfall",
    doc: "05-inventory.md",
    line: 1706,
    anchor: "Screenshot of the reorder shortfall panel",
    alt: "The size breakdown with each size's shortfall and cost, and the Create reorder requests button beneath it",
    route: "/inventory/admin/impact-planner",
    prepare: async (page) => {
      await runImpactAnalysis(page);
      // Deliberately stops before the click. There is no confirmation step —
      // the button files the requests immediately — so capturing the result
      // would mean creating four reorder requests on every run of the harness.
      // The panel above the button is the preview.
      const button = page.getByRole("button", {
        name: /Create reorder requests/i,
      });
      await button.waitFor({ timeout: 20_000 });
      await button.scrollIntoViewIfNeeded({ timeout: 10_000 });
      // Then back up, so the size rows the button acts on are in frame with it.
      // Clipping to the button's own container gets the urgency select and the
      // button and nothing else, which pictures the control rather than the
      // decision.
      await page.evaluate(() => window.scrollBy(0, -320));
      await page.waitForTimeout(500);
    },
    viewport: { width: 1440, height: 900 },
    fullPage: false,
  },
  {
    id: "05-59-impact-planner-results",
    doc: "05-inventory.md",
    line: 1652,
    anchor: "Screenshot of the analysis results showing the four summary cards",
    alt: "Impact planner results with its summary cards, size breakdown and cost estimate",
    route: "/inventory/admin/impact-planner",
    prepare: async (page) => {
      await runImpactAnalysis(page);
      // Analysing scrolls the results into view; the summary cards and the
      // size-and-cost panel this section is about are at the top of them.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page
        .locator("main, [role='main']")
        .first()
        .evaluate((el) => (el.scrollTop = 0))
        .catch(() => {});
      await page.waitForTimeout(400);
    },
    // Viewport, not full page: the sidebar is position:fixed, so a full-page
    // capture of the 2,100px results paints it across the middle of them. The
    // summary cards and the size-and-cost panel this section describes are
    // both above the fold at this height.
    viewport: { width: 1440, height: 1150 },
    fullPage: false,
  },
  {
    id: "08-59-breadcrumbs",
    doc: "08-admin-reports.md",
    line: 596,
    anchor: "Screenshot of a page showing its breadcrumb trail",
    alt: "A breadcrumb trail at the top of an expense report detail page",
    route: "/finance/expense-reports",
    prepare: openFirstFromApi(
      "/finance/expense-reports?limit=5",
      (id) => `/finance/expenses/${id}`,
      "reports",
    ),
    // Viewport rather than a clip of the nav itself: the trail alone is a
    // 20px strip that says nothing about where it sits. The top of the page
    // shows it above the record it belongs to.
    fullPage: false,
  },
  {
    id: "08-60-dashboard-notification-cards",
    doc: "08-admin-reports.md",
    line: 1153,
    anchor:
      "Screenshot of the dashboard Notifications panel showing the dismiss control",
    alt: "The dashboard Notifications panel — a dismiss control on each card and Clear All in the header",
    route: "/dashboard",
    prepare: async (page) => {
      const panel = page
        .locator("div.card")
        .filter({ hasText: "Notifications" })
        .first();
      await panel.waitFor({ timeout: 15_000 });
      await panel.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(600);
    },
    selector: "div.card:has(button[title='Mark all as read'])",
  },
  {
    id: "08-61-notification-channel-filter",
    doc: "08-admin-reports.md",
    line: 1196,
    anchor: "Screenshot of the Send Log's channel filter with In-App selected",
    alt: "The delivery-log channel filter — All, Email and In-App — with In-App selected",
    route: "/notifications?tab=log",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "In-App", exact: true })
        .first()
        .click({ timeout: 15_000 });
      await page.waitForTimeout(700);
      await page.evaluate(() => window.scrollTo(0, 0));
    },
  },
  {
    id: "08-62-topnav-bell-badge",
    doc: "08-admin-reports.md",
    line: 1255,
    anchor:
      "Screenshot of the top navigation bar showing the bell icon with a red badge",
    alt: "The top navigation bar with the bell icon carrying its unread-count badge",
    route: "/dashboard",
    prepare: async (page) => {
      // The top bar is a per-user preference stored in localStorage; the
      // default is the left sidebar, which has its own badge shot (08-31).
      await page.evaluate(() =>
        localStorage.setItem("navigationLayout", "top"),
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1800);
    },
    selector: "header",
  },
  {
    id: "08-63-inbox-show-read",
    doc: "08-admin-reports.md",
    line: 1283,
    anchor:
      "Screenshot of the Notifications inbox showing the Show read checkbox",
    alt: "The notifications inbox with its Show read checkbox, unread count and Load more button",
    route: "/notifications?tab=inbox",
    prepare: async (page) => {
      await page
        .getByText("Show read", { exact: true })
        .waitFor({ timeout: 15_000 });
      await page.waitForTimeout(800);
    },
    fullPage: true,
  },
  {
    id: "04-36-description-markdown",
    doc: "04-events-meetings.md",
    line: 354,
    anchor:
      "Screenshot of the event form's Description field with its markdown",
    alt: "The event description field with its markdown toolbar and syntax hint",
    route: "/events/admin?tab=create",
    // Clipped to the field: the toolbar is four small buttons on a 2,700px
    // form, and a page-level shot makes them unreadable.
    selector: "div:has(> #event-description)",
  },
  {
    id: "04-35-recurring-event-form",
    doc: "04-events-meetings.md",
    line: 267,
    anchor: "Screenshot of the event form with recurrence switched on, showing",
    alt: "The event form with recurrence switched on, showing the pattern and series end date",
    route: "/events/admin?tab=create",
    prepare: async (page) => {
      await page
        .getByLabel(/Make this a recurring event/i)
        .check({ timeout: 15_000 });
      await page.waitForTimeout(500);
      // Monthly (by weekday): the pattern the guide singles out, and the only
      // one that reveals the ordinal and weekday selectors it describes.
      await page
        .locator("#recurrence-pattern")
        .selectOption("monthly_weekday", { timeout: 10_000 });
      await page.waitForTimeout(600);
    },
    // Clipped to the form: the sidebar is position:fixed, so a full-page
    // capture of a 2,700px form paints it across the middle of the page.
    selector: "form",
  },
  {
    id: "03-49-report-card-names",
    doc: "03-scheduling.md",
    line: 1138,
    anchor: "Screenshot of an expanded shift report card, its header naming",
    alt: "A shift report card naming the trainee in its header and the filing officer in its footer",
    route: "/scheduling?tab=shift-reports",
    prepare: async (page) => {
      await expandFirstReportCard(page);
      // Scroll the card's own header to the top of the viewport: expanding it
      // leaves the summary table above still filling most of the screen.
      await page
        .locator("div.rounded-xl > button:visible")
        .filter({ hasText: /\d+(\.\d+)?h/ })
        .first()
        .evaluate((el) => el.scrollIntoView({ block: "start" }))
        .catch(() => {});
      await page.waitForTimeout(500);
    },
    fullPage: false,
  },
  {
    id: "03-47-settings-desktop",
    doc: "03-scheduling.md",
    line: 562,
    anchor: "The rebuilt Scheduling Settings screen on a desktop",
    alt: "Scheduling settings on desktop, with the section list beside the selected section's card",
    route: "/scheduling/settings",
    fullPage: true,
  },
  {
    id: "03-48-settings-phone",
    doc: "03-scheduling.md",
    line: 567,
    anchor: "The same screen at phone width, showing the",
    alt: "Scheduling settings at phone width, the section list replaced by a scrollable tab strip",
    route: "/scheduling/settings",
    viewport: "mobile",
    // Viewport, not full page: the phone layout pins a bottom tab bar, and a
    // full-page capture paints it across the middle of the settings card. The
    // tab strip this shot is about is above the fold anyway.
    fullPage: false,
  },
  {
    id: "02-76-report-form-sections",
    doc: "02-training.md",
    line: 1053,
    anchor:
      "Screenshot of the Form Sections panel listing the seven optional report",
    alt: "The shift report form's optional sections, each with its own toggle",
    route: "/scheduling/settings?tab=shift-reports",
    // The section list renders twice — a bare-label strip for phones and a
    // sidebar whose accessible name carries the description too. Anchoring
    // the regex at the start matches both; `$` matched only the hidden
    // phone copy and timed out.
    prepare: clickByName(/^Form Sections/),
    fullPage: true,
  },
  {
    id: "02-77-apparatus-skills",
    doc: "02-training.md",
    line: 1068,
    anchor:
      "Screenshot of the Apparatus Skills panel with one apparatus type selected",
    alt: "Per-apparatus-type skills and tasks, with one type expanded",
    route: "/scheduling/settings?tab=shift-reports",
    // The panel opens on the first apparatus type alphabetically (Ambulance),
    // which is as good an illustration as any — every type carries its own
    // skills and tasks.
    prepare: clickByName(/^Apparatus Skills/),
    fullPage: true,
  },
  {
    id: "00-19-change-password",
    doc: "00-getting-started.md",
    line: 58,
    anchor:
      "Screenshot of the change password form showing the current password",
    alt: "The change password form with its three fields and the strength requirements",
    route: "/account",
    prepare: async (page) => {
      await clickByName(/^Password$/)(page);
      await page.waitForTimeout(500);
      // Typed rather than left blank: the requirement checklist only tells you
      // anything once there is something to check it against.
      await page
        .locator('input[type="password"]')
        .nth(1)
        .fill("Oakville!2026")
        .catch(() => {});
      await page.waitForTimeout(400);
    },
    fullPage: true,
  },
  {
    id: "00-20-member-dashboard",
    doc: "00-getting-started.md",
    line: 288,
    anchor: "A member's dashboard showing the hours row, department messages",
    alt: "A member's dashboard with its hours, messages, shift, event and equipment panels",
    // As a member: the administrator's dashboard leads with department-wide
    // stat cards, and the personal panels this section is about sit under
    // them or not at all.
    auth: "member",
    route: "/dashboard",
    fullPage: true,
  },
  {
    id: "00-14-confirm-dialog",
    doc: "00-getting-started.md",
    line: 103,
    anchor: "An in-app confirmation dialog over a dimmed page",
    alt: "An in-app confirmation dialog with its consequence sentence and named buttons",
    // A delete that names both the consequence and the two choices — the
    // pattern the section is about. Equipment-check templates are the clearest
    // instance in the app.
    route: "/scheduling/settings?tab=equipment",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^Delete/ })
        .first()
        .click({ timeout: 15_000 });
      await page.waitForTimeout(800);
    },
    fullPage: false,
  },
  {
    id: "00-15-sidebar-member",
    doc: "00-getting-started.md",
    line: 134,
    anchor: "Screenshot of the sidebar navigation expanded, showing the member",
    alt: "The navigation sidebar with the member-facing sections expanded",
    route: "/dashboard",
    // Expanded, which is the point of the shot: the collapsed sidebar shows a
    // chevron beside Training and Operations and nothing of what is under
    // them. The taller viewport is so the clip is not cut off partway down —
    // the whole nav is longer than 900px once two groups are open.
    prepare: async (page) => {
      for (const group of ["Training", "Operations"]) {
        await page
          .getByRole("button", { name: new RegExp(`^${group}$`) })
          .first()
          .click({ timeout: 10_000 })
          .catch(() => {});
        await page.waitForTimeout(300);
      }
    },
    viewport: { width: 1440, height: 1500 },
    selector: "nav",
  },
  {
    id: "00-16-sidebar-admin",
    doc: "00-getting-started.md",
    line: 153,
    anchor:
      "Screenshot of the sidebar with the Administration section expanded",
    alt: "The sidebar scrolled to its Administration section with the admin-only links",
    route: "/dashboard",
    // A viewport shot rather than a clip of <nav>: the sidebar is one long
    // scrolling element, so an element screenshot renders it whole and would
    // be the same picture as the member-section shot above. Scrolling it and
    // taking the viewport is what actually shows the admin half.
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^Members$/ })
        .last()
        .click({ timeout: 10_000 })
        .catch(() => {});
      await page.waitForTimeout(300);
      await page
        .locator("nav")
        .first()
        .evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
    fullPage: false,
  },
  {
    id: "00-17-account-settings",
    doc: "00-getting-started.md",
    line: 305,
    anchor: "Account Settings on its Account tab, with the tab row across",
    alt: "Account settings on its Account tab, with contact, department and address fields",
    route: "/account",
    fullPage: true,
  },
  {
    id: "00-18-rsvp-modal",
    doc: "00-getting-started.md",
    line: 326,
    anchor: 'The RSVP modal for "Q3 Ladder Operations Drill" with',
    alt: "The RSVP modal with its attendance choice, dietary and accessibility fields",
    // As a member, not the administrator. The organizer's view of an event
    // offers Check In, Send Reminders and Print Roster — there is no RSVP
    // button on it, because the organizer is not the one answering.
    auth: "member",
    route: "/events",
    prepare: async (page) => {
      await openFirstFromApi(
        "/events?limit=50",
        (id) => `/events/${id}`,
        "events",
        // More than two days out. RSVP closes a day before the event, and the
        // list response omits rsvp_deadline — so "upcoming" alone picks
        // tonight's meeting, whose RSVP window shut yesterday and which
        // therefore renders no RSVP button at all.
        (event) => {
          if (!(event.requires_rsvp ?? event.requiresRsvp ?? false))
            return false;
          const start = event.start_datetime ?? event.startDatetime ?? "";
          return start > new Date(Date.now() + 2 * 86400_000).toISOString();
        },
      )(page);
      await page.waitForTimeout(1200);
      await page
        .getByRole("button", { name: /^(RSVP Now|Update RSVP|Change RSVP)$/ })
        .first()
        .click({ timeout: 15_000 });
      await page.waitForTimeout(800);
    },
    fullPage: false,
  },
  {
    id: "06-15-facility-maintenance-form",
    doc: "06-apparatus-facilities.md",
    line: 211,
    anchor:
      "Screenshot of the New Maintenance Record form showing the facility",
    alt: "New facility maintenance record form with its facility, type, date, vendor and cost fields",
    route: "/facilities/maintenance",
    prepare: clickByName(/^New Record$/),
    fullPage: false,
  },
  {
    id: "05-57-assign-scan-modal",
    doc: "05-inventory.md",
    line: 464,
    anchor: "Screenshot of the Assign Items modal showing the member it is",
    alt: "Assigning items to a member by scanning or searching, with two items staged",
    route: "/inventory/admin/members",
    prepare: async (page) => {
      await clickByName(/^Assign$/)(page);
      // Staged through the live search rather than the camera: a headless
      // browser has no camera, and the typed path is the one a desk assignment
      // actually uses. Two items, so the staged list reads as a list.
      // Asset tags rather than names: a name search can resolve to the same
      // record twice ("Structural" and "Helmet" are both the helmet) and the
      // modal then shows a duplicate warning instead of a second row.
      for (const tag of ["OFD-1003", "OFD-1008"]) {
        await page.getByPlaceholder(/Search by name, barcode/).fill(tag);
        await page.waitForTimeout(900);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(900);
      }
    },
    fullPage: false,
  },
  {
    id: "05-58-return-items-modal",
    doc: "05-inventory.md",
    line: 506,
    anchor:
      "Screenshot of the Return Items modal listing everything one member",
    alt: "Returning several items at once, each with its own condition",
    route: "/inventory/admin/members",
    prepare: async (page) => {
      // The member the seeder issues a full kit to. Any other row holds one
      // item, and a "batch" return of one row shows none of the mechanism.
      const row = page
        .locator("div")
        .filter({ hasText: /Nadia Belhaj/ })
        .filter({ has: page.getByRole("button", { name: /^Return$/ }) })
        .last();
      await row
        .getByRole("button", { name: /^Return$/ })
        .click({ timeout: 15_000 });
      await page.waitForTimeout(1200);
      await page
        .getByRole("button", { name: /select all/i })
        .first()
        .click({ timeout: 5_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
    fullPage: false,
  },
  {
    id: "15-14-applicant-drawer-overview",
    doc: "15-prospective-members.md",
    line: 295,
    anchor:
      "Screenshot of the applicant detail drawer showing contact information",
    alt: "Applicant detail drawer on its overview tab, with the stage indicator and tab row",
    route: "/prospective-members",
    // The drawer is component state, not a route — the same reason 04-34 opens
    // it by clicking a card rather than navigating.
    prepare: async (page) => {
      const card = page
        .locator("[class*='cursor-pointer']")
        .filter({ hasText: /\w/ })
        .first();
      await card.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
      await card.click({ timeout: 15_000 });
      await page.waitForTimeout(1800);
    },
    fullPage: true,
  },
  // ── 00 Getting Started ──────────────────────────────────────────────
  {
    id: "00-01-login-page",
    doc: "00-getting-started.md",
    line: 28,
    anchor:
      "Screenshot of the login page showing the username and password fields, the",
    alt: "The Logbook login page with username and password fields",
    route: "/login",
    auth: "anonymous",
  },
  {
    id: "00-04-dashboard-overview",
    // the empty 'My Upcoming Shifts' panel is incidental; the rest of the dashboard is populated
    allowEmptyState: true,
    doc: "00-getting-started.md",
    line: 79,
    anchor:
      "Full-screen screenshot of the dashboard showing the sidebar navigation on the left,",
    alt: "Dashboard showing the sidebar navigation, main content, and header",
    route: "/dashboard",
  },
  {
    id: "00-07-dashboard-panels",
    // same — the shot is about the panel layout, not the shift list
    allowEmptyState: true,
    doc: "00-getting-started.md",
    line: 155,
    anchor:
      "Screenshot of the dashboard showing the stats cards at the top, the",
    alt: "Dashboard stats cards, notifications, upcoming events, and upcoming shifts",
    route: "/dashboard",
    fullPage: true,
  },
  {
    id: "00-09-account-settings",
    doc: "00-getting-started.md",
    line: 206,
    anchor:
      "Screenshot of the Account Settings page showing the profile section, notification preferences",
    alt: "Account Settings page with profile, notification preferences, and password sections",
    route: "/settings/account",
    fullPage: true,
  },

  // ── 01 Membership ───────────────────────────────────────────────────
  {
    id: "01-01-member-directory",
    doc: "01-membership.md",
    line: 37,
    anchor:
      "Screenshot of the Members page showing the member list table with columns",
    alt: "Member directory listing members with rank, status, and contact columns",
    route: "/members",
  },
  {
    id: "01-02-member-profile",
    doc: "01-membership.md",
    line: 80,
    anchor:
      "Screenshot of a member profile page showing the two-column layout. Left side",
    alt: "Member profile page with the photo, compliance summary, and detail panels",
    route: "/members",
    prepare: openFirstFromApi(
      "/users?limit=1",
      (id) => `/members/${id}`,
      "users",
    ),
    fullPage: true,
  },
  {
    id: "01-05-add-member-form",
    doc: "01-membership.md",
    line: 128,
    anchor:
      "Screenshot of the Add Member form showing the personal information fields, role",
    alt: "Add Member form with personal information and role assignment fields",
    route: "/members/add",
    fullPage: true,
  },
  {
    id: "01-06-import-members",
    doc: "01-membership.md",
    line: 152,
    anchor:
      "Screenshot of the Import Members page showing the file upload area, the",
    alt: "Import Members page with the file upload area and template download link",
    route: "/members/import",
    fullPage: true,
  },
  {
    id: "01-10-prospective-pipeline",
    doc: "01-membership.md",
    line: 265,
    anchor:
      "Screenshot of the Kanban board view showing pipeline stages as columns (e.g.,",
    alt: "Prospective members kanban board with pipeline stages as columns",
    route: "/prospective-members",
  },
  {
    // Corrected 2026-08-08. This was captured at /members/admin but described as
    // a "Member Lifecycle Management page showing the four tab buttons" — a page
    // that does not exist (see docs/KNOWN_LIMITATIONS.md, "Member Lifecycle").
    // The capture was always of the Members Admin hub; only the caption was
    // wrong, which made a correct screenshot read as evidence for a fictional
    // page. Renaming the id would orphan the committed PNG, so the id stays and
    // the alt text tells the truth.
    id: "01-22-member-lifecycle",
    doc: "01-membership.md",
    line: 567,
    anchor: "The Members Admin hub — Member Management, Add Member",
    alt: "The Members Admin hub — Member Management, Add Member and Import Members tabs",
    route: "/members/admin",
  },
  {
    id: "01-23-print-member-badges",
    doc: "01-membership.md",
    line: 56,
    anchor:
      'Screenshot of the Members directory with several rows checked and the "Print Badges"',
    alt: "The Members directory selection bar with Print Badges, Export Selected and Clear Selection",
    route: "/members",
    prepare: async (page) => {
      // The bulk bar is `hidden md:flex` — desktop only — and only renders
      // once something is selected, so the shot has to tick rows first.
      // Scoped to tbody: the thead box is "Select all members", which would
      // tick the whole page rather than the "several rows" pictured.
      const boxes = page.locator('tbody input[type="checkbox"]:visible');
      await boxes.first().waitFor({ timeout: 15_000 });
      const count = Math.min(await boxes.count(), 3);
      for (let i = 0; i < count; i += 1) await boxes.nth(i).check();
      await page.waitForTimeout(400);
    },
  },
  {
    id: "01-24-delete-member-modal",
    doc: "01-membership.md",
    line: 345,
    anchor: "Screenshot of the Remove Member dialog's Permanently Delete tab",
    alt: "The Permanently Delete tab of the Remove Member dialog, with its impact breakdown and typed confirmation",
    route: "/members",
    prepare: async (page) => {
      // Nadia Belhaj is the member the seeder kits out, so her impact
      // breakdown has a number against every row rather than a column of
      // zeros that reads as "deleting a member costs nothing".
      const row = page.locator("tr").filter({ hasText: "Nadia Belhaj" });
      await row.first().waitFor({ timeout: 15_000 });
      await row.locator('button[title="Delete"]').first().click();
      await page.waitForTimeout(800);
      // The permanent-deletion warning and the typed confirmation this
      // section is about are on the second tab; the dialog opens on the
      // reversible Deactivate one.
      await page
        .getByRole("tab", { name: /Permanently Delete/i })
        .click({ timeout: 10_000 });
      await page.waitForTimeout(600);
    },
    selector: "div.fixed.inset-0",
  },
  {
    id: "01-25-applicant-action-bar",
    doc: "01-membership.md",
    line: 432,
    anchor: "Screenshot of the applicant detail drawer's action bar",
    alt: "The applicant drawer's action bar — Interview, Back, Withdraw, Hold, Skip, Reject and Advance",
    route: "/prospective-members",
    prepare: async (page) => {
      // Back only renders off the first stage, so the shot has to open an
      // applicant who has moved on. Rather than opening drawers in turn until
      // one has the button — which fails as soon as a drawer refuses to close
      // and covers the board — the column position picks the applicant: any
      // card outside the leftmost stage is past stage one by construction.
      const columns = page.locator("div.shrink-0.w-64, div.shrink-0.sm\\:w-72");
      await columns.first().waitFor({ timeout: 15_000 });
      const total = await columns.count();
      for (let i = 1; i < total; i += 1) {
        const card = columns.nth(i).locator("[role='button'][aria-label]");
        if (await card.count()) {
          await card.first().click({ timeout: 15_000 });
          await page.waitForTimeout(1200);
          return;
        }
      }
      throw new Error("01-25: no applicant is past the first stage");
    },
  },
  {
    id: "01-26-print-applicant-badges",
    doc: "01-membership.md",
    line: 446,
    anchor:
      'Screenshot of the Prospective Members pipeline with several applicants selected and the "Print Badges"',
    alt: "The prospective members bulk-action bar with Print Badges, Advance All and the rest",
    route: "/prospective-members",
    prepare: async (page) => {
      // Each kanban card carries its own "Select <name>" checkbox; the bulk
      // bar appears above the board once any of them is ticked.
      const boxes = page.locator(
        'input[type="checkbox"][aria-label^="Select "]:visible',
      );
      await boxes.first().waitFor({ timeout: 15_000 });
      const count = Math.min(await boxes.count(), 3);
      for (let i = 0; i < count; i += 1) await boxes.nth(i).check();
      await page.waitForTimeout(400);
      await page.evaluate(() => window.scrollTo(0, 0));
    },
  },
  {
    id: "01-27-stage-type-picker",
    doc: "01-membership.md",
    line: 500,
    anchor:
      "Screenshot of the Stage Configuration Modal showing the stage type selector",
    alt: "The stage type picker in the Stage Configuration modal, showing all twelve stage types",
    route: "/prospective-members/settings",
    prepare: async (page) => {
      // The page opens on "Select a pipeline" — the stage builder, and with
      // it Add Stage, only renders once one is chosen from the left list.
      const pipeline = page
        .locator("button, li, div[role='button']")
        .filter({ hasText: /stages · \d+ applicants/ })
        .first();
      await pipeline.waitFor({ timeout: 15_000 });
      await pipeline.click();
      await page.waitForTimeout(1000);
      const add = page.getByRole("button", { name: /Add Stage/i }).first();
      await add.scrollIntoViewIfNeeded({ timeout: 15_000 });
      await add.click({ timeout: 15_000 });
      await page.waitForTimeout(700);
      // The picker is below the name/description fields inside the modal's
      // own scroll container, so scrolling the page does nothing.
      await page
        .getByText("Stage Type *", { exact: true })
        .scrollIntoViewIfNeeded({ timeout: 10_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
    // Clipped to the picker's own block. The modal scrolls internally, so a
    // viewport shot of it shows six of the twelve types and cuts the rest off
    // at the fold — which is the one thing this placeholder is counting.
    selector: "div:has(> label:text-is('Stage Type *'))",
  },
  {
    id: "01-28-stage-email-config",
    doc: "01-membership.md",
    line: 534,
    anchor:
      "Screenshot of the email configuration panel in the Stage Config Modal",
    alt: "The automated-email stage configuration with its subject, welcome message and custom sections",
    route: "/prospective-members/settings",
    prepare: async (page) => {
      // The page opens on "Select a pipeline" — the stage builder, and with
      // it Add Stage, only renders once one is chosen from the left list.
      const pipeline = page
        .locator("button, li, div[role='button']")
        .filter({ hasText: /stages · \d+ applicants/ })
        .first();
      await pipeline.waitFor({ timeout: 15_000 });
      await pipeline.click();
      await page.waitForTimeout(1000);
      const add = page.getByRole("button", { name: /Add Stage/i }).first();
      await add.scrollIntoViewIfNeeded({ timeout: 15_000 });
      await add.click({ timeout: 15_000 });
      await page.waitForTimeout(700);
      await page
        .locator("button")
        .filter({ hasText: "Automated Email" })
        .first()
        .click({ timeout: 10_000 });
      await page.waitForTimeout(600);
      // The custom section this placeholder pictures does not exist until it
      // is added; the panel opens with only the four built-in sections.
      await page
        .getByRole("button", { name: /Add custom section/i })
        .first()
        .click({ timeout: 10_000 });
      await page.waitForTimeout(500);
      await page
        .getByText("Email Subject", { exact: false })
        .first()
        .scrollIntoViewIfNeeded({ timeout: 10_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
    // Clipped past the type picker — which 01-27 already pictures — to the
    // configuration block the automated-email section is actually about.
    selector: "div:has(> h3:text-is('Stage Configuration'))",
    // Taller than the block, so the modal's own overflow still clips it. At
    // 900px the block runs past the modal and the element shot painted a strip
    // of the settings page showing through underneath it.
    viewport: { width: 1440, height: 1200 },
  },
  {
    id: "01-29-status-change-modal",
    doc: "01-membership.md",
    line: 583,
    anchor:
      "Screenshot of the Change Member Status dialog with a drop status selected",
    alt: "The Change Member Status dialog with a drop status selected and its property-return note",
    route: "/members",
    prepare: async (page) => {
      await openFirstFromApi(
        "/users?limit=1",
        (id) => `/members/${id}`,
        "users",
      )(page);
      const badge = page
        .locator('button[title="Change status"]:visible')
        .first();
      await badge.waitFor({ timeout: 15_000 });
      await badge.click();
      await page.waitForTimeout(600);
      // Picking a drop status is what reveals the property-return note, and
      // it also enables Update Status — which stays disabled while the
      // selection still matches the member's current status.
      await page
        .locator("select")
        .filter({ hasText: "Dropped Voluntary" })
        .first()
        .selectOption({ label: "Dropped Voluntary" });
      await page.waitForTimeout(400);
    },
    // Clipped to the dialog: the profile behind it is a different section's
    // subject, and the panel it happens to sit over is an empty table.
    selector: "div.fixed.inset-0 > div",
  },
  {
    id: "01-30-evoc-operator-modal",
    doc: "01-membership.md",
    line: 897,
    anchor: "Screenshot of an operator record on an apparatus's Operators tab",
    alt: "An apparatus operator's record with its EVOC Certification Level, certification dates and licence fields",
    route: "/apparatus",
    prepare: async (page) => {
      // Edit rather than Add: the add form opens with every field blank and
      // "No EVOC level" selected, which pictures the control without
      // picturing what it holds.
      const rig = await page.evaluate(async () => {
        const response = await fetch("/api/v1/apparatus/operators", {
          credentials: "include",
        });
        if (!response.ok) return null;
        const body = await response.json();
        const rows = Array.isArray(body) ? body : body.operators || [];
        const withLevel = rows.find((row) => row.evoc_level || row.evocLevel);
        return withLevel
          ? withLevel.apparatus_id || withLevel.apparatusId
          : null;
      });
      if (!rig)
        throw new Error("01-30: no seeded operator holds an EVOC level");
      await page.goto(new URL(`/apparatus/${rig}`, page.url()).toString(), {
        waitUntil: "domcontentloaded",
      });
      await clickByName(/^Operators$/)(page);
      await page.waitForTimeout(1000);
      await page
        .locator('button[title="Edit operator"]:visible')
        .first()
        .click({ timeout: 15_000 });
      await page.waitForTimeout(800);
    },
  },

  // ── 02 Training ─────────────────────────────────────────────────────
  {
    id: "02-01-my-training",
    doc: "02-training.md",
    line: 53,
    anchor: "Screenshot of the My Training page showing stat cards at the top",
    alt: "My Training page with stat cards and the personal training record list",
    route: "/training/my-training",
    fullPage: true,
  },
  {
    id: "02-04-course-library",
    doc: "02-training.md",
    line: 111,
    anchor:
      "Screenshot of the Course Library page showing course cards organized by category,",
    alt: "Course Library showing course cards grouped by category",
    route: "/training/courses",
  },
  {
    id: "02-16-requirements",
    doc: "02-training.md",
    line: 438,
    anchor:
      "Screenshot of the Requirements management page showing a table of requirements with",
    alt: "Training requirements management table",
    route: "/training/requirements",
  },
  {
    id: "02-17-officer-dashboard",
    doc: "02-training.md",
    line: 462,
    anchor:
      "Screenshot of the Training Officer Dashboard showing summary cards (completion rate, pending",
    alt: "Training Officer Dashboard with summary cards and pending review queue",
    route: "/training/officer",
    fullPage: true,
  },
  {
    id: "02-18-review-submissions",
    doc: "02-training.md",
    line: 480,
    anchor:
      "Screenshot of the Review Submissions page showing a list of pending submissions",
    alt: "Review Submissions page listing pending training submissions",
    route: "/training/submissions",
  },
  {
    id: "02-38-manual-shift-report",
    doc: "02-training.md",
    line: 916,
    anchor:
      "Screenshot of the Manual Shift Report page showing the date/time entry at",
    alt: "Manual Shift Report page with date, apparatus, and hours entry",
    route: "/training/log-shift",
    fullPage: true,
  },
  {
    id: "02-42-external-integrations",
    doc: "02-training.md",
    line: 984,
    anchor:
      "Screenshot of the External Training Integrations page showing a connected provider with",
    alt: "External Training Integrations page showing provider connection status",
    route: "/training/integrations",
  },
  {
    id: "02-45-training-programs",
    doc: "02-training.md",
    line: 1030,
    anchor:
      "Screenshot of the Training Programs page with the Export button visible on",
    alt: "Training Programs page listing programs with an export action",
    route: "/training/programs",
  },
  {
    id: "02-64-skills-testing-admin",
    doc: "02-training.md",
    line: 1460,
    anchor:
      "Screenshot of the Skills Testing section within Training Admin, showing the template",
    alt: "Skills Testing section within Training Admin showing the template list",
    // Same trap 09-01 fell into: /training/skills-testing is the *member's*
    // page (Available Tests / My Results), so this captured cleanly while
    // picturing the wrong audience — and the placeholder says "within Training
    // Admin" in as many words.
    route: "/training/admin?tab=templates",
  },
  {
    id: "02-66-compliance-thresholds",
    doc: "02-training.md",
    line: 628,
    anchor: "Thresholds tab showing the",
    alt: "Compliance thresholds configuration including the evaluation-period setting",
    // Thresholds is the page's default tab, so no interaction is needed.
    route: "/training/compliance-config",
    fullPage: true,
  },
  {
    id: "02-67-manual-entry-settings",
    doc: "02-training.md",
    line: 1002,
    anchor: "manual entry settings panel",
    alt: "Manual entry settings with its enable toggle, apparatus rules and shift defaults",
    route: "/training/admin?page=setup&tab=manual-entry",
    // Everything below the enable checkbox — the apparatus rules and the shift
    // defaults the placeholder asks for — renders only while the feature is on,
    // and it ships off. So the shot turns it on, which *is* a real change to
    // the demo department: manual shift entry stays enabled afterwards.
    prepare: async (page) => {
      const toggle = page.getByRole("checkbox", {
        name: /enable manual shift entry/i,
      });
      if (
        !(await toggle
          .first()
          .isChecked()
          .catch(() => false))
      ) {
        await toggle.first().click({ timeout: 10_000 });
      }
    },
    fullPage: true,
  },
  {
    id: "02-68-vector-category-mapping",
    doc: "02-training.md",
    line: 1067,
    anchor: "Vector Solutions category mapping table",
    alt: "External provider category mapping, pairing provider categories with internal ones",
    route: "/training/admin?page=setup&tab=integrations",
    fullPage: true,
    // A department with no provider connected has nothing to map, and the
    // mapping table is the subject — so an empty state here means the seed
    // data cannot support the shot yet, which is worth surfacing rather than
    // publishing an empty table under a placeholder describing a full one.
  },

  // ── 03 Scheduling ───────────────────────────────────────────────────
  {
    id: "03-01-scheduling-tabs",
    doc: "03-scheduling.md",
    line: 43,
    anchor: "Screenshot of the Scheduling page showing the tab bar at the top",
    alt: "Scheduling page tab bar with the schedule view below it",
    route: "/scheduling",
  },
  {
    id: "03-12-shift-templates",
    doc: "03-scheduling.md",
    line: 239,
    anchor:
      "Screenshot of the Shift Templates tab showing a list of templates with",
    alt: "Shift Templates tab listing templates with start and end times",
    route: "/scheduling/templates",
  },
  {
    id: "03-13-shift-patterns",
    doc: "03-scheduling.md",
    line: 260,
    anchor:
      "Screenshot of the pattern creation form showing the pattern type selector (Daily,",
    alt: "Shift pattern creation page with the pattern type selector",
    route: "/scheduling/patterns",
    fullPage: true,
  },
  {
    id: "03-16-platoon-management",
    doc: "03-scheduling.md",
    line: 566,
    anchor:
      "Screenshot of the Platoon Management page showing three platoon columns (A, B,",
    alt: "Platoon Management page showing platoon columns and their members",
    route: "/scheduling/platoons",
  },
  {
    id: "03-24-equipment-check-reports",
    doc: "03-scheduling.md",
    line: 714,
    anchor:
      "Screenshot of the Equipment Check Reports page showing the Compliance Dashboard tab",
    alt: "Equipment Check Reports page with the compliance dashboard",
    route: "/scheduling/equipment-check-reports",
  },

  // ── 04 Events & Meetings ────────────────────────────────────────────
  {
    id: "04-01-events-list",
    doc: "04-events-meetings.md",
    line: 45,
    anchor:
      "Screenshot of the Events listing page showing upcoming events as cards or",
    alt: "Events listing page with upcoming events and type badges",
    route: "/events",
  },
  {
    id: "04-05-create-event",
    doc: "04-events-meetings.md",
    line: 126,
    anchor:
      "Screenshot of the Create Event form showing fields for type, title, date/time,",
    alt: "Create Event form with type, title, date, location, and reminder fields",
    route: "/events/new",
    fullPage: true,
  },
  {
    id: "04-08-event-analytics",
    doc: "04-events-meetings.md",
    line: 234,
    anchor:
      "Screenshot of the EventAnalyticsPage showing the summary cards at the top, the",
    alt: "Event analytics page with summary cards and attendance charts",
    route: "/events/analytics",
    fullPage: true,
  },
  {
    id: "04-09-event-templates",
    doc: "04-events-meetings.md",
    line: 250,
    anchor:
      "Screenshot of the EventTemplatesPage showing a list of templates with name, type,",
    alt: "Event Templates page listing templates with type and active state",
    route: "/events/templates",
  },
  {
    id: "04-14-meeting-minutes",
    doc: "04-events-meetings.md",
    line: 423,
    anchor:
      "Screenshot of the minutes creation/editing page showing the meeting type selector, date,",
    alt: "Meeting minutes page with the meeting type selector and attendee list",
    route: "/minutes",
  },
  {
    id: "04-15-action-items",
    doc: "04-events-meetings.md",
    line: 454,
    anchor:
      "Screenshot of the Action Items page showing a filterable list of tasks",
    alt: "Action Items page listing tasks with assignee, due date, and status",
    route: "/action-items",
  },

  // ── 05 Inventory ────────────────────────────────────────────────────
  {
    id: "05-01-inventory-items",
    doc: "05-inventory.md",
    line: 52,
    anchor:
      "Screenshot of the Inventory Items List page showing the search bar, category",
    alt: "Inventory Items list with search, category filter, and status pills",
    route: "/inventory/items",
  },
  {
    id: "05-03-inventory-categories",
    doc: "05-inventory.md",
    line: 95,
    anchor:
      "Screenshot of the Categories tab showing a list of categories with item",
    alt: "Inventory categories page listing categories with item counts",
    route: "/inventory/admin/categories",
  },

  // ── 06 Apparatus & Facilities ───────────────────────────────────────
  {
    id: "06-01-apparatus-list",
    doc: "06-apparatus-facilities.md",
    line: 43,
    anchor:
      "Screenshot of the Apparatus listing page showing a grid or list of",
    alt: "Apparatus listing with unit numbers, type badges, and status badges",
    route: "/apparatus",
  },
  {
    id: "06-09-facilities-dashboard",
    doc: "06-apparatus-facilities.md",
    line: 167,
    anchor:
      "Screenshot of the Facilities Dashboard showing four summary statistic cards at the",
    alt: "Facilities dashboard with summary cards and facility cards",
    route: "/facilities",
    fullPage: true,
  },
  {
    id: "06-13-facility-maintenance",
    doc: "06-apparatus-facilities.md",
    line: 237,
    anchor:
      "Screenshot of the facility maintenance tab showing upcoming maintenance items as cards",
    alt: "Facility maintenance view with upcoming items and completed history",
    route: "/facilities/maintenance",
  },
  {
    id: "06-14-facility-inspections",
    doc: "06-apparatus-facilities.md",
    line: 261,
    anchor:
      "Screenshot of the Inspections tab showing a table of inspections with facility",
    alt: "Facility inspections table with type, date, inspector, and result",
    route: "/facilities/inspections",
  },

  // ── 07 Documents, Forms & Communications ────────────────────────────
  {
    id: "07-01-documents",
    doc: "07-documents-forms.md",
    line: 41,
    anchor:
      "Screenshot of the Documents page showing the folder tree on the left",
    alt: "Documents page with the folder tree, file list, and search bar",
    route: "/documents",
  },
  {
    id: "07-04-forms-list",
    doc: "07-documents-forms.md",
    line: 105,
    anchor:
      "Screenshot of the Forms listing page showing created forms with name, status",
    alt: "Forms listing page with status, submission counts, and actions",
    route: "/forms",
  },
  {
    id: "07-08-notification-rules",
    doc: "07-documents-forms.md",
    line: 247,
    anchor:
      "Screenshot of the Notification Rules & Logs page showing the three tabs,",
    alt: "Notification rules and logs page with summary cards and the rules list",
    route: "/notifications",
    fullPage: true,
  },
  {
    id: "07-13-integrations",
    doc: "07-documents-forms.md",
    line: 469,
    anchor:
      "Screenshot of the Integrations page showing available integrations as cards with logos,",
    alt: "Integrations page showing available integrations and connection status",
    route: "/integrations",
  },

  // ── 08 Administration & Reports ─────────────────────────────────────
  {
    id: "08-02-organization-settings",
    doc: "08-admin-reports.md",
    line: 67,
    anchor:
      "Screenshot of the Organization Settings page showing the department name, type selector,",
    alt: "Organization Settings page with department name, type, and timezone",
    route: "/settings",
    fullPage: true,
  },
  {
    id: "08-04-role-management",
    doc: "08-admin-reports.md",
    line: 209,
    anchor:
      "Screenshot of the Role Management page showing a list of positions on",
    alt: "Role Management page listing positions and their permissions",
    route: "/settings/roles",
  },
  {
    id: "08-06-reports",
    doc: "08-admin-reports.md",
    line: 261,
    anchor:
      "Screenshot of the Reports page showing the category filter buttons at the",
    alt: "Reports page with category filters and date range presets",
    route: "/reports",
  },
  {
    id: "08-07-analytics-dashboard",
    doc: "08-admin-reports.md",
    line: 281,
    anchor:
      "Screenshot of the Analytics Dashboard showing metric cards at the top (total",
    alt: "Analytics dashboard with metric cards and trend charts",
    route: "/admin/analytics",
    fullPage: true,
  },
  {
    id: "08-08-public-portal",
    doc: "08-admin-reports.md",
    line: 305,
    anchor:
      "Screenshot of the Public Portal configuration page showing the enable toggle, domain",
    alt: "Public Portal configuration page with the enable toggle and domain settings",
    route: "/admin/public-portal",
    fullPage: true,
  },
  {
    id: "08-11-error-monitor",
    // 'No errors found' is the healthy state this page should show
    allowEmptyState: true,
    doc: "08-admin-reports.md",
    line: 367,
    anchor:
      "Screenshot of the Error Monitor page showing a table of recent errors",
    alt: "Error Monitor page listing recent application errors",
    route: "/admin/errors",
  },
  {
    id: "08-19-audit-log",
    doc: "08-admin-reports.md",
    line: 532,
    anchor: "Audit Log page showing the Total / Critical / Warnings / Info",
    alt: "Audit Log page with summary stat cards and the filter bar",
    route: "/admin/audit-log",
    fullPage: true,
  },
  // ── Email template editor ──────────────────────────────────────────
  //
  // The page selects its first template on load, so neither of these has to
  // pick one — but the Discard button exists only while the editor is dirty,
  // which is why that shot types into the HTML body first.
  {
    id: "08-56-template-discard",
    doc: "08-admin-reports.md",
    line: 1325,
    anchor: 'Screenshot of the template editor showing the "Discard" button',
    alt: "The template editor with unsaved changes, showing Discard beside Save",
    route: "/communications/email-templates",
    prepare: async (page) => {
      const body = page.locator("#template-html");
      await body.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
      await body.click({ timeout: 10_000 });
      await page.keyboard.type("\n<!-- edited -->");
      await page.waitForTimeout(400);
    },
    // Viewport, not full page: the template list runs to forty-odd entries, so
    // a full-page shot is mostly sidebar — and Playwright renders the fixed nav
    // partway down a tall capture, which reads as a layout bug. Everything the
    // placeholder names sits above the fold.
  },
  {
    id: "08-57-template-reset-dialog",
    doc: "08-admin-reports.md",
    line: 1340,
    anchor: 'Screenshot of the "Reset to Default" confirmation dialog',
    alt: "The Reset to Default confirmation, naming what it restores and what it keeps",
    route: "/communications/email-templates",
    prepare: clickByName(/^Reset$/),
  },
  {
    id: "08-58-template-send-test",
    doc: "08-admin-reports.md",
    line: 1358,
    anchor: 'Screenshot of the "Send Test Email to Me" button',
    alt: "Send Test Email to Me, under the rendered preview it sends",
    route: "/communications/email-templates",
    // The button lives under the Preview tab, not in the toolbar, and stays
    // disabled until a preview has been rendered — clicking Preview is what
    // renders one. Deliberately not clicked: sending needs a working mail
    // transport, and a staged success toast would be a picture of something
    // that did not happen.
    prepare: async (page) => {
      await clickByName(/^Preview$/)(page);
      await page.waitForTimeout(1500);
      await page
        .getByRole("button", { name: /Send Test Email to Me/i })
        .scrollIntoViewIfNeeded({ timeout: 10_000 })
        .catch(() => {});
    },
  },

  // ── Audit log ──────────────────────────────────────────────────────
  //
  // The filters are component state with no URL form, so each of these types
  // into the search box or picks from the category select rather than
  // navigating to a filtered route.
  {
    id: "08-53-audit-log-expanded",
    doc: "08-admin-reports.md",
    line: 1544,
    anchor:
      "Screenshot of the Audit Log page showing the summary stat cards at the top",
    alt: "The audit log with a row expanded to its JSON event metadata",
    route: "/admin/audit-log",
    prepare: async (page) => {
      const row = page.locator("tbody tr").first();
      await row.click({ timeout: 15_000 });
      await page.waitForTimeout(400);
    },
    fullPage: true,
  },
  {
    id: "08-54-audit-shift-reports",
    doc: "08-admin-reports.md",
    line: 551,
    anchor: 'Screenshot of the Audit Log searched for "shift_report"',
    alt: "The audit log searched for shift_report, listing review and update events",
    route: "/admin/audit-log",
    prepare: async (page) => {
      await page.getByLabel(/search audit log/i).fill("shift_report");
      // Apply, not just type. The search box holds its own draft state and
      // only reaches the query on Apply — the severity and category selects
      // refetch on change, which is what made the first attempt at this shot
      // show a filled-in search box above 1,865 unfiltered rows.
      await page.getByRole("button", { name: /^Apply$/ }).click();
      await page.waitForTimeout(1200);
    },
    fullPage: true,
  },
  {
    id: "08-55-audit-medical",
    doc: "08-admin-reports.md",
    line: 564,
    anchor:
      "Screenshot of the Audit Log with its category filter set to medical_screening",
    alt: "The audit log filtered to the medical screening category",
    route: "/admin/audit-log",
    prepare: async (page) => {
      await page
        .getByLabel(/filter by category/i)
        .selectOption("medical_screening");
      await page.waitForTimeout(1200);
    },
    fullPage: true,
  },
  {
    id: "08-21-medical-screening",
    doc: "08-admin-reports.md",
    line: 859,
    anchor:
      "Screenshot of the Medical Screening page showing the Requirements tab with a",
    alt: "Medical Screening page showing the configured requirements",
    route: "/medical-screening",
  },

  // ── 09 Skills Testing ───────────────────────────────────────────────
  {
    id: "09-01-skill-templates",
    doc: "09-skills-testing.md",
    line: 51,
    anchor:
      "Screenshot of the Skill Sheet Templates list page showing a table of",
    alt: "Skill sheet templates list with category and publication status",
    // Not /training/skills-testing. That route became the *member's* entry
    // point when skills testing opened to non-officers — Available Tests and My
    // Results — so it stopped showing the template library this placeholder is
    // about, and kept capturing cleanly while picturing the wrong page. The
    // officer-facing library lives under the Training Admin hub.
    route: "/training/admin?tab=templates",
  },
  {
    id: "09-02-create-template",
    doc: "09-skills-testing.md",
    line: 84,
    anchor:
      "Screenshot of the Create Template form showing the metadata fields: name input,",
    alt: "Create skill sheet template form with metadata fields",
    route: "/training/skills-testing/templates/new",
    fullPage: true,
  },
  {
    id: "09-07-candidate-search",
    doc: "09-skills-testing.md",
    line: 221,
    anchor: "The Start Skill Test page candidate field mid-search",
    alt: "Candidate name search on the Start Skill Test page with matching members listed",
    route: "/training/skills-testing/test/new",
    fullPage: true,
    // The candidate field is a server-side search, not a dropdown, so the
    // populated state only exists mid-typing. Two characters is the documented
    // minimum the endpoint accepts; anything shorter returns nothing and the
    // shot would picture an empty list. The search is debounced, so the results
    // are waited for rather than assumed.
    prepare: async (page) => {
      const search = page.getByPlaceholder("Type a name to search...");
      await search.waitFor({ state: "visible", timeout: 10_000 });
      await search.fill("a");
      await search.fill("an");
      await page.waitForTimeout(1200);
    },
  },
  {
    id: "09-08-template-result-disclosure",
    doc: "09-skills-testing.md",
    line: 863,
    anchor: 'The template builder\'s "Result Disclosure" group',
    alt: "Per-template Result Disclosure controls showing the inherited default",
    route: "/training/skills-testing/templates/new",
    // Clipped to the group rather than shot full-page: the placeholder is about
    // three controls near the bottom of a long builder form, and a full-page
    // capture renders them too small to read the inherit labels, which are the
    // whole point of the picture.
    selector: "div:has(> p:text-is('Result Disclosure'))",
    prepare: async (page) => {
      const group = page.getByText("Result Disclosure", { exact: true });
      await group.waitFor({ state: "visible", timeout: 10_000 });
      await group.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    },
  },
  {
    id: "09-09-member-skills-testing",
    doc: "09-skills-testing.md",
    line: 187,
    anchor: "The Skills Testing landing page as seen by an",
    alt: "Skills Testing as an ordinary member sees it — available tests and their own results",
    // Same URL as 09-01, deliberately: this route renders an entirely different
    // page depending on who is signed in, which is the point the placeholder
    // makes. The officer's template library is under /training/admin.
    route: "/training/skills-testing",
    auth: "member",
  },
  {
    id: "09-10-member-awaiting-validation",
    doc: "09-skills-testing.md",
    line: 389,
    anchor: 'A member\'s "My Training → Skills Tests" list showing',
    alt: "A member's own skills tests, one awaiting an officer's validation with its outcome withheld",
    route: "/training/my-training",
    auth: "member",
    fullPage: true,
    prepare: async (page) => {
      // My Training renders its sections as collapsibles, and Skills Tests is
      // collapsed by default — scrolling to the header alone captures a closed
      // panel, which pictures none of what the placeholder describes.
      const header = page.getByText("Skills Tests", { exact: true }).first();
      await header.waitFor({ state: "visible", timeout: 15_000 });
      await header.scrollIntoViewIfNeeded();
      await header.click();
      // Wait for the list this section fetches on expand, not a fixed delay.
      await page
        .getByText(/awaiting validation|practice|no skills tests/i)
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    id: "09-11-validation-queue",
    doc: "09-skills-testing.md",
    line: 418,
    anchor: 'The Test Records tab filtered to "Awaiting',
    alt: "Officer review queue — completed results awaiting validation, with Validate and Void actions",
    route: "/training/admin?tab=tests",
    fullPage: true,
    // The queue is a filter on the records tab rather than a page of its own,
    // and it is an option in the status dropdown — not a button or a tab — so
    // the shot has to select it. Without this the capture shows "All Statuses"
    // and pictures the whole history instead of the queue.
    prepare: async (page) => {
      const status = page.locator("select").first();
      await status.waitFor({ state: "visible", timeout: 15_000 });
      await status.selectOption("pending_validation");
      // Waits on the row badge, scoped to a span. The dropdown's own option
      // reads "Needs Validation" too and comes first in the DOM, and an option
      // inside a closed native select is never "visible" — so an unscoped text
      // wait hangs on the wrong element until it times out.
      await page
        .locator('span:text-is("Needs validation")')
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    id: "09-12-summary-pending-validation",
    doc: "09-skills-testing.md",
    line: 533,
    anchor: "The Summary dashboard viewed by a training officer",
    alt: "Skills testing summary with a non-zero Pending Validation count",
    // The stat cards live on the Templates tab, not Test Records — and the card
    // is labelled "Needs Validation", which it earns by *replacing* the pass
    // rate while the queue is non-empty. Clipped to the card row so the swap is
    // legible; a full-page shot of this tab is already 09-01.
    route: "/training/admin?tab=templates",
    selector: "div.grid:has(p:text-is('Needs Validation'))",
    prepare: async (page) => {
      await page
        .getByText("Needs Validation", { exact: true })
        .waitFor({ state: "visible", timeout: 15_000 });
    },
  },
  {
    id: "09-13-test-viewers-panel",
    doc: "09-skills-testing.md",
    line: 829,
    anchor: "The Viewers panel on an open test, showing one",
    alt: "Named viewers on a single test, with the note that a viewer never sees more than the candidate",
    route: "/training/skills-testing",
    // Clipped to the panel rather than shot full-page. The panel sits at the
    // bottom of a long scorecard, so a full-page capture is mostly criteria
    // rows — and the page's fixed sidebar renders twice down a tall fullPage
    // image, which reads as a glitch in a published guide.
    selector: 'div.card:has(p:text-is("Who else can see this result"))',
    prepare: async (page, helpers) => {
      // The panel renders only on the review view of a *completed*, official
      // test, and only for an officer — so the match is not optional here: the
      // seeder's draft tests come back first and none of them shows it.
      await openFirstFromApi(
        "/training/skills-testing/tests",
        (id) => `/training/skills-testing/test/${id}`,
        "tests",
        (test) => test.status === "completed" && !test.is_practice,
      )(page, helpers);
      const viewers = page.getByText(/who else can see this result/i).first();
      await viewers.waitFor({ state: "visible", timeout: 20_000 });
      await viewers.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    },
  },

  // ── 10 Mobile & PWA ─────────────────────────────────────────────────
  {
    id: "10-10-mobile-minimum-text",
    doc: "10-mobile-pwa.md",
    line: 175,
    anchor: "The dashboard on a phone showing the relative",
    alt: "Dashboard on a phone with relative timestamps and navigation labels at the 12px minimum",
    route: "/dashboard",
    viewport: "mobile",
    allowEmptyState: true,
    // Not fullPage: the bottom navigation is fixed, and a full-page capture
    // scrolls it out of frame — but its labels are one of the four things the
    // 12px floor was introduced for, so the shot has to be the viewport.
  },
  {
    id: "10-11-public-form-dark",
    doc: "10-mobile-pwa.md",
    line: 197,
    anchor: "The public form page (`/f/<slug>`) in dark mode",
    alt: "The public form page in dark mode, readable on the themed background",
    // Resolved in prepare — the route is not known until capture time.
    route: "/login",
    auth: "anonymous",
    theme: "dark",
    fullPage: true,
    prepare: async (page, helpers) => {
      // The slug is minted per seed, and this shot is signed out, so the
      // lookup borrows the administrator's session. `/f/{slug}` serves
      // published public forms only — the seeder publishes one.
      const admin = await helpers.lookupPage();
      const slug = await admin.evaluate(async () => {
        const response = await fetch("/api/v1/forms", {
          credentials: "include",
        });
        if (!response.ok) return null;
        const body = await response.json();
        const forms = Array.isArray(body)
          ? body
          : body.forms || body.items || [];
        const target = forms.find((f) => f.is_public && f.public_slug);
        return target ? target.public_slug : null;
      });
      if (!slug) throw new Error("no published public form to capture");
      await page.goto(`${new URL(page.url()).origin}/f/${slug}`, {
        waitUntil: "domcontentloaded",
      });
    },
  },
  {
    id: "10-12-mobile-bottom-nav",
    doc: "10-mobile-pwa.md",
    line: 127,
    anchor:
      "Screenshot of the app on a phone in standalone mode showing the bottom tab bar",
    alt: "Bottom navigation bar as it appears on a phone",
    route: "/dashboard",
    viewport: "mobile",
    // Clipped to the bar itself: the placeholder is about the tab strip, and a
    // whole-phone shot renders it as a sliver at the bottom of a long page.
    selector: 'nav[aria-label="Primary"].fixed',
    allowEmptyState: true,
  },
  {
    id: "10-13-mobile-top-bar",
    doc: "10-mobile-pwa.md",
    line: 538,
    anchor:
      "Screenshot of the mobile top navigation bar showing the hamburger menu, page title",
    alt: "Mobile top bar with the menu button, page title and notification badge",
    route: "/dashboard",
    viewport: "mobile",
    selector: "header",
    allowEmptyState: true,
    holdBack:
      "the phone top bar is logo, department name and hamburger — the bell and " +
      "its unread badge are inside the menu, not on the bar the placeholder describes",
  },
  {
    id: "10-04-mobile-dashboard",
    // same dashboard, phone width
    allowEmptyState: true,
    doc: "10-mobile-pwa.md",
    line: 291,
    anchor:
      "Screenshot of the Dashboard on a mobile phone (portrait) showing stacked widget",
    alt: "Dashboard on a phone in portrait orientation with stacked widget cards",
    route: "/dashboard",
    viewport: "mobile",
    fullPage: true,
  },
  {
    id: "10-05-mobile-inventory",
    doc: "10-mobile-pwa.md",
    line: 304,
    anchor:
      "Screenshot of the Inventory Items List on a mobile phone showing item",
    alt: "Inventory items list on a phone, rendered as cards instead of table rows",
    route: "/inventory/items",
    viewport: "mobile",
  },
  {
    id: "10-06-mobile-inventory-admin",
    doc: "10-mobile-pwa.md",
    line: 307,
    anchor:
      "Screenshot of the Inventory Admin Hub on a mobile phone showing grouped",
    alt: "Inventory admin hub on a phone with grouped card sections stacked vertically",
    route: "/inventory/admin",
    viewport: "mobile",
    fullPage: true,
  },

  // ── 11 Finance ──────────────────────────────────────────────────────
  {
    id: "11-01-finance-dashboard",
    doc: "11-finance.md",
    line: 93,
    anchor:
      "The Finance Dashboard showing budget health summary cards at the top (total",
    alt: "Finance dashboard with budget health cards and recent transactions",
    route: "/finance",
    fullPage: true,
  },
  {
    id: "11-02-fiscal-year-settings",
    doc: "11-finance.md",
    line: 125,
    anchor: "The Fiscal Year Settings page showing a list of fiscal years with",
    alt: "Fiscal year settings listing fiscal years with status badges",
    route: "/finance/settings",
    fullPage: true,
  },
  {
    id: "11-06-approval-chains",
    doc: "11-finance.md",
    line: 352,
    anchor:
      "The Create Approval Chain form showing the name field, applies-to dropdown (Purchase",
    alt: "Approval chain configuration page with the chain list and step builder",
    route: "/finance/settings/approval-chains",
    fullPage: true,
  },
  {
    id: "11-08-create-purchase-request",
    doc: "11-finance.md",
    line: 498,
    anchor:
      "The Create Purchase Request form showing all fields: title, fiscal year dropdown,",
    alt: "Create Purchase Request form with budget, vendor, and priority fields",
    route: "/finance/purchase-requests/new",
    fullPage: true,
  },
  {
    id: "11-10-create-expense-report",
    // a brand-new expense report legitimately has no line items yet
    allowEmptyState: true,
    doc: "11-finance.md",
    line: 611,
    anchor:
      "The Create Expense Report form showing the header fields at the top",
    alt: "Create Expense Report form with header fields and the line items section",
    route: "/finance/expenses/new",
    fullPage: true,
  },
  {
    id: "11-12-create-check-request",
    doc: "11-finance.md",
    line: 728,
    anchor:
      "The Create Check Request form showing payee name, amount, fiscal year dropdown,",
    alt: "Create Check Request form with payee, amount, and budget fields",
    route: "/finance/check-requests/new",
    fullPage: true,
  },
  {
    id: "11-15-dues-management",
    doc: "11-finance.md",
    line: 948,
    anchor:
      "The Dues Management page showing the summary cards at the top (total",
    alt: "Dues management page with collection summary cards and the member dues table",
    route: "/finance/dues",
    fullPage: true,
  },

  // ── 12 Grants & Fundraising ─────────────────────────────────────────
  {
    id: "12-02-grants-dashboard",
    doc: "12-grants-fundraising.md",
    line: 70,
    anchor:
      "Screenshot of the Grants Dashboard showing KPI cards (Total Raised: $125,000, Active",
    alt: "Grants dashboard with KPI cards for raised funds and active campaigns",
    route: "/grants",
    fullPage: true,
  },
  {
    id: "12-03-opportunities",
    doc: "12-grants-fundraising.md",
    line: 103,
    anchor:
      "Screenshot of the Opportunities Library showing a grid of grant program cards",
    alt: "Grant opportunities library showing available grant programs",
    route: "/grants/opportunities",
  },
  {
    id: "12-04-create-application",
    doc: "12-grants-fundraising.md",
    line: 125,
    anchor:
      "Screenshot of the Create Application form showing program name, agency, amount requested,",
    alt: "Create grant application form with program, agency, and amount fields",
    route: "/grants/applications/new",
    fullPage: true,
  },
  {
    id: "12-05-applications-pipeline",
    doc: "12-grants-fundraising.md",
    line: 152,
    anchor:
      "Screenshot of the Applications page in Pipeline (kanban) view showing columns for",
    alt: "Grant applications in pipeline view with a column per status",
    route: "/grants/applications",
  },
  {
    id: "12-10-donors",
    doc: "12-grants-fundraising.md",
    line: 331,
    anchor:
      "Screenshot of a donor profile showing contact details, giving summary (Total: $2,500",
    alt: "Donor list with contact details and giving summaries",
    route: "/grants/donors",
  },
  {
    id: "12-14-fundraising-reports",
    doc: "12-grants-fundraising.md",
    line: 462,
    anchor:
      "Screenshot of the Fundraising Report showing donation trends chart (monthly bars), top",
    alt: "Fundraising report with donation trends and top campaigns",
    route: "/grants/reports",
    fullPage: true,
  },

  // ── 13 Medical Screening ────────────────────────────────────────────
  {
    id: "13-01-medical-landing",
    doc: "13-medical-screening.md",
    line: 38,
    anchor:
      "The Medical Screening landing page showing the three-tab navigation (Requirements, Records, Compliance)",
    alt: "Medical Screening landing page with its three-tab navigation",
    route: "/medical-screening",
  },

  // ── 14 Elections ────────────────────────────────────────────────────
  {
    id: "14-01-elections-list",
    doc: "14-elections.md",
    line: 56,
    anchor:
      "Screenshot of the Elections list page showing several elections with status badges",
    alt: "Elections list showing elections with status badges",
    route: "/elections",
  },
  {
    id: "14-16-election-settings",
    doc: "14-elections.md",
    line: 700,
    anchor:
      "Screenshot of the Election Settings page showing toggle switches for each setting,",
    alt: "Election settings page with the default rule toggles",
    route: "/elections/settings",
    fullPage: true,
  },

  // ── 15 Prospective Members ──────────────────────────────────────────
  {
    id: "15-01-pipeline-board",
    doc: "15-prospective-members.md",
    line: 49,
    anchor:
      "Screenshot of the Prospective Members main page showing the kanban board view",
    alt: "Prospective members kanban board with a column per pipeline stage",
    route: "/prospective-members",
  },
  {
    id: "15-02-board-truncated",
    doc: "15-prospective-members.md",
    line: 253,
    anchor: "The kanban board for a pipeline with more than 200",
    alt: "Kanban board reporting that it is showing only the first page of a larger pipeline",
    route: "/prospective-members",
    // Needs a pipeline larger than the board's 200-card ceiling, which the
    // ordinary seed deliberately does not create:
    //   python scripts/screenshots/seed_demo_data.py --bulk-prospects
    // Without it the notice never renders and this shot is skipped rather than
    // capturing an ordinary board under a placeholder describing a full one.
    prepare: async (page) => {
      const notice = page
        .getByRole("status")
        .filter({ hasText: /Showing \d+ of \d+ applicants/ });
      await notice.first().waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    id: "15-09-bulk-action-result",
    doc: "15-prospective-members.md",
    line: 495,
    anchor: "The pair of notifications after a bulk advance that",
    alt: "Bulk advance reporting how many moved and naming the applicants it skipped",
    route: "/prospective-members",
    // Runs a real bulk advance, so it *changes the seeded data* — which is why
    // it sits last among the 15-* shots. Re-running the seeder restores a mixed
    // page (it tops the pipeline up and re-parks two applicants at the final
    // stage), so the shot is repeatable; it is just not idempotent on its own.
    //
    // The partial failure is the point. Page one is deliberately mixed: most
    // rows are at intake and a few are at the final stage, where advancing is
    // refused. Selecting the page produces both toasts — the count that moved,
    // and the named applicants that could not.
    prepare: async (page) => {
      await clickByName("Table")(page);
      const selectAll = page.locator("thead th:first-child button");
      await selectAll.waitFor({ state: "visible", timeout: 15_000 });
      await selectAll.click();
      await clickByName("Advance All")(page);
      // Both toasts, not just the first: the success one renders immediately
      // and the skipped one follows the response, so waiting on either alone
      // races the capture.
      await page
        .getByText(/Skipped \d+:/)
        .first()
        .waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForTimeout(600);
    },
  },
  {
    id: "15-10-pipeline-settings",
    doc: "15-prospective-members.md",
    line: 371,
    anchor:
      "Screenshot of the Inactivity Configuration panel showing the timeout preset dropdown, warning",
    alt: "Prospective members settings showing the inactivity configuration panel",
    route: "/prospective-members/settings",
    prepare: openPipelineSettings(),
    fullPage: true,
  },

  // ── 16 Integrations ─────────────────────────────────────────────────
  {
    id: "16-01-integrations-catalog",
    doc: "16-integrations.md",
    line: 39,
    anchor:
      "Screenshot of the Integrations page showing the catalog grid with connected integrations",
    alt: "Integrations catalog grid with connection status on each card",
    route: "/integrations",
    fullPage: true,
  },

  // ── 17 Privacy & Data Rights ────────────────────────────────────────
  {
    id: "17-01-privacy-choices",
    doc: "17-privacy-data-rights.md",
    line: 43,
    anchor:
      "Screenshot of Settings → Security showing the Privacy Choices section with three",
    alt: "Account security settings showing the privacy choices section",
    route: "/settings/account",
    fullPage: true,
  },

  // ── 18 Department Store ─────────────────────────────────────────────
  {
    id: "18-01-member-storefront",
    doc: "18-storefront.md",
    line: 56,
    anchor:
      "Screenshot of the member storefront at `/store` showing the open window banner,",
    alt: "Member storefront with the order window banner and product grid",
    route: "/store",
    fullPage: true,
  },
  {
    id: "18-02-store-admin",
    doc: "18-storefront.md",
    line: 311,
    anchor:
      "Screenshot of the Settings tab showing the payment method checkboxes with the",
    alt: "Store administration settings with the payment method options",
    route: "/store/admin",
    fullPage: true,
  },

  // ── Additional route-level and detail-page shots ────────────────────
  {
    id: "02-09-program-detail",
    doc: "02-training.md",
    line: 248,
    anchor:
      "Screenshot of a training program detail page showing the program name and",
    alt: "Training program detail with phases, requirements, and progress",
    route: "/training/programs",
    prepare: openFirstFromApi(
      "/training/programs/programs",
      (id) => `/training/programs/${id}`,
      "programs",
    ),
    fullPage: true,
  },
  {
    id: "02-21-expiring-certifications",
    doc: "02-training.md",
    line: 596,
    anchor:
      "Screenshot of the Expiring Certifications page showing a table of upcoming expirations",
    alt: "Expiring certifications table sorted by expiration date",
    route: "/training/admin",
    fullPage: true,
  },
  {
    id: "03-04-my-shifts",
    doc: "03-scheduling.md",
    line: 87,
    anchor: "Screenshot of the My Shifts tab showing a list of upcoming shifts",
    alt: "My Shifts tab listing upcoming shifts with status badges",
    route: "/scheduling?tab=my-shifts",
    fullPage: true,
  },
  {
    id: "03-05-open-shifts",
    doc: "03-scheduling.md",
    line: 102,
    anchor:
      "Screenshot of the Open Shifts tab showing available shifts with date, time,",
    alt: "Open Shifts tab showing shifts with vacant positions",
    route: "/scheduling?tab=open-shifts",
    fullPage: true,
  },
  {
    id: "03-14-scheduling-reports",
    doc: "03-scheduling.md",
    line: 357,
    anchor:
      "Screenshot of the compliance report showing a requirement (e.g., 'Monthly Minimum Shifts:",
    alt: "Scheduling compliance report with per-member shift totals",
    route: "/scheduling/reports",
    fullPage: true,
  },
  {
    id: "04-02-event-detail",
    doc: "04-events-meetings.md",
    line: 73,
    anchor:
      "Screenshot of an event detail page showing the event header (title, date,",
    alt: "Event detail page with the header, description, and RSVP controls",
    route: "/events",
    prepare: openFirstFromApi(
      "/events?limit=100",
      (id) => `/events/${id}`,
      "events",
      isUpcoming,
    ),
    fullPage: true,
  },
  {
    id: "06-03-apparatus-detail",
    doc: "06-apparatus-facilities.md",
    line: 72,
    anchor:
      "Screenshot of an apparatus detail page showing the unit header (photo, name,",
    alt: "Apparatus detail page with the unit header and tabbed sections",
    route: "/apparatus",
    prepare: openFirstFromApi(
      "/apparatus",
      (id) => `/apparatus/${id}`,
      "apparatus",
    ),
    fullPage: true,
  },
  {
    id: "06-11-facility-detail",
    doc: "06-apparatus-facilities.md",
    line: 201,
    anchor:
      "Screenshot of the Facility Detail page showing the sidebar navigation on the",
    alt: "Facility detail page with its sidebar navigation and content area",
    route: "/facilities",
    prepare: openFirstFromApi(
      "/facilities",
      (id) => `/facilities/${id}`,
      "facilities",
    ),
    fullPage: true,
  },
  {
    id: "11-03-budget-categories",
    doc: "11-finance.md",
    line: 176,
    anchor:
      "The Budget Categories section on the Settings page showing a hierarchical list",
    alt: "Budget categories list with QuickBooks account mapping",
    route: "/finance/settings",
    prepare: clickByName(/categor/i),
    fullPage: true,
  },
  {
    id: "11-05-budget-detail",
    doc: "11-finance.md",
    line: 249,
    anchor:
      "A Budget Detail page showing the budget category and amount at the",
    alt: "Budget detail with spend progress and linked transactions",
    route: "/finance/budgets",
    prepare: openFirstFromApi(
      "/finance/budgets",
      (id) => `/finance/budgets/${id}`,
      "budgets",
    ),
    fullPage: true,
  },
  {
    id: "12-09-campaign-detail",
    doc: "12-grants-fundraising.md",
    line: 298,
    anchor:
      "Screenshot of a campaign detail page showing '2026 Equipment Fund' with progress",
    alt: "Fundraising campaign detail with the goal progress bar and donations",
    route: "/grants/campaigns",
    prepare: openFirstFromApi(
      "/grants/campaigns",
      (id) => `/grants/campaigns/${id}`,
      "campaigns",
    ),
    fullPage: true,
  },

  // ── Second batch: module sub-pages and detail views ────────────────
  {
    id: "05-02-inventory-dashboard",
    doc: "05-inventory.md",
    line: 580,
    anchor:
      "Screenshot of the inventory summary/dashboard showing alert cards for low stock items",
    alt: "Inventory dashboard with low-stock, maintenance, and assignment alert cards",
    route: "/inventory",
    fullPage: true,
  },
  {
    id: "05-06-item-detail",
    doc: "05-inventory.md",
    line: 403,
    anchor:
      "Screenshot of the Item Detail page showing the two-column layout. Left sidebar",
    alt: "Inventory item detail with its barcode, quick info, and history panels",
    route: "/inventory/items",
    prepare: openFirstFromApi(
      "/inventory/items?limit=1",
      (id) => `/inventory/items/${id}`,
      "items",
    ),
    fullPage: true,
  },
  {
    id: "05-08-checkouts",
    doc: "05-inventory.md",
    line: 457,
    anchor:
      "Screenshot of the checkout form showing the item being checked out, the",
    alt: "Equipment checkout page with the item, member, and expected return date",
    route: "/inventory/checkouts",
    fullPage: true,
  },
  {
    id: "05-11-allowances",
    doc: "05-inventory.md",
    line: 287,
    anchor:
      "Screenshot of the Issuance Allowances admin page showing a list of allowance",
    alt: "Issuance allowances with per-category limits and periods",
    route: "/inventory/admin/allowances",
  },
  {
    id: "05-14-reorder-requests",
    doc: "05-inventory.md",
    line: 367,
    anchor:
      "Screenshot of the Reorder Requests page showing a table of reorder requests",
    alt: "Reorder requests table with requested quantities and status",
    route: "/inventory/admin/reorder",
  },
  {
    id: "05-24-member-inventory",
    doc: "05-inventory.md",
    line: 765,
    anchor:
      "Screenshot of the Members inventory tab showing a list of members with",
    alt: "Members inventory tab listing each member and their assigned item count",
    route: "/inventory/admin/members",
  },
  {
    id: "05-25-admin-hub",
    doc: "05-inventory.md",
    line: 792,
    anchor:
      "Screenshot of the Inventory Admin Hub showing the three prominent cards at",
    alt: "Inventory admin hub with its grouped navigation cards",
    route: "/inventory/admin",
    fullPage: true,
  },
  {
    id: "05-53-items-variant-capsules",
    doc: "05-inventory.md",
    line: 1423,
    anchor:
      "Screenshot of the Inventory Items List showing several item cards, with variant items",
    alt: "The inventory items list with size, colour and style capsules on the variant items",
    route: "/inventory/items",
    fullPage: true,
  },
  {
    id: "05-54-admin-hub-assign",
    doc: "05-inventory.md",
    line: 1485,
    anchor:
      'Screenshot of the Inventory Admin Hub showing the "Assign to Member" button',
    alt: "The inventory admin hub with Assign to Member in the header above the navigation cards",
    route: "/inventory/admin",
    fullPage: true,
  },
  {
    id: "05-55-member-picker",
    doc: "05-inventory.md",
    line: 1487,
    anchor: "Screenshot of the member picker modal showing the search field",
    alt: "The member picker opened from Assign to Member, with its search field and roster",
    route: "/inventory/admin",
    prepare: clickByName(/Assign to Member/i),
  },
  {
    id: "05-56-item-barcode-value",
    doc: "05-inventory.md",
    line: 1556,
    anchor:
      "Screenshot of an item's Basic Info card showing the sequential barcode value",
    alt: "An item's Basic Info card, its sequential barcode value beside the asset tag",
    route: "/inventory/items",
    prepare: openFirstFromApi(
      "/inventory/items?limit=50",
      (id) => `/inventory/items/${id}`,
      "items",
      // The barcode sidebar only has something to show for an item that has
      // one, and not every seeded item is barcoded.
      (item) => Boolean(item.barcode ?? item.barcode_value),
    ),
    // Clipped to the Basic Info card. The placeholder is about one field, and
    // a whole-page shot buries it — the detail page is already pictured in
    // full by 05-06.
    selector: 'div:has(> h3:text("Basic Info"))',
  },
  {
    id: "05-31-equipment-kits",
    doc: "05-inventory.md",
    line: 1250,
    anchor:
      "Screenshot of the Equipment Kits admin page showing a list of kits",
    alt: "Equipment kits admin page listing kits with their component counts",
    route: "/inventory/admin/kits",
  },
  {
    id: "05-32-variant-groups",
    doc: "05-inventory.md",
    line: 1258,
    anchor:
      "Screenshot of the Variant Groups admin page showing variant groups with base",
    alt: "Variant groups admin page with base products and per-size stock",
    route: "/inventory/admin/variant-groups",
  },
  {
    id: "05-33-label-printing",
    doc: "05-inventory.md",
    line: 1271,
    anchor:
      "Screenshot of the label printing page showing the format dropdown (Letter, Dymo",
    alt: "Inventory label printing page with format presets and preview",
    route: "/inventory/print-labels",
    // The page prints whatever ?ids= names and otherwise renders "No items
    // specified" — which is what this shot published until 2026-08-09.
    prepare: withIdsFromApi("/inventory/items?limit=6", "items"),
    fullPage: true,
  },
  {
    id: "05-36-storage-areas",
    doc: "05-inventory.md",
    line: 1307,
    anchor:
      "Screenshot of the Storage Areas page showing an expanded storage area panel",
    alt: "Storage areas page with an expanded area listing its items",
    route: "/inventory/storage-areas",
    prepare: async (page) => {
      await selectStorageRoom(page);
      // The last area rather than the first, so this and 05-48 — which both
      // want an area expanded — do not publish the same picture twice.
      await page
        .getByRole("button", { name: /^Show \d+ items? in / })
        .last()
        .click({ timeout: 10_000 });
    },
    fullPage: true,
  },
  {
    id: "05-45-impact-planner",
    // the planner shows its filter panel before an analysis is run, which is the
    // state this section describes
    allowEmptyState: true,
    doc: "05-inventory.md",
    line: 1595,
    anchor:
      "Screenshot of the Impact Planner page showing the filter panel on the",
    alt: "Inventory impact planner with its filter panel and member analysis",
    route: "/inventory/admin/impact-planner",
    fullPage: true,
  },
  {
    id: "03-15-scheduling-settings",
    doc: "03-scheduling.md",
    line: 549,
    anchor:
      "Screenshot of Scheduling Settings showing the 'Platoons' toggle enabled, with a note",
    alt: "Scheduling settings with the platoons toggle and related options",
    route: "/scheduling/settings",
    fullPage: true,
  },
  // Scheduling settings deep-links by `?tab=`, and the shift-reports tab is
  // itself a section navigator showing one section at a time. Both are why
  // these are separate shots rather than one long fullPage capture: the guide
  // discusses the sections individually, and only one is on screen at a time.
  {
    id: "03-32-settings-general-closeout",
    doc: "03-scheduling.md",
    line: 1728,
    anchor: "showing the Close-out",
    alt: "Scheduling settings General tab with the close-out rules, overtime cap and shift generation options",
    route: "/scheduling/settings?tab=general",
    fullPage: true,
  },
  {
    id: "03-33-settings-eligibility",
    doc: "03-scheduling.md",
    line: 619,
    anchor: "eligible shift positions each rank may fill",
    alt: "Operational Ranks settings, listing each rank with the shift positions it may fill",
    // Not the scheduling module's own Eligibility tab, which controls something
    // else entirely: which *membership types* may self-sign-up, and which
    // positions are open to everyone. Per-rank position eligibility is set on
    // the ranks themselves, in the main settings area.
    route: "/settings?tab=ranks",
    fullPage: true,
  },
  {
    id: "03-40-settings-position-eligibility",
    doc: "03-scheduling.md",
    line: 627,
    anchor: "which membership types may sign themselves up",
    alt: "Scheduling settings Eligibility tab, excluding membership types from self-signup and listing open positions",
    route: "/scheduling/settings?tab=eligibility",
    fullPage: true,
  },
  {
    id: "03-34-settings-checklist-timing",
    doc: "03-scheduling.md",
    line: 802,
    anchor: "Checklist Timing",
    alt: "Shift Reports settings with the Checklist Timing section selected",
    route: "/scheduling/settings?tab=shift-reports",
    prepare: clickSettingsSection("Checklist Timing"),
    fullPage: true,
  },
  {
    id: "03-35-settings-form-sections",
    doc: "03-scheduling.md",
    line: 836,
    anchor: "choosing which optional sections appear on the report form",
    alt: "Shift Reports settings Form Sections, toggling which parts of the report form appear",
    route: "/scheduling/settings?tab=shift-reports",
    prepare: clickSettingsSection("Form Sections"),
    fullPage: true,
  },
  {
    id: "03-36-settings-apparatus-skills",
    doc: "03-scheduling.md",
    line: 859,
    anchor: "per-apparatus skills/tasks selector",
    alt: "Shift Reports settings Apparatus Skills, showing the skills and tasks tracked for Engine",
    route: "/scheduling/settings?tab=shift-reports",
    prepare: async (page) => {
      await clickSettingsSection("Apparatus Skills")(page);
      // The section opens on the first apparatus type alphabetically
      // (Ambulance). The guide walks through Engine, so pick that one. The
      // pill carries its skill count, and its text is the raw lowercase type —
      // the initial capital is CSS `capitalize`, which never reaches the DOM —
      // so the match is loose and case-insensitive on both counts.
      await page
        .getByRole("button", { name: /^engine( \(\d+\))?$/i })
        .first()
        .click({ timeout: 10_000 });
    },
    fullPage: true,
  },
  {
    id: "03-37-settings-rating-scale",
    doc: "03-scheduling.md",
    line: 882,
    anchor: "rating scale section with Labeled Bubbles selected",
    alt: "Shift Reports settings Rating Scale, choosing the scale style and its per-level labels",
    route: "/scheduling/settings?tab=shift-reports",
    // **This shot changes the setting it pictures.** The display-style buttons
    // save on click — there is no separate confirm — so capturing the per-level
    // labels leaves the demo department on Labeled Bubbles rather than the
    // documented default of Stars (1-5). Anything picturing a rating input
    // afterwards shows bubbles. Re-select Stars in the UI when the default
    // matters; the seeder does not own this setting and will not restore it.
    prepare: async (page) => {
      await clickSettingsSection("Rating Scale")(page);
      // The per-level label editor renders only for the labelled style — the
      // default, Stars (1-5), hides it, and the placeholder is largely about
      // those labels. Selecting the other style is what puts them on screen.
      await page
        .getByRole("button", { name: /labeled bubbles/i })
        .first()
        .click({ timeout: 10_000 });
      // The save toast lands in the top-right corner and would otherwise sit
      // in the frame as though it were part of the settings page.
      await page
        .getByText(/display style updated/i)
        .first()
        .waitFor({ state: "hidden", timeout: 15_000 })
        .catch(() => {});
    },
    fullPage: true,
  },
  {
    id: "03-38-notifications-assignment",
    doc: "03-scheduling.md",
    line: 1289,
    anchor: "notification settings showing the Shift Assignment Alerts section",
    alt: "Scheduling notification settings showing the shift assignment alert options",
    route: "/scheduling/settings?tab=notifications",
    fullPage: true,
  },
  {
    id: "03-39-notifications-reminders",
    doc: "03-scheduling.md",
    line: 1302,
    anchor: "Start-of-Shift Reminders section with its enable toggle",
    alt: "Scheduling notification settings showing the start-of-shift reminder options",
    route: "/scheduling/settings?tab=notifications",
    // Same page as 03-38; this clips to the reminders block so the two shots
    // are not the same image under two placeholders. The heading sits in its
    // own flex row inside the section, so `:has(> h4)` selects that row and
    // clips to the title alone — the section is its grandparent.
    selector:
      'div:has(> div > h4:text-is("Start-of-Shift Reminders")):not(:has(div:has(> div > h4:text-is("Start-of-Shift Reminders"))))',
  },
  {
    id: "03-22-equipment-check-builder",
    // a builder opened on a new template correctly starts with no compartments;
    // the shot is of the builder layout
    allowEmptyState: true,
    doc: "03-scheduling.md",
    line: 668,
    anchor:
      "Screenshot of the Equipment Check Template Builder showing the template header (name,",
    alt: "Equipment check template builder with the template header and sections",
    route: "/scheduling/equipment-check-templates/new",
    fullPage: true,
  },
  {
    id: "04-04-event-qr-code",
    doc: "04-events-meetings.md",
    line: 86,
    anchor: "Screenshot of the QR code display page showing a large QR code",
    alt: "Event QR code display page for member self check-in",
    route: "/events",
    prepare: openFirstFromApi(
      "/events?limit=100",
      (id) => `/events/${id}/qr-code`,
      "events",
      isUpcoming,
    ),
  },
  {
    id: "04-06-check-in-monitoring",
    doc: "04-events-meetings.md",
    line: 104,
    anchor:
      "Screenshot of the check-in monitoring page showing a real-time list of checked-in",
    alt: "Event check-in monitoring page with the live attendee list",
    route: "/events",
    prepare: openFirstFromApi(
      "/events?limit=100",
      (id) => `/events/${id}/monitoring`,
      "events",
      isInProgress,
    ),
    fullPage: true,
  },

  // ── Guest check-in ─────────────────────────────────────────────────
  //
  // The room display lists only events inside their check-in window, so all of
  // these depend on the seeder's Volunteer Interest Night, which it slides
  // forward on every run. The display and the sign-in page are public: they are
  // reached by the location's display code and take no session, which is the
  // whole point of the feature — a visitor has no account.
  {
    id: "04-30-room-display-guest-qr",
    doc: "04-events-meetings.md",
    line: 122,
    anchor: "The room display (`/display/:code`) for an event that",
    alt: "A room display showing the member and guest QR codes side by side under the event name",
    route: "/login",
    auth: "anonymous",
    prepare: withDisplayCode((code) => `/display/${code}`),
  },
  {
    id: "04-31-guest-check-in-settings",
    doc: "04-events-meetings.md",
    line: 139,
    anchor: "The Check-In Settings section of the Edit Event form",
    alt: "Check-In Settings on the event form with both guest toggles switched on",
    route: "/events",
    prepare: openFirstFromApi(
      "/events?limit=100",
      (id) => `/events/${id}/edit`,
      "events",
      (event) => event.title === "Volunteer Interest Night",
    ),
    fullPage: true,
  },
  {
    id: "04-32-guest-sign-in-form",
    doc: "04-events-meetings.md",
    line: 163,
    anchor: "The guest sign-in page as a visitor sees it on a",
    alt: "The guest sign-in form on a phone, with the event name above the name and contact fields",
    route: "/login",
    auth: "anonymous",
    viewport: "mobile",
    prepare: withDisplayCode(
      (code, eventId) => `/display/${code}/events/${eventId}/guest`,
    ),
    fullPage: true,
  },
  {
    id: "04-33-guest-sign-in-confirmation",
    doc: "04-events-meetings.md",
    line: 159,
    anchor: "The confirmation state after a guest signs in,",
    alt: "The guest sign-in confirmation naming the event and the time signed in",
    route: "/login",
    auth: "anonymous",
    viewport: "mobile",
    // **This shot signs a guest in.** The confirmation is client state that no
    // route reaches — the only way to it is to submit the form. It reuses the
    // seeder's visitor rather than inventing a new one on each capture: a
    // repeat sign-in is recognised and updates that attendee instead of adding
    // another, so running this a hundred times leaves one Rosa Delgado.
    prepare: async (page, ctx) => {
      await withDisplayCode(
        (code, eventId) => `/display/${code}/events/${eventId}/guest`,
      )(page, ctx);
      await page.getByLabel(/first name/i).fill("Rosa");
      await page.getByLabel(/last name/i).fill("Delgado");
      await page.getByLabel(/email/i).fill("rosa.delgado@example.com");
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.getByText(/You're signed in!/i).waitFor({ timeout: 15_000 });
    },
    fullPage: true,
  },
  {
    id: "04-34-guest-prospect-card",
    doc: "04-events-meetings.md",
    line: 177,
    anchor: "The prospective-members board showing a card created",
    alt: "The prospect opened by a guest sign-in, its Linked Events panel naming the open house",
    route: "/prospective-members",
    // Opened by clicking the card, not by a route: the drawer is component
    // state and `/prospective-members/prospects/<id>` is an API path with no
    // page behind it — navigating there lands on the dashboard.
    prepare: async (page) => {
      const card = page
        .locator("[class*='cursor-pointer']")
        .filter({ hasText: /Rosa Delgado/i })
        .first();
      await card.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
      await card.click({ timeout: 15_000 });
      await page.waitForTimeout(1500);
    },
    fullPage: true,
  },
  {
    id: "04-20-event-requests",
    doc: "04-events-meetings.md",
    line: 633,
    anchor:
      "Screenshot of the Event Requests tab showing a list of requests with",
    alt: "Event requests tab listing incoming requests with status badges",
    route: "/events/admin",
    fullPage: true,
  },
  {
    id: "08-01-setup-checklist",
    doc: "08-admin-reports.md",
    line: 43,
    anchor:
      "Screenshot of the Department Setup Checklist page showing a vertical checklist of",
    alt: "Department setup checklist with each step and its completion state",
    route: "/setup",
    fullPage: true,
  },
  {
    id: "02-41-training-admin-reports",
    doc: "02-training.md",
    line: 959,
    anchor:
      "The Training Admin Reports tab showing the Compliance, Hours Summary, and Certification",
    alt: "Training admin reports tab with the compliance, hours, and certification cards",
    route: "/training/admin",
    fullPage: true,
  },
  {
    id: "09-05-template-detail",
    doc: "09-skills-testing.md",
    line: 138,
    anchor:
      "Screenshot of the template detail page for a published template showing the",
    alt: "Published skill sheet template detail with its sections and criteria",
    route: "/training/skills-testing",
    prepare: openFirstFromApi(
      "/training/skills-testing/templates",
      (id) => `/training/skills-testing/templates/${id}`,
      "templates",
    ),
    fullPage: true,
  },

  // ── Third batch: tab-reachable views ───────────────────────────────
  {
    id: "06-04-apparatus-maintenance-tab",
    doc: "06-apparatus-facilities.md",
    line: 96,
    anchor:
      "Screenshot of the maintenance tab showing a timeline of past maintenance entries",
    alt: "Apparatus maintenance tab with past records and the add-maintenance form",
    route: "/apparatus",
    prepare: async (page) => {
      await openFirstFromApi(
        "/apparatus",
        (id) => `/apparatus/${id}`,
        "apparatus",
      )(page);
      await clickByName(/maintenance/i)(page);
    },
    fullPage: true,
  },
  {
    id: "06-05-apparatus-fuel-tab",
    doc: "06-apparatus-facilities.md",
    line: 113,
    anchor: "Screenshot of the fuel logs tab showing a table of fuel entries",
    alt: "Apparatus fuel logs tab with entries and calculated efficiency",
    route: "/apparatus",
    prepare: async (page) => {
      await openFirstFromApi(
        "/apparatus",
        (id) => `/apparatus/${id}`,
        "apparatus",
      )(page);
      await clickByName(/fuel/i)(page);
    },
    fullPage: true,
  },
  {
    id: "06-06-apparatus-equipment-tab",
    doc: "06-apparatus-facilities.md",
    line: 127,
    anchor: "Screenshot of the equipment tab showing a list of items on the",
    alt: "Apparatus equipment tab listing carried items with condition",
    route: "/apparatus",
    prepare: async (page) => {
      await openFirstFromApi(
        "/apparatus",
        (id) => `/apparatus/${id}`,
        "apparatus",
      )(page);
      await clickByName(/equipment/i)(page);
    },
    fullPage: true,
  },
  {
    id: "13-02-requirements-tab",
    doc: "13-medical-screening.md",
    line: 71,
    anchor:
      "The Requirements tab showing a table of requirements with columns: Name, Screening",
    alt: "Medical screening requirements tab with frequency and grace period",
    route: "/medical-screening",
    prepare: clickByName(/requirements/i),
    fullPage: true,
  },
  {
    id: "13-03-records-tab",
    doc: "13-medical-screening.md",
    line: 147,
    anchor:
      "The Records tab showing a table of screening records with columns: Member/Prospect",
    alt: "Medical screening records tab listing completed screenings",
    route: "/medical-screening",
    prepare: clickByName(/records/i),
    fullPage: true,
  },
  {
    id: "13-04-compliance-tab",
    doc: "13-medical-screening.md",
    line: 248,
    anchor:
      "The Compliance tab showing summary cards at the top (Total Requirements, Compliant,",
    alt: "Medical screening compliance tab with summary cards and per-member status",
    route: "/medical-screening",
    prepare: clickByName(/compliance/i),
    fullPage: true,
  },
  {
    id: "12-06-application-budget-tab",
    doc: "12-grants-fundraising.md",
    line: 184,
    anchor:
      "Screenshot of the Budget tab showing a table of budget items (Equipment:",
    alt: "Grant application budget tab with budgeted, spent, and remaining columns",
    route: "/grants/applications",
    prepare: async (page) => {
      await openFirstFromApi(
        "/grants/applications",
        (id) => `/grants/applications/${id}`,
        "applications",
      )(page);
      await clickByName(/budget/i)(page);
    },
    fullPage: true,
  },
  {
    id: "12-07-application-compliance-tab",
    doc: "12-grants-fundraising.md",
    line: 232,
    anchor:
      "Screenshot of the Compliance Tasks tab showing tasks with due dates, status",
    alt: "Grant application compliance tasks tab with due dates and status badges",
    route: "/grants/applications",
    prepare: async (page) => {
      await openFirstFromApi(
        "/grants/applications",
        (id) => `/grants/applications/${id}`,
        "applications",
      )(page);
      await clickByName(/compliance/i)(page);
    },
    fullPage: true,
  },
  {
    id: "18-03-order-windows",
    doc: "18-storefront.md",
    line: 412,
    anchor:
      "Screenshot of the Order Windows tab showing an open window card with",
    alt: "Store order windows tab with the open window and its order totals",
    route: "/store/admin",
    prepare: clickByName(/window/i),
    fullPage: true,
  },
  {
    id: "07-09-notification-send-log",
    doc: "07-documents-forms.md",
    line: 285,
    anchor:
      "Screenshot of the Send Log tab showing the channel filter buttons (All",
    alt: "Notification send log with channel filters and delivery status",
    route: "/notifications",
    prepare: clickByName(/log/i),
    fullPage: true,
  },
  {
    id: "03-25-equipment-checks-tab",
    doc: "03-scheduling.md",
    line: 1329,
    anchor:
      "Screenshot of the Equipment Checks tab showing a list of apparatus with",
    alt: "Equipment checks tab listing apparatus with their check status",
    route: "/scheduling?tab=equipment-checks",
    fullPage: true,
  },
  {
    id: "03-11-swap-requests-tab",
    doc: "03-scheduling.md",
    line: 1183,
    anchor:
      "Screenshot of the Requests tab showing a swap request card with inline",
    alt: "Scheduling requests tab with swap and time-off requests",
    route: "/scheduling?tab=requests",
    fullPage: true,
  },

  // ── Fourth batch: modals and creation forms ────────────────────────
  {
    id: "07-02-new-folder-dialog",
    doc: "07-documents-forms.md",
    line: 65,
    anchor:
      "Screenshot of the New Folder dialog showing the folder name field and",
    alt: "New folder dialog with the name field and parent folder selector",
    route: "/documents",
    prepare: clickByName(/new folder/i),
  },
  {
    id: "14-02-create-election",
    doc: "14-elections.md",
    line: 96,
    anchor:
      "Screenshot of the Create Election form showing title, description, type selector, date",
    alt: "Create Election form with title, dates, and voting method",
    route: "/elections",
    prepare: clickByName(/create election/i),
    fullPage: true,
  },
  {
    id: "13-05-add-requirement",
    doc: "13-medical-screening.md",
    line: 112,
    anchor:
      "The Add Requirement form/modal showing all fields filled out for an annual",
    alt: "Add screening requirement form with type, frequency, and grace period",
    route: "/medical-screening",
    prepare: clickByName(/add requirement/i),
    fullPage: true,
  },
  {
    id: "15-03-create-applicant",
    doc: "15-prospective-members.md",
    line: 150,
    anchor:
      "Screenshot of the Create Applicant form showing name, email, phone fields, membership",
    alt: "Create applicant form with contact fields and membership type",
    route: "/prospective-members",
    prepare: clickByName(/add applicant/i),
    fullPage: true,
  },
  {
    id: "01-19-create-waiver",
    doc: "01-membership.md",
    line: 485,
    anchor:
      "Screenshot of the Create Waiver form showing the member dropdown, 'Applies To'",
    alt: "Create waiver form with member, scope, and date range",
    route: "/members/admin/waivers",
    prepare: clickByName(/^create waiver$/i),
    fullPage: true,
  },
  {
    id: "02-03-submit-training",
    doc: "02-training.md",
    line: 86,
    anchor:
      "Screenshot of the Submit Training form showing the course dropdown with search",
    alt: "Submit Training form with course, date, hours, and attachment fields",
    route: "/training/my-training",
    prepare: clickByName(/submit training/i),
    fullPage: true,
  },
  {
    id: "05-04-variant-group-form",
    doc: "05-inventory.md",
    line: 146,
    anchor:
      "Screenshot of the Variant Group creation form showing the base product name",
    alt: "Variant group creation form with the size and colour matrix",
    route: "/inventory/admin/variant-groups",
    prepare: clickByName(/add group/i),
    fullPage: true,
  },
  {
    id: "07-06-form-builder",
    doc: "07-documents-forms.md",
    line: 160,
    anchor:
      "Screenshot of the form builder showing a form being designed with a",
    alt: "Form builder with the field palette, canvas, and field settings",
    route: "/forms",
    // "Create Form" only opens a name/category dialog; the builder this
    // placeholder describes is behind "Edit Fields" on an existing form.
    prepare: clickByName(/edit fields/i),
    // Viewport only: the builder opens over the list page, and a full-page
    // capture trails the taller page underneath it below the fold.
    fullPage: false,
  },

  // ── Fifth batch: modals from admin list pages ──────────────────────
  {
    id: "05-05-item-form-modal",
    doc: "05-inventory.md",
    line: 71,
    anchor:
      "Screenshot of the item edit modal showing form fields for name, description,",
    alt: "Inventory item form with category, serial, condition and tracking fields",
    route: "/inventory/admin/items",
    prepare: clickByName(/add item/i),
    fullPage: false,
  },
  {
    id: "05-12-new-allowance-modal",
    doc: "05-inventory.md",
    line: 288,
    anchor:
      "Screenshot of the New Allowance modal showing the Category dropdown, the 'Applies",
    alt: "New allowance modal with category, role and quantity fields",
    route: "/inventory/admin/allowances",
    prepare: clickByName(/new allowance/i),
    fullPage: false,
  },
  {
    id: "05-27-equipment-kit-modal",
    doc: "05-inventory.md",
    line: 812,
    anchor:
      "Screenshot of the Equipment Kit create/edit modal showing a kit named 'New",
    alt: "Equipment kit editor with its line items and quantities",
    route: "/inventory/admin/kits",
    prepare: clickByName(/edit new recruit ppe kit/i),
    fullPage: false,
  },
  {
    id: "02-11-pipeline-wizard",
    doc: "02-training.md",
    line: 269,
    anchor:
      "The pipeline wizard showing the program info fields (including the program code)",
    alt: "Training pipeline wizard with program details and phase list",
    route: "/training/programs",
    prepare: clickByName(/new pipeline/i),
    fullPage: true,
  },

  // ── Sixth batch: print layouts and training history ────────────────
  {
    id: "02-62-print-member-history",
    doc: "02-training.md",
    line: 1541,
    anchor:
      "Screenshot of the printed Member Training History page showing the letter-size layout",
    alt: "Print layout for a member training history",
    // The print views take their subject from the query string and render
    // "No member ID provided" without it.
    route: "/training/print/member",
    prepare: withQueryFromApi("/users?limit=1", "users", (record) => ({
      id: record.id,
      name: [record.first_name, record.last_name].filter(Boolean).join(" "),
    })),
    fullPage: true,
  },
  {
    id: "02-63-print-program",
    doc: "02-training.md",
    line: 1556,
    anchor:
      "Screenshot of the printed Training Program page showing the program header, phases",
    alt: "Print layout for a training program with phases and requirements",
    route: "/training/print/program",
    prepare: withQueryFromApi(
      "/training/programs/programs",
      "programs",
      (record) => ({ id: record.id }),
    ),
    fullPage: true,
  },
  {
    id: "02-65-print-compliance",
    doc: "02-training.md",
    line: 1573,
    anchor:
      "Screenshot of the printed Compliance Matrix page showing the landscape grid with",
    alt: "Print layout for the compliance matrix",
    route: "/training/print/compliance",
    fullPage: true,
  },
  {
    id: "02-40-member-training-history",
    doc: "02-training.md",
    line: 947,
    anchor:
      "The Member Training History page showing the export period dropdown next to",
    alt: "Member training history with the export period selector and download buttons",
    route: "/members",
    prepare: openFirstFromApi(
      "/users?limit=1",
      (id) => `/members/${id}/training`,
      "users",
    ),
    fullPage: true,
  },
  // ── Shift completion reports ───────────────────────────────────────
  //
  // `/training/shift-reports` is a redirect stub — a card that says reports are
  // filed from Shift Scheduling and offers a button through to it. The tab
  // itself lives at `/scheduling?tab=shift-reports`, and pointing these shots
  // at the training route is how 02-30 came to picture an empty "Filed (0)"
  // stub under a caption promising report cards with checkboxes.
  //
  // Only `view=drafts` is honoured as a URL parameter; the other five views are
  // reachable only by clicking their button, and Review Queue and Flagged are
  // rendered only while the department has `report_review_required` on (the
  // seeder switches it on).
  {
    id: "02-30-shift-reports",
    doc: "02-training.md",
    line: 962,
    anchor:
      "Screenshot of the Pending Review view showing report cards with checkboxes, the",
    alt: "Shift reports review queue with select-all ticked and the batch approve and flag controls showing",
    route: "/scheduling?tab=shift-reports",
    // Select-all is ticked deliberately. "Approve Selected" / "Flag Selected"
    // render only while something is selected, so an untouched queue pictures
    // the checkboxes without the controls they exist to reach.
    prepare: async (page) => {
      await clickByName(/Review Queue/i)(page);
      await page
        .getByRole("checkbox")
        .first()
        .check({ timeout: 10_000 })
        .catch(() => {});
    },
    fullPage: true,
  },
  {
    id: "02-31-shift-reports-filed",
    doc: "02-training.md",
    line: 900,
    anchor:
      "Screenshot of the Shift Reports tab showing a list of filed reports with columns",
    alt: "Filed shift reports listing trainee, date, hours, calls and rating",
    route: "/scheduling?tab=shift-reports",
    fullPage: true,
  },
  {
    id: "02-32-shift-reports-flagged",
    doc: "02-training.md",
    line: 965,
    anchor:
      "Screenshot of the Flagged tab showing previously flagged reports with a",
    alt: "A flagged shift report expanded to show the reviewer's note and the Re-Review action",
    route: "/scheduling?tab=shift-reports",
    // The flagged badge shows on the collapsed card, but the reviewer's note
    // and the Re-Review Report button the placeholder names are inside it.
    prepare: async (page) => {
      await clickByName(/Flagged/i)(page);
      await expandFirstReportCard(page);
    },
    fullPage: true,
  },
  {
    id: "02-33-shift-reports-drafts",
    doc: "02-training.md",
    line: 974,
    anchor:
      "Screenshot of the officer's Drafts view showing auto-created draft reports with",
    alt: "A draft shift report expanded to its Complete Draft action, with Submit All Drafts above",
    route: "/scheduling?tab=shift-reports&view=drafts",
    prepare: expandFirstReportCard,
    fullPage: true,
  },
  {
    id: "02-34-shift-report-analytics",
    doc: "02-training.md",
    line: 1002,
    anchor:
      "Screenshot of the officer analytics dashboard showing the summary metric cards",
    alt: "Shift report analytics with summary cards, per-trainee table and monthly hours",
    route: "/scheduling?tab=shift-reports",
    // Clipped to the card. The analytics render at the top of Filed by Me
    // rather than in a view of their own, so a full-page shot here is the same
    // picture as 02-31 with a different caption under it.
    selector: 'div:has(> h3:text("Shift Report Analytics"))',
  },
  {
    id: "02-35-shift-reports-my-reports",
    doc: "02-training.md",
    line: 978,
    anchor:
      "Screenshot of the trainee's My Reports view showing a list of approved reports",
    alt: "A trainee's own shift reports with the personal statistics card above them",
    route: "/scheduling?tab=shift-reports",
    auth: "member",
    prepare: expandFirstReportCard,
    fullPage: true,
  },
  {
    id: "02-36-shift-report-review-modal",
    doc: "02-training.md",
    line: 976,
    anchor:
      "Screenshot of the review modal showing review status options (Approve/Flag), field",
    alt: "The shift report review modal with approve and flag actions, redaction checkboxes and reviewer notes",
    route: "/scheduling?tab=shift-reports",
    prepare: async (page) => {
      await clickByName(/Review Queue/i)(page);
      await expandFirstReportCard(page);
      await clickByName(/Review Report/i)(page);
    },
    // The dialog itself, not the page — a full-page shot drops the modal
    // halfway down a scrolled backdrop. The taller window is what gets the
    // reviewer notes and the Approve/Flag buttons into the frame: the dialog
    // is `max-h-[90dvh]` with its own scrollbar, so at 900px it simply ends
    // partway down the redaction checkboxes and no element shot can reach past
    // its own box.
    viewport: { width: 1440, height: 1500 },
    selector: 'div[role="dialog"][aria-label="Review Report"] > div',
  },
  {
    id: "02-37-trainee-stats-card",
    doc: "02-training.md",
    line: 1017,
    anchor:
      "Screenshot of the trainee stats card showing total reports, hours, calls,",
    alt: "A trainee's shift progress card with reports, hours, calls and average rating",
    route: "/scheduling?tab=shift-reports",
    auth: "member",
    selector: 'div:has(> h3:text("My Shift Progress"))',
  },

  // ── Shift finalization ─────────────────────────────────────────────
  //
  // Two states of the same control, which one shift cannot show: closing a
  // shift hides its Finalize button for good. The seeder closes the *oldest*
  // crewed past shift and leaves the rest open, so the badge shot has a
  // finalized shift to find and the checklist shot still has an open one.
  {
    id: "03-45-finalize-checklist",
    doc: "03-scheduling.md",
    line: 807,
    anchor:
      "Screenshot of the pre-finalization checklist modal showing the equipment check validation status",
    alt: "The pre-finalization checklist with attendance hours, call count, pass-down notes and the Finalize Shift button",
    route: "/scheduling",
    prepare: async (page) => {
      // An engine shift specifically. Equipment-check templates resolve by
      // apparatus type, and the demo department writes its checklists for
      // engines — on a ladder or brush shift the pre-finalization modal has no
      // checklist to report on and omits its equipment row entirely.
      await openStaffedShift(
        (shift) =>
          !shift.is_finalized &&
          !shift.is_cancelled &&
          /^Engine/i.test(shift.apparatus_name || ""),
      )(page);
      await clickByName(/^Finalize$/i)(page);
    },
    fullPage: true,
  },
  {
    id: "03-46-finalized-badge",
    doc: "03-scheduling.md",
    line: 829,
    anchor:
      "Screenshot of the ShiftDetailPanel after finalization showing the green",
    alt: "A finalized shift showing the green finalized badge with its date, the Reopen link and the pass-down note",
    route: "/scheduling",
    prepare: openStaffedShift((shift) => shift.is_finalized),
    fullPage: true,
  },
  {
    id: "02-39-finalize-checklist",
    doc: "02-training.md",
    line: 927,
    anchor:
      "Screenshot of the pre-finalization checklist modal showing the equipment check validation, attendance count",
    alt: "The pre-finalization checklist with attendance hours, call count, pass-down notes and the Finalize Shift button",
    route: "/scheduling",
    prepare: async (page) => {
      // An engine shift specifically. Equipment-check templates resolve by
      // apparatus type, and the demo department writes its checklists for
      // engines — on a ladder or brush shift the pre-finalization modal has no
      // checklist to report on and omits its equipment row entirely.
      await openStaffedShift(
        (shift) =>
          !shift.is_finalized &&
          !shift.is_cancelled &&
          /^Engine/i.test(shift.apparatus_name || ""),
      )(page);
      await clickByName(/^Finalize$/i)(page);
    },
    fullPage: true,
  },
  {
    id: "02-43-finalized-badge",
    doc: "02-training.md",
    line: 929,
    anchor:
      "Screenshot of the ShiftDetailPanel after finalization showing the green",
    alt: "A finalized shift showing the green finalized badge with its date, the Reopen link and the pass-down note",
    route: "/scheduling",
    prepare: openStaffedShift((shift) => shift.is_finalized),
    fullPage: true,
  },

  // ── Seventh batch: shift detail panel ──────────────────────────────
  {
    id: "03-02-shift-detail-panel",
    doc: "03-scheduling.md",
    line: 67,
    anchor:
      "Screenshot of the Shift Detail Panel (slide-out drawer) showing shift details at",
    alt: "Shift detail panel with the crew roster and shift information",
    route: "/scheduling",
    prepare: openStaffedShift(),
    fullPage: true,
  },
  {
    id: "03-08-calls-runs-section",
    doc: "03-scheduling.md",
    line: 174,
    anchor: "Screenshot of the Calls / Runs section on the shift detail panel",
    alt: "Calls and runs logged against a shift",
    route: "/scheduling",
    prepare: openStaffedShift((shift) => (shift.call_count ?? 0) > 0),
    fullPage: true,
  },
  {
    id: "03-09-log-call-form",
    doc: "03-scheduling.md",
    line: 177,
    anchor:
      "Screenshot of the inline Log Call form expanded, showing the two-column layout:",
    alt: "Inline log call form with incident type and times",
    route: "/scheduling",
    prepare: async (page) => {
      await openStaffedShift((shift) => (shift.call_count ?? 0) > 0)(page);
      await clickByName(/log call/i)(page);
    },
    fullPage: true,
  },
  {
    id: "03-05-assignment-form",
    doc: "03-scheduling.md",
    line: 124,
    anchor:
      "Screenshot of the assignment creation form within the Shift Detail Panel, showing",
    alt: "Assignment form in the shift panel with member and position selectors",
    route: "/scheduling",
    prepare: async (page) => {
      await withQueryFromApi(
        "/scheduling/shifts?limit=100",
        "shifts",
        (shift) => ({ shift: shift.id }),
        isFutureShift,
      )(page);
      await clickByName(/^assign$/i)(page);
    },
    fullPage: true,
  },
  {
    id: "03-31-shift-edit-times",
    doc: "03-scheduling.md",
    line: 926,
    anchor:
      "Screenshot of the ShiftDetailPanel edit form showing correctly localized start and end",
    alt: "Shift edit form showing start and end times in the department timezone",
    route: "/scheduling",
    prepare: async (page) => {
      await withQueryFromApi(
        "/scheduling/shifts?limit=100",
        "shifts",
        (shift) => ({ shift: shift.id }),
        isFutureShift,
      )(page);
      await clickByName(/edit shift/i)(page);
    },
    fullPage: true,
  },
  {
    id: "08-22-screening-record-form",
    doc: "08-admin-reports.md",
    line: 865,
    anchor:
      "Screenshot of the ScreeningRecordForm showing fields for member selection, requirement dropdown, scheduled",
    alt: "Screening record form with member, requirement and result fields",
    route: "/medical-screening",
    prepare: async (page) => {
      await clickByName(/^records$/i)(page);
      await clickByName(/add record/i)(page);
    },
    fullPage: true,
  },
  {
    id: "08-31-sidebar-notification-badge",
    doc: "08-admin-reports.md",
    line: 1108,
    anchor:
      "Screenshot of the side navigation panel showing the 'Notifications' link with a",
    alt: "Sidebar navigation with the unread notification badge",
    route: "/dashboard",
    selector: "aside, nav",
  },
  {
    id: "01-07-admin-member-edit",
    doc: "01-membership.md",
    line: 195,
    anchor:
      "Screenshot of the Admin Member Edit page showing the form sections: personal",
    alt: "Admin member edit form with personal, department and access sections",
    route: "/members",
    prepare: openFirstFromApi(
      "/users?limit=1",
      (id) => `/members/admin/edit/${id}`,
      "users",
    ),
    fullPage: true,
  },
  {
    id: "01-08-member-audit-history",
    doc: "01-membership.md",
    line: 215,
    anchor:
      "Screenshot of the Member Audit History page filtered to Profile Updates",
    alt: "Member audit history filtered to profile updates, showing what changed and who changed it",
    // Filtered to Profile Updates. Unfiltered, the timeline is dominated by
    // "Member profile viewed" — which the capture tooling itself generates on
    // every run and which always outranks the seeded rank changes by recency,
    // so the picture illustrated the wrong thing entirely.
    route: "/members",
    prepare: async (page) => {
      await openFirstFromApi(
        "/users?limit=1",
        (id) => `/members/admin/history/${id}`,
        "users",
      )(page);
      await page.waitForTimeout(1200);
      await page
        .locator("#event-type-filter")
        .selectOption("profile_update", { timeout: 10_000 });
      await page.waitForTimeout(1200);
      // Opened: the collapsed row says which field changed but not to what,
      // and the section is about reading the before and after.
      await page
        .getByRole("button", { name: /expand details/i })
        .first()
        .click({ timeout: 10_000 })
        .catch(() => {});
      await page.waitForTimeout(600);
    },
    // Viewport only: the history is paginated at 50 entries and a full-page
    // capture runs past 5000px, which is unreadable in a guide. The newest
    // entries are at the top, which is what the section describes.
    fullPage: false,
  },
  {
    id: "15-06-applicant-drawer",
    doc: "15-prospective-members.md",
    line: 226,
    anchor:
      "Screenshot of the applicant detail drawer showing the overview tab with applicant",
    alt: "Applicant detail drawer with contact details and current stage",
    route: "/prospective-members",
    prepare: async (page) => {
      // Search first, then click. The board shows the newest 200 applicants,
      // so on a pipeline padded by `--bulk-prospects` these named ones are not
      // on screen at all and a bare click times out. Narrowing the list makes
      // the shot work at either size.
      const search = page.getByPlaceholder(/search applicants/i);
      if (await search.isVisible().catch(() => false)) {
        await search.fill("Rivera");
        await page.waitForTimeout(900);
      }
      await page
        .locator("[class*='cursor-pointer']")
        .filter({ hasText: /Rivera|Fields|Okafor/ })
        .first()
        .click({ timeout: 10_000 });
    },
    fullPage: true,
  },

  // ── Sixth batch: documents, forms and department messaging ─────────
  {
    id: "07-03-upload-documents",
    doc: "07-documents-forms.md",
    line: 85,
    anchor:
      "Screenshot showing the upload interface with a drag-and-drop zone, and a",
    alt: "Document upload dialog with its drag-and-drop zone",
    route: "/documents",
    prepare: clickByName(/^upload/i),
    fullPage: false,
  },
  {
    id: "07-05-form-sharing",
    doc: "07-documents-forms.md",
    line: 193,
    anchor:
      "Screenshot showing the form sharing options with the internal link, the public",
    alt: "Form sharing dialog with the public URL and its QR code",
    route: "/forms",
    prepare: async (page) => {
      // Every form has a Share button, but the public URL and QR code this
      // placeholder is about only render for a form with public access on.
      // Open them in turn until the URL field appears. ("Share link", on the
      // card itself, copies to the clipboard and opens nothing — hence the
      // anchored pattern.)
      const shares = page.getByRole("button", { name: /^Share$/ });
      const count = await shares.count();
      for (let index = 0; index < count; index += 1) {
        await shares.nth(index).click({ timeout: 10_000 });
        const url = page.locator("#share-public-url");
        const shown = await url
          .waitFor({ state: "visible", timeout: 2_000 })
          .then(() => true)
          .catch(() => false);
        if (shown) return;
        await page
          .getByRole("button", { name: /^Done$/ })
          .click({ timeout: 10_000 });
      }
      throw new Error("no form has public access enabled");
    },
    fullPage: false,
  },
  {
    id: "07-07-form-submissions",
    doc: "07-documents-forms.md",
    line: 208,
    anchor:
      "Screenshot of the form submissions table showing rows of responses with",
    alt: "Form submissions table listing responses with their timestamps",
    route: "/forms",
    prepare: async (page) => {
      await clickByName(/^submissions$/i)(page);
      const select = page.locator("#submission-form-select");
      await select.waitFor({ timeout: 10_000 });
      // Every form is listed, answered or not, and the table for an unanswered
      // one is empty. The option label carries the count, so pick from that.
      const value = await select.evaluate(
        (el) =>
          Array.from(el.options).find(
            (option) => option.value && !/\(0 submissions\)/.test(option.text),
          )?.value ?? "",
      );
      if (!value) throw new Error("no form has any submissions");
      await select.selectOption(value);
      // Rows collapse to submitter and timestamp; the answers this placeholder
      // is about are behind the disclosure.
      await page
        .getByRole("button", { name: /^Submission by / })
        .first()
        .click({ timeout: 10_000 });
    },
    fullPage: true,
  },
  {
    id: "07-10-create-rule-modal",
    doc: "07-documents-forms.md",
    line: 270,
    anchor:
      "Screenshot of the Create Rule modal showing the name field, trigger dropdown",
    alt: "Create notification rule modal with its trigger and channel fields",
    route: "/notifications",
    prepare: clickByName(/add rule/i),
    fullPage: false,
  },
  {
    id: "07-11-new-message-form",
    doc: "07-documents-forms.md",
    line: 333,
    anchor:
      "Screenshot of the New message form showing title/body, priority, audience",
    alt: "New department message form with audience and scheduling fields",
    route: "/communications/messages",
    prepare: async (page) => {
      await clickByName(/new message/i)(page);
      // The audience selector is a plain dropdown until a targeted option is
      // chosen; "By role" is what reveals the checklist the guide describes.
      await page.locator("#msg-target").selectOption("roles");
    },
    fullPage: true,
  },
  {
    id: "07-12-acknowledgment-report",
    doc: "07-documents-forms.md",
    line: 374,
    anchor:
      'Screenshot of the acknowledgment report panel showing the "Acknowledged 12/20"',
    alt: "Acknowledgment report showing who has and has not acknowledged a message",
    route: "/communications/messages",
    prepare: async (page) => {
      // Every message row carries the report button, but only a message that
      // requires acknowledgment renders the "Acknowledged n/m" line this
      // placeholder is about. Open them in turn until one does.
      const buttons = page.getByRole("button", {
        name: "View acknowledgments",
      });
      const count = await buttons.count();
      for (let index = 0; index < count; index += 1) {
        await buttons.nth(index).click({ timeout: 10_000 });
        const acknowledged = page.getByText(/Acknowledged:/).first();
        const shown = await acknowledged
          .waitFor({ state: "visible", timeout: 3_000 })
          .then(() => true)
          .catch(() => false);
        if (shown) return;
        // Clicking the same button again collapses the panel.
        await buttons.nth(index).click({ timeout: 10_000 });
      }
      throw new Error("no message requires acknowledgment");
    },
    fullPage: true,
  },

  // ── Seventh batch: apparatus labels, badges and EVOC ────────────────
  {
    id: "06-02-apparatus-label-print",
    doc: "06-apparatus-facilities.md",
    line: 56,
    anchor:
      'Screenshot of the apparatus list with the per-row "Print label" printer icon',
    alt: "Apparatus label print page with size presets and a barcode preview",
    route: "/apparatus/print-labels",
    prepare: async (page) => {
      await withIdsFromApi("/apparatus?limit=6", "apparatus")(page);
      // Size presets live behind Settings, which starts collapsed.
      await clickByName(/^settings$/i)(page);
    },
    fullPage: true,
  },
  {
    id: "06-08-facility-label-print",
    doc: "06-apparatus-facilities.md",
    line: 177,
    anchor:
      'Screenshot of the Facilities header showing the "Print Labels" button next to',
    alt: "Facility label print page previewing station barcode labels",
    route: "/facilities/print-labels",
    prepare: async (page) => {
      await withIdsFromApi("/facilities?limit=6", "facilities")(page);
      // Size presets live behind Settings, which starts collapsed.
      await clickByName(/^settings$/i)(page);
    },
    fullPage: true,
  },
  {
    id: "06-20-apparatus-badges",
    doc: "06-apparatus-facilities.md",
    line: 637,
    anchor:
      "Screenshot of the apparatus list showing apparatus cards with correct icon",
    alt: "Apparatus list with type icons and status badges rendering correctly",
    route: "/apparatus",
    fullPage: true,
  },
  {
    id: "06-21-apparatus-evoc-level",
    doc: "06-apparatus-facilities.md",
    line: 650,
    anchor:
      'Screenshot of the apparatus edit form showing the "Required EVOC Level" dropdown',
    alt: "Apparatus edit form with the required EVOC level field",
    route: "/apparatus",
    prepare: async (page) => {
      await openFirstFromApi(
        "/apparatus?limit=20",
        (id) => `/apparatus/${id}/edit`,
        "apparatus",
      )(page);
      // The dropdown only renders once EVOC levels are defined, and it defaults
      // to none — the guide pictures it set.
      const evoc = page.locator('select[name="requiredEvocLevelId"]');
      await evoc.waitFor({ timeout: 10_000 });
      // Options read "Level 2 — Intermediate" and their values are seeded ids,
      // so match on the visible text rather than naming either.
      const value = await evoc.evaluate(
        (el) =>
          Array.from(el.options).find((option) =>
            /intermediate/i.test(option.text),
          )?.value ?? "",
      );
      if (!value) throw new Error("no Intermediate EVOC level defined");
      await evoc.selectOption(value);
    },
    fullPage: true,
  },

  // ── Eighth batch: personal data rights ─────────────────────────────
  {
    id: "17-02-download-my-data",
    doc: "17-privacy-data-rights.md",
    line: 78,
    anchor:
      'Screenshot of the "Your Data" section showing the "Download my data" button',
    alt: "The Your Data section of account security with its export button",
    route: "/account?tab=security",
    // The section sits at the foot of a long tab; clip to it rather than
    // shooting the whole page for one button.
    selector: 'div:has(> h2:text-is("Your Data"))',
  },
  {
    id: "12-08-application-activity-log",
    doc: "12-grants-fundraising.md",
    line: 268,
    anchor: "Screenshot of the Activity tab showing a timeline of events",
    alt: "Grant application activity log with its timeline of status changes and notes",
    route: "/grants/applications",
    prepare: async (page) => {
      // Every application has the auto-generated "created with status" entry;
      // only the seeded one has a timeline. The list response carries no note
      // count, so ask each application's notes endpoint.
      const id = await page.evaluate(async () => {
        const response = await fetch("/api/v1/grants/applications?limit=20", {
          credentials: "include",
        });
        if (!response.ok) return null;
        const body = await response.json();
        const applications = Array.isArray(body)
          ? body
          : body.applications || body.items || [];
        for (const application of applications) {
          const notes = await fetch(
            `/api/v1/grants/applications/${application.id}/notes`,
            { credentials: "include" },
          );
          if (!notes.ok) continue;
          const list = await notes.json();
          if ((Array.isArray(list) ? list : list.notes || []).length > 2) {
            return application.id;
          }
        }
        return null;
      });
      if (!id) throw new Error("no application has an activity timeline");
      await page.goto(
        new URL(`/grants/applications/${id}`, page.url()).toString(),
        { waitUntil: "domcontentloaded" },
      );
      await clickByName(/activity log/i)(page);
    },
    fullPage: true,
  },
  {
    id: "18-04-my-orders-unpaid",
    doc: "18-storefront.md",
    line: 467,
    anchor: "Screenshot of My Orders showing an unpaid order",
    alt: "My Orders showing an unpaid order with its balance and payment options",
    route: "/store/orders",
    fullPage: true,
  },
  {
    id: "11-12-purchase-request-detail",
    doc: "11-finance.md",
    line: 519,
    anchor: "A Purchase Request Detail page showing the request header",
    alt: "Purchase request detail with its status and approval chain",
    route: "/finance/purchase-requests",
    // A draft has no approval chain to picture, so open one that was submitted.
    prepare: openFirstFromApi(
      "/finance/purchase-requests",
      (id) => `/finance/purchase-requests/${id}`,
      "purchase_requests",
      (request) => (request.status ?? request.Status) !== "draft",
    ),
    fullPage: true,
  },
  {
    id: "11-14-expense-report-detail",
    doc: "11-finance.md",
    line: 645,
    anchor: "An Expense Report Detail page showing the report header",
    alt: "Expense report detail with its line items and approval status",
    route: "/finance/expenses",
    prepare: openFirstFromApi(
      "/finance/expense-reports",
      (id) => `/finance/expenses/${id}`,
      "expense_reports",
      (report) => (report.status ?? "") !== "draft",
    ),
    fullPage: true,
  },
  {
    id: "11-16-check-request-detail",
    doc: "11-finance.md",
    line: 743,
    anchor: "A Check Request Detail page showing the request header",
    alt: "Check request detail with payee, amount and approval status",
    route: "/finance/check-requests",
    prepare: openFirstFromApi(
      "/finance/check-requests",
      (id) => `/finance/check-requests/${id}`,
      "check_requests",
      (request) => (request.status ?? "") !== "draft",
    ),
    fullPage: true,
  },

  // ── Ninth batch: elections workflow tabs ───────────────────────────
  {
    id: "14-04-ballot-configuration",
    doc: "14-elections.md",
    line: 115,
    anchor:
      "Screenshot of the ballot item configuration showing a position field",
    alt: "Ballot item configuration with its position and candidate settings",
    route: "/elections",
    prepare: async (page) => {
      await openElectionTab("ballot", isNominatingElection)(page);
      // Items render collapsed; the position, candidate list and write-in
      // toggle the placeholder names are inside one. The disclosure is an
      // icon-only button labelled "Expand" — the item's title is not clickable.
      await page
        .getByRole("button", { name: "Expand" })
        .first()
        .click({ timeout: 10_000 });
    },
    fullPage: true,
    // The Results & Publishing panel sits above every tab and reads "No votes
    // cast yet" — accurate for an election still taking nominations, and
    // nothing to do with the tab this shot is of.
    allowEmptyState: true,
  },
  {
    id: "14-05-nominations-tab",
    doc: "14-elections.md",
    line: 152,
    anchor: "Screenshot of the Nominations tab showing the",
    alt: "Nominations tab with the nominate form and current nominations",
    route: "/elections",
    prepare: openElectionTab("nominations", isNominatingElection),
    fullPage: true,
    // The Results & Publishing panel sits above every tab and reads "No votes
    // cast yet" — accurate for an election still taking nominations, and
    // nothing to do with the tab this shot is of.
    allowEmptyState: true,
  },
  {
    id: "14-06-candidate-form",
    doc: "14-elections.md",
    line: 178,
    anchor:
      "Screenshot of the candidate nomination form showing member dropdown",
    alt: "Candidate nomination form with member, position and statement fields",
    route: "/elections",
    prepare: async (page) => {
      await openElectionTab("candidates", isNominatingElection)(page);
      await clickByName(/add candidate/i)(page);
    },
    // The tab lists candidates; the *form* the placeholder names is behind
    // "Add Candidate". It renders inline rather than as a modal, part-way down
    // a long page, so clip to the card instead of shooting the viewport.
    selector: 'div:has(> h4:text-is("Add New Candidate"))',
  },
  {
    id: "14-07-eligibility-roster",
    doc: "14-elections.md",
    line: 210,
    anchor: "Screenshot of the Eligibility Roster showing a table of members",
    alt: "Eligibility roster listing members with their eligibility status",
    route: "/elections",
    prepare: async (page) => {
      await openElectionTab("eligibility", isNominatingElection)(page);
      await clickByName(/voter eligibility roster/i)(page);
    },
    fullPage: true,
    allowEmptyState: true,
  },

  // ── Tenth batch: the applicant pipeline ────────────────────────────
  {
    id: "15-02-pipeline-builder",
    doc: "15-prospective-members.md",
    line: 68,
    anchor:
      "Screenshot of the Pipeline Builder showing stages in a vertical list",
    alt: "Pipeline builder listing the stages with their drag handles and types",
    route: "/prospective-members/settings",
    // Renders inline on the settings page, well below the fold; clip to the
    // card rather than shooting the whole page of unrelated configuration.
    prepare: async (page) => {
      await openPipelineSettings()(page);
      await page
        .getByText("Pipeline Stages", { exact: true })
        .first()
        .scrollIntoViewIfNeeded({ timeout: 10_000 });
    },
    selector: 'div:has(> h3:has-text("Pipeline Stages"))',
  },
  {
    id: "15-04-kanban-board",
    doc: "15-prospective-members.md",
    line: 227,
    anchor: "Screenshot of the kanban board showing 4-5 columns",
    alt: "Kanban board with a column per pipeline stage and applicant cards",
    route: "/prospective-members",
    fullPage: true,
  },
  {
    id: "15-12-pipeline-stats",
    doc: "15-prospective-members.md",
    line: 554,
    anchor: "Screenshot of the pipeline statistics cards showing Total Active",
    alt: "Pipeline statistics cards across the top of the applicant board",
    route: "/prospective-members",
    selector: '.grid:has(> div:has-text("Total Active"))',
  },
  {
    id: "15-11-table-bulk-actions",
    doc: "15-prospective-members.md",
    line: 476,
    anchor: "Screenshot of the pipeline table view with 3 applicants checked",
    alt: "Pipeline table with applicants selected and the bulk action bar",
    route: "/prospective-members",
    prepare: async (page) => {
      await clickByName(/^table$/i)(page);
      // The bulk action bar only appears once rows are selected. Row selection
      // is an icon-only button in the first cell, not an <input type=checkbox>.
      const boxes = page.locator("tbody tr td:first-child button");
      await boxes.first().waitFor({ timeout: 10_000 });
      const count = Math.min(3, await boxes.count());
      for (let index = 0; index < count; index += 1) {
        await boxes.nth(index).click({ timeout: 10_000 });
      }
    },
    fullPage: true,
  },
  {
    id: "15-07-interview-form",
    doc: "15-prospective-members.md",
    line: 337,
    anchor:
      "Screenshot of the Interview form showing the Your Role / Title field",
    alt: "Interview form with its scheduling, interviewer and recommendation fields",
    route: "/prospective-members",
    // The collection is /prospects with limit/offset — /applicants does not
    // exist, whatever the route naming suggests.
    prepare: async (page) => {
      await openFirstFromApi(
        "/prospective-members/prospects?limit=20",
        (id) => `/prospective-members/${id}/interview`,
        "items",
      )(page);
      // The page lists past interviews; the form is behind "New Interview".
      await clickByName(/new interview/i)(page);
    },
    fullPage: true,
    // "No interviews recorded yet" sits under the form — true of an applicant
    // whose first interview is being written, and not what this pictures.
    allowEmptyState: true,
  },
  {
    id: "15-05-applicant-actions",
    doc: "15-prospective-members.md",
    line: 209,
    anchor:
      "Screenshot of the applicant detail drawer showing the action buttons",
    alt: "Applicant drawer action bar with the stage-movement buttons",
    route: "/prospective-members",
    prepare: openApplicantDrawer("Sam Okafor"),
    fullPage: true,
    allowEmptyState: true,
  },
  {
    id: "15-08-election-package",
    doc: "15-prospective-members.md",
    line: 360,
    anchor:
      "Screenshot of the Election Package section in the applicant detail drawer",
    alt: "Election package section showing the package status for an applicant at the vote",
    route: "/prospective-members",
    // The section renders only for an applicant on an election_vote stage —
    // "Membership Vote" in the seeded pipeline.
    prepare: openApplicantDrawer("Morgan Tran"),
    fullPage: true,
    allowEmptyState: true,
  },
  {
    id: "15-09-convert-modal",
    doc: "15-prospective-members.md",
    line: 389,
    anchor:
      "Screenshot of the Convert to Member modal showing membership type selector",
    alt: "Convert to member modal with membership type, ID and rank fields",
    route: "/prospective-members",
    prepare: async (page) => {
      // Conversion is not its own button: Advance on the *last* stage opens
      // the modal. Riley Bishop sits on Onboarding, the final stage.
      await openApplicantDrawer("Riley Bishop")(page);
      await clickByName(/convert/i)(page);
      // The modal opens on step 1 of 2 (Review Applicant); the membership
      // type, ID, rank and start date the placeholder names are on step 2.
      await clickByName(/^continue$/i)(page);
    },
    fullPage: false,
    allowEmptyState: true,
  },
  {
    id: "15-13-application-status",
    doc: "15-prospective-members.md",
    line: 575,
    anchor:
      "Screenshot of the public application status page showing the applicant name",
    alt: "Public application status page showing an applicant's progress through the pipeline",
    route: "/prospective-members",
    prepare: async (page) => {
      // The status link is addressed by a per-applicant token, and the token
      // is only on the prospect *detail* response — the list omits it.
      const token = await page.evaluate(async () => {
        const list = await fetch(
          "/api/v1/prospective-members/prospects?limit=20",
          { credentials: "include" },
        );
        if (!list.ok) return "";
        const body = await list.json();
        for (const row of body.items || []) {
          const detail = await fetch(
            `/api/v1/prospective-members/prospects/${row.id}`,
            { credentials: "include" },
          );
          if (!detail.ok) continue;
          const record = await detail.json();
          if (record.status_token) return record.status_token;
        }
        return "";
      });
      if (!token) throw new Error("no applicant carries a status token");
      await page.goto(
        new URL(`/application-status/${token}`, page.url()).toString(),
        {
          waitUntil: "domcontentloaded",
        },
      );
    },
    fullPage: true,
  },
  {
    id: "09-04-template-builder",
    doc: "09-skills-testing.md",
    line: 111,
    anchor: "Screenshot of the template builder showing two sections",
    alt: "Skill template builder with its sections and scored criteria",
    route: "/training/skills-testing",
    prepare: openFirstFromApi(
      "/training/skills-testing/templates?limit=20",
      (id) => `/training/skills-testing/templates/${id}/edit`,
      "templates",
    ),
    fullPage: true,
  },
  {
    id: "09-06-new-test-form",
    doc: "09-skills-testing.md",
    line: 249,
    anchor: "Screenshot of the New Test form showing a template dropdown",
    alt: "Start skill test form with its template and candidate fields",
    route: "/training/skills-testing/test/new",
    fullPage: true,
  },
  {
    id: "09-09-test-records",
    doc: "09-skills-testing.md",
    line: 511,
    anchor:
      "Screenshot of the Skills Tests list page showing a table of test sessions",
    alt: "Skills test records listing sessions with candidate, template and status",
    route: "/training/admin?page=skills-testing&tab=tests",
    fullPage: true,
  },
  {
    id: "09-14-test-records-statuses",
    doc: "09-skills-testing.md",
    line: 304,
    anchor: "The officer's Test Records tab showing a mix of rows",
    alt: "Test records showing unfinished, completed and cancelled rows side by side",
    // The three states only read differently when all three are present. The
    // seeder cancels one unfinished test for exactly this shot.
    route: "/training/admin?page=skills-testing&tab=tests",
    fullPage: true,
  },
  {
    id: "09-16-active-scoring-screen",
    doc: "09-skills-testing.md",
    line: 344,
    anchor: "The active scoring screen mid-test, showing the",
    alt: "The scoring screen partway through a test, with section chips, the scored count and a mix of scored and unscored steps",
    // A test stopped partway through — the seeder makes exactly one. An
    // untouched test shows three outstanding chips and a fresh one shows none
    // scored, and neither is the screen this section describes.
    route: "/training/skills-testing",
    prepare: openFirstFromApi(
      "/training/skills-testing/tests?limit=50",
      (id) => `/training/skills-testing/test/${id}/active`,
      "tests",
      (test) => test.status === "in_progress",
    ),
    fullPage: false,
  },
  {
    id: "09-15-scorecard-breakdown",
    doc: "09-skills-testing.md",
    line: 418,
    anchor: "The score breakdown panel at the top of a completed",
    alt: "A completed scorecard's score breakdown, with per-section totals and the passing threshold",
    route: "/training/skills-testing",
    // Specifically the weighted sheet. A pass/fail template carries no point
    // pool, so any other completed test shows "no percentage could be
    // calculated" and every section marked as not counting — a true screen,
    // but not the breakdown this placeholder describes.
    prepare: openFirstFromApi(
      "/training/skills-testing/tests?limit=50",
      (id) => `/training/skills-testing/test/${id}`,
      "tests",
      (test) =>
        test.status === "completed" &&
        (test.overallScore ?? test.overall_score ?? null) !== null,
    ),
    // Viewport rather than full page: the scorecard's "Back to Tests" bar is
    // sticky, and a full-page shot paints it across the middle of the sheet,
    // over the very section rows this placeholder is about.
    viewport: { width: 1440, height: 1000 },
    fullPage: false,
  },
  {
    id: "16-04-documenso-connect",
    doc: "16-integrations.md",
    line: 176,
    anchor: "Screenshot of the Documenso connect dialog showing the API Token",
    alt: "Documenso connect dialog with its API token and webhook fields",
    route: "/integrations",
    prepare: openIntegrationConnect("Documenso"),
    fullPage: false,
  },
  {
    id: "16-06-paypal-connect",
    doc: "16-integrations.md",
    line: 283,
    anchor:
      "Screenshot of the PayPal connect dialog showing the Environment dropdown",
    alt: "PayPal connect dialog with environment and credential fields",
    route: "/integrations",
    prepare: openIntegrationConnect("PayPal"),
    fullPage: false,
  },
  {
    id: "16-02-slack-connect",
    doc: "16-integrations.md",
    line: 89,
    anchor:
      "Screenshot of an integration connection dialog (e.g., Slack) showing the webhook URL",
    alt: "Slack connect dialog with its webhook URL field",
    route: "/integrations",
    prepare: openIntegrationConnect("Slack"),
    fullPage: false,
  },
  {
    id: "03-34-calendar-subscribe",
    doc: "03-scheduling.md",
    line: 1617,
    anchor: 'The "Subscribe to my shifts" card on My Shifts',
    alt: "Subscribe to my shifts card showing the calendar feed URL and its controls",
    route: "/scheduling?tab=my-shifts",
    // The card is collapsed until the member asks for the link, which is
    // deliberate: it holds a token that grants read access to their roster.
    prepare: clickByName(/subscribe to my shifts/i),
    fullPage: true,
  },
  {
    id: "13-06-expiring-screenings",
    doc: "13-medical-screening.md",
    line: 327,
    anchor: "The expiring screenings section of the Compliance tab",
    alt: "Compliance tab listing screenings approaching expiry with urgency badges",
    route: "/medical-screening",
    prepare: clickByName(/^compliance$/i),
    fullPage: true,
  },
  {
    id: "04-08-calendar-view",
    doc: "04-events-meetings.md",
    line: 218,
    anchor: "Screenshot of the CalendarView component showing a monthly grid",
    alt: "Events calendar month grid with events marked on their days",
    route: "/events",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "Calendar view" })
        .first()
        .click({ timeout: 10_000 });
    },
    fullPage: true,
  },
  {
    id: "04-09-rsvp-modal",
    doc: "04-events-meetings.md",
    line: 284,
    anchor:
      "Screenshot of the RSVP form showing the dietary restrictions text field",
    alt: "RSVP modal with its dietary and accessibility fields",
    route: "/events",
    prepare: async (page) => {
      // Open for RSVPs, not merely upcoming — see isRsvpOpen.
      await openFirstFromApi(
        "/events?limit=100",
        (id) => `/events/${id}`,
        "events",
        isRsvpOpen,
      )(page);
      await clickByName(/rsvp now|update rsvp/i)(page);
    },
    fullPage: false,
  },
  {
    id: "02-66-compliance-matrix",
    doc: "02-training.md",
    line: 591,
    anchor:
      "Screenshot of the Compliance Matrix showing a grid with member names on rows",
    alt: "Compliance matrix grid of members against requirements",
    route: "/training/admin?page=dashboard&tab=compliance",
    fullPage: true,
  },
  {
    id: "02-67-competency-matrix",
    doc: "02-training.md",
    line: 1156,
    anchor:
      "Screenshot of the Competency Matrix showing a heat-map grid with member names",
    alt: "Competency matrices listing the department's readiness definitions",
    route: "/training/admin?page=enhancements&tab=competency",
    fullPage: true,
    holdBack:
      "the tab lists matrix definitions per position, not the member-by-competency " +
      "heat-map with a station/rank filter bar the placeholder describes — and its " +
      "legend is the Dreyfus scale, not the green/yellow/red mapping in the prose",
  },
  {
    id: "02-68-recertification-pathways",
    doc: "02-training.md",
    line: 1182,
    anchor:
      "Screenshot of the Recertification Pathways configuration page showing a list",
    alt: "Recertification pathways with renewal type, window and grace period",
    route: "/training/admin?page=enhancements&tab=recertification",
    fullPage: true,
  },
  {
    id: "02-69-instructor-qualifications",
    doc: "02-training.md",
    line: 1224,
    anchor:
      "Screenshot of the Instructor Qualifications page showing a table of instructors",
    alt: "Instructor qualification roster with type, agency and expiry",
    route: "/training/admin?page=enhancements&tab=instructors",
    fullPage: true,
  },
  {
    id: "02-70-effectiveness-evaluations",
    doc: "02-training.md",
    line: 1258,
    anchor:
      "Screenshot of the Effectiveness Evaluation form showing fields for training session",
    alt: "Training effectiveness evaluations across the four Kirkpatrick levels",
    route: "/training/admin?page=enhancements&tab=effectiveness",
    fullPage: true,
  },
  {
    id: "02-71-multi-agency-training",
    doc: "02-training.md",
    line: 1288,
    anchor:
      "Screenshot of the Multi-Agency Training page showing a list of joint training",
    alt: "Multi-agency exercises with participating departments and headcounts",
    route: "/training/admin?page=enhancements&tab=multi-agency",
    fullPage: true,
  },
  {
    id: "02-72-iso-readiness",
    doc: "02-training.md",
    line: 1346,
    anchor:
      "Screenshot of the ISO Readiness dashboard showing an overall readiness percentage",
    alt: "ISO readiness dashboard broken down by NFPA training category",
    route: "/training/admin?page=compliance&tab=iso-readiness",
    fullPage: true,
  },
  {
    id: "02-73-compliance-attestations",
    doc: "02-training.md",
    line: 1353,
    anchor:
      "Screenshot of the Compliance Attestations page showing a table of submitted",
    alt: "Compliance attestations listing period, percentage and attesting officer",
    route: "/training/admin?page=compliance&tab=attestations",
    fullPage: true,
  },
  {
    id: "02-74-annual-compliance-report",
    doc: "02-training.md",
    line: 1368,
    anchor:
      "Screenshot of the Annual Compliance Report page showing summary statistics",
    alt: "Annual compliance report with department-wide summary statistics",
    route: "/training/admin?page=compliance&tab=annual-report",
    fullPage: true,
  },
  {
    id: "02-75-compliance-forecast",
    doc: "02-training.md",
    line: 1380,
    anchor:
      "Screenshot of the Compliance Forecast view showing a line chart projecting",
    alt: "Compliance forecast projecting each member's compliance over 90 days",
    route: "/training/admin?page=compliance&tab=forecast",
    fullPage: true,
  },
  {
    id: "01-11-create-waiver",
    doc: "01-membership.md",
    line: 573,
    anchor:
      "Screenshot of the Add Leave of Absence modal showing the member dropdown",
    alt: "Create waiver form with the member, type and date fields",
    route: "/members/admin/waivers",
    prepare: clickByName(/^Create Waiver$/),
    fullPage: true,
  },
  {
    id: "04-10-event-attendance",
    doc: "04-events-meetings.md",
    line: 315,
    anchor:
      "Screenshot of the EventRSVPSection on an event detail page showing the attendee list",
    alt: "Event attendance list with each member's RSVP and check-in state",
    route: "/events",
    prepare: openFirstFromApi(
      "/events?limit=100",
      (id) => `/events/${id}`,
      "events",
      isRsvpOpen,
    ),
    fullPage: true,
  },
  {
    id: "09-12-template-linked-requirement",
    doc: "09-skills-testing.md",
    line: 145,
    anchor:
      'The Create/Edit Template form showing the "Linked Training Requirement" dropdown',
    alt: "Template builder with its linked training requirement field",
    route: "/training/skills-testing/templates/new",
    prepare: async (page) => {
      // Pick a real requirement — the field defaults to "None", which is not
      // what the placeholder asks to show.
      const select = page
        .locator("select")
        .filter({ hasText: /not linked/ })
        .first();
      const value = await select
        .locator("option")
        .nth(1)
        .getAttribute("value")
        .catch(() => null);
      if (value) await select.selectOption(value);
    },
    // Not fullPage: the form's action bar is sticky, and a full-page render
    // draws it partway down the page, slicing through the fields underneath.
    fullPage: false,
  },
  {
    id: "04-12-linked-elections",
    doc: "04-events-meetings.md",
    line: 1184,
    anchor:
      'Screenshot of an event detail page showing a "Linked Elections" section',
    alt: "Linked elections card on the event the vote is held at",
    route: "/events",
    prepare: async (page) => {
      // The card renders only when an election points at the event, so the
      // event has to be discovered from the election rather than the other
      // way round.
      const eventId = await page.evaluate(async () => {
        const response = await fetch("/api/v1/elections?limit=20", {
          credentials: "include",
        });
        if (!response.ok) return null;
        const body = await response.json();
        const rows = Array.isArray(body) ? body : body.elections || [];
        for (const row of rows) {
          const detail = await fetch(`/api/v1/elections/${row.id}`, {
            credentials: "include",
          });
          if (!detail.ok) continue;
          const election = await detail.json();
          if (election.event_id) return election.event_id;
        }
        return null;
      });
      if (!eventId) throw new Error("no election is linked to an event");
      await page.goto(`${new URL(page.url()).origin}/events/${eventId}`, {
        waitUntil: "domcontentloaded",
      });
    },
    selector: 'div.bg-theme-surface:has(> h2:has-text("Linked Elections"))',
  },
  {
    id: "04-11-event-notifications",
    doc: "04-events-meetings.md",
    line: 346,
    anchor:
      "Screenshot of the EventNotificationPanel showing the notification type dropdown",
    alt: "Event notification panel with its type and audience controls",
    route: "/events",
    prepare: openFirstFromApi(
      "/events?limit=100",
      (id) => `/events/${id}`,
      "events",
      isRsvpOpen,
    ),
    // Clipped: the panel sits below a 21-row attendance list, which 04-10
    // already pictures in full.
    selector: 'div.bg-theme-surface:has(> h2:has-text("Notifications"))',
  },
  {
    id: "08-36-template-search",
    doc: "08-admin-reports.md",
    line: 1336,
    anchor:
      'Screenshot of the template list sidebar showing the search field with "welcome" typed',
    alt: "Email template sidebar filtered to templates matching welcome",
    route: "/communications/email-templates",
    prepare: async (page) => {
      await page
        .getByPlaceholder(/filter templates/i)
        .first()
        .fill("welcome", { timeout: 10_000 });
    },
    fullPage: true,
  },
  {
    id: "08-37-email-officers",
    doc: "08-admin-reports.md",
    line: 1437,
    anchor:
      "Screenshot of the Officers tab showing the office list with holders",
    alt: "Officers tab listing each office and the member holding it",
    route: "/communications/email-templates",
    prepare: clickByName(/^Officers$/),
    fullPage: true,
  },
  {
    id: "08-38-email-configuration",
    doc: "08-admin-reports.md",
    line: 1479,
    anchor:
      "Screenshot of the Email Configuration page showing the Cloudflare platform",
    alt: "Email configuration with the sending platform and credentials",
    route: "/settings?tab=email",
    // The credential fields are per-platform and the demo org has none set, so
    // the page opens on "Other / None" with nothing below it. Selecting
    // Cloudflare reveals the fields the placeholder names; it is local state
    // until Save, so nothing is written.
    prepare: clickByName(/^Cloudflare$/),
    fullPage: true,
  },
  {
    id: "05-52-item-maintenance",
    doc: "05-inventory.md",
    line: 566,
    anchor:
      "Screenshot of the maintenance section on an item detail page, showing past",
    alt: "Item inspections tab listing its service history",
    route: "/inventory/items",
    prepare: async (page) => {
      // The Inspections tab only exists for a category that tracks
      // maintenance, so pick a Structural PPE item rather than the first one.
      await openFirstFromApi(
        "/inventory/items?limit=200",
        (id) => `/inventory/items/${id}`,
        "items",
        (item) => (item.name || "").startsWith("Bunker Coat"),
      )(page);
      await clickByName(/^Inspections$/)(page);
    },
    fullPage: true,
  },
  {
    id: "05-51-label-print-settings",
    doc: "05-inventory.md",
    line: 531,
    anchor:
      "Screenshot of the barcode print page Settings panel showing the Label Size grid",
    alt: "Label print settings with the size presets and content options",
    route: "/inventory/print-labels",
    prepare: async (page) => {
      await withIdsFromApi("/inventory/items?limit=6", "items")(page);
      await clickByName(/^Settings$/)(page);
    },
    fullPage: true,
  },
  {
    id: "05-50-equipment-kit-detail",
    doc: "05-inventory.md",
    line: 178,
    anchor: "Screenshot of the Equipment Kit detail view showing the kit name",
    alt: "Equipment kit detail listing its component items",
    route: "/inventory/admin/kits",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^View New Recruit PPE Kit$/ })
        .first()
        .click({ timeout: 10_000 });
    },
    fullPage: false,
  },
  {
    id: "05-49-variant-stock-matrix",
    doc: "05-inventory.md",
    line: 1440,
    anchor:
      "Screenshot of the Variant Groups page showing a variant group expanded",
    alt: "Variant group stock matrix of quantities by size and colour",
    route: "/inventory/admin/variant-groups",
    prepare: async (page) => {
      // The Department Polo has both sizes and colours, so its matrix is a
      // grid rather than a single row — the Structural Coat has sizes only.
      await page
        .getByRole("button", { name: /^View Department Polo$/ })
        .first()
        .click({ timeout: 10_000 });
    },
    fullPage: false,
  },
  {
    id: "05-48-storage-area-items",
    doc: "05-inventory.md",
    line: 1386,
    anchor:
      "Screenshot of the Storage Areas page with one area expanded showing",
    alt: "Storage area expanded to show the items stored in it",
    route: "/inventory/storage-areas",
    prepare: async (page) => {
      await selectStorageRoom(page);
      // The count is the control: clicking it opens the inline items panel.
      // Its accessible name carries the count, so a "Show N items in …" match
      // also guarantees the area picked is not empty.
      await page
        .getByRole("button", { name: /^Show \d+ items? in / })
        .first()
        .click({ timeout: 10_000 });
    },
    fullPage: true,
  },
  {
    id: "05-47-items-filter-bar",
    doc: "05-inventory.md",
    line: 1454,
    anchor:
      "Screenshot of the Items List filter bar showing the three new dropdown filters",
    alt: "Items list filter bar with the size, colour and style dropdowns",
    route: "/inventory/items",
    // Clipped to the filter card. The placeholder asks for the Size dropdown
    // open; a native <select> popup is drawn by the OS outside the page, so
    // Playwright cannot capture it — the closed row is what there is to show.
    selector: 'div.card-secondary:has(select[aria-label="Filter by size"])',
  },
  {
    id: "05-46-size-preferences",
    doc: "05-inventory.md",
    line: 216,
    anchor:
      'Screenshot of the Size Preferences modal titled "Sizes — Jane Doe"',
    alt: "Size preferences modal for one member",
    route: "/inventory/admin/members",
    prepare: clickByName(/^Sizes$/),
    fullPage: false,
  },
  {
    id: "08-32-module-management",
    doc: "08-admin-reports.md",
    line: 142,
    anchor:
      "Screenshot of the Module Management section showing the three categories",
    alt: "Module management with a toggle for each optional feature",
    route: "/settings?tab=modules",
    fullPage: true,
  },
  {
    id: "08-33-notifications-inbox",
    doc: "08-admin-reports.md",
    line: 1209,
    anchor:
      'Screenshot of the Notifications inbox page showing the "Mark All Read" button',
    alt: "Notifications inbox with the mark-all-as-read action",
    route: "/notifications?tab=inbox",
    // Unread only. "Show read" is on by default, and the demo database still
    // holds notifications written before the position-label fix, whose bodies
    // name the enum rather than the position. Publishing those would put a
    // fixed bug into the guide.
    prepare: async (page) => {
      await page
        .getByLabel(/show read/i)
        .first()
        .uncheck({ timeout: 10_000 });
    },
    fullPage: true,
  },
  {
    id: "08-35-notifications-show-read",
    doc: "08-admin-reports.md",
    line: 1219,
    anchor:
      'Screenshot of the Notifications inbox showing the "Show read" toggle',
    alt: "Notifications inbox with read notifications revealed",
    route: "/notifications?tab=inbox",
    prepare: async (page) => {
      await page
        .getByLabel(/show read/i)
        .first()
        .check({ timeout: 10_000 });
    },
    fullPage: true,
    holdBack:
      "revealing read notifications surfaces the ones this demo database " +
      "recorded before the position-label fix, whose bodies read " +
      "'ShiftPosition.FIREFIGHTER position'; capturable on a fresh seed",
  },
  {
    id: "08-34-email-templates",
    doc: "08-admin-reports.md",
    line: 1383,
    anchor:
      "Screenshot of the Email Templates sidebar showing seven collapsible category",
    alt: "Email template categories in the editor sidebar",
    route: "/communications/email-templates",
    fullPage: true,
  },
  {
    id: "03-44-month-calendar",
    doc: "03-scheduling.md",
    line: 65,
    anchor:
      "Screenshot of the month calendar view showing several shifts across different days",
    alt: "Month calendar of shifts with the week and month view toggle",
    route: "/scheduling",
    prepare: clickByName(/^Month$/),
    fullPage: true,
  },
  {
    id: "03-43-time-off-request-form",
    doc: "03-scheduling.md",
    line: 199,
    anchor:
      "Screenshot of the time-off request form showing start date, end date",
    alt: "Time-off request modal with its date range and reason",
    route: "/scheduling?tab=my-shifts",
    prepare: clickByName(/^Request Time Off$/),
    fullPage: false,
  },
];
