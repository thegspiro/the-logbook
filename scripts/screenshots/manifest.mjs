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
 *   beforeNavigate optional async (page) hook for installing a route mock
 *            before the page mounts; reserve this for provider configuration
 *            that cannot contain real credentials in the demo database
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
  username: process.env.SCREENSHOT_ADMIN_USERNAME || "chief",
  password: process.env.SCREENSHOT_ADMIN_PASSWORD,
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
 * The department secretary: holds `legal.propose`, and neither `legal.publish`
 * nor `settings.manage`.
 *
 * Shots marked `auth: "secretary"` sign in as this account. It exists for the
 * middle rung of the legal-documents permission table, which no other demo
 * account can photograph — the administrator can publish and an ordinary
 * member cannot reach the screen at all, so the state the guide describes
 * (the editor open, the Publish control absent) is only reachable from here.
 *
 * Must match LEGAL_PROPOSER_USERNAME in seed_demo_data.py, whose
 * `_ensure_legal_proposer` guarantees the role rather than leaving it to
 * arrive as a side effect of the election seeding.
 */
export const DEMO_SECRETARY_CREDENTIALS = {
  username: "okittredge",
  password: "DemoMember!2026",
};

/**
 * The one account enrolled in TOTP, used to photograph the login page's
 * authentication-code step.
 *
 * Signing in as this account deliberately does *not* complete: it stops at the
 * code step, which is the shot. Never give it to `auth:` — it cannot produce a
 * session.
 *
 * Must match TWO_FACTOR_USERNAME in seed_demo_data.py. It was hard-coded here
 * once and drifted the moment the seeder moved the enrolment to a different
 * member, which failed as a bare capture timeout with nothing pointing at the
 * cause.
 */
export const DEMO_TWO_FACTOR_CREDENTIALS = {
  username: "whalloway",
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

/**
 * Open the first facility's **Rooms** section.
 *
 * The section list is sidebar navigation inside the facility detail page, not a
 * route, so the room shots cannot be reached by URL alone. The rooms are
 * fetched after the section mounts, so waiting for the heading is not waiting
 * for the tree — hence the wait on a room row.
 */
export async function openFacilityRooms(page) {
  await openFirstFromApi(
    "/facilities",
    (id) => `/facilities/${id}`,
    "facilities",
  )(page);
  const rooms = page
    .getByRole("button", { name: /^rooms/i })
    .or(page.getByRole("link", { name: /^rooms/i }))
    .first();
  await rooms.waitFor({ timeout: 20_000 });
  await rooms.click();
  await page
    .getByText("Volunteer Office", { exact: true })
    .first()
    .waitFor({ timeout: 20_000 });
  await page.waitForTimeout(600);
}

/** True for an event that has started but not finished. */
export async function selectMedicApparatus(page) {
  const select = page.locator("#apparatus-select");
  await select.waitFor({ timeout: 20_000 });
  const value = await page
    .locator("#apparatus-select option")
    .filter({ hasText: "M-3" })
    .first()
    .getAttribute("value");
  if (!value) {
    throw new Error("selectMedicApparatus: no M-3 in the apparatus picker");
  }
  await select.selectOption(value);
  // Wait on the compartments rather than a timeout: they load on selection,
  // and without this the shot catches a spinner over an otherwise-right page.
  await page
    .getByText(/Drug Bag|Trauma Bag/i)
    .first()
    .waitFor({ timeout: 20_000 });
  await page.waitForTimeout(600);
}

/**
 * Open a checklist template in the builder, by name.
 *
 * By name through the API rather than by clicking the settings list: that list
 * is ordered and grows, so a positional click quietly opens a different
 * template as the demo department fills out — the failure `openFirstFromApi`
 * exists to prevent.
 */
export function openTemplateNamed(name) {
  return async (page) => {
    await openFirstFromApi(
      "/equipment-checks/templates",
      (id) => `/scheduling/equipment-check-templates/${id}`,
      "templates",
      (t) => (t.name ?? "") === name,
    )(page);
    await page.waitForTimeout(1_500);
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
 *
 * **The predicate is serialized and re-created inside the page, so it cannot
 * close over anything in this file.** It is shipped across as source text and
 * rebuilt with `new Function`, which keeps the syntax and drops the scope — a
 * predicate referencing a module constant throws `ReferenceError: <name> is not
 * defined` in the browser, not here, which is why the close-out shots failed
 * with nothing in this file looking wrong. Either keep the predicate
 * self-contained, or pass source text with the value already interpolated:
 *
 *   openStaffedShift(`(s) => s.notes === ${JSON.stringify(NOTE)}`)
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
      // A string is already source; a function is converted to it. Both end up
      // as text because that is all that survives the boundary.
      [extraMatch ? extraMatch.toString() : ""],
    );
    if (!id) throw new Error("openStaffedShift: no shift with a crew found");
    const url = new URL(page.url());
    url.searchParams.set("shift", id);
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  };
}

/**
 * Force the organization's call-tracking mode.
 *
 * Close-out renders one of two entirely different screens depending on this
 * setting: `count_only` gets the three-step wizard, anything else keeps the
 * single finalize checklist. Both are photographed, so neither shot can assume
 * what the last one left behind.
 *
 * Every mode-dependent shot therefore *sets* the mode it needs rather than
 * inheriting it — the same self-healing rule capture.mjs applies to
 * `navigationLayout`, and for the same reason: manifest order is not a
 * contract, and a shot that silently photographs the other screen still
 * succeeds. It just writes the wrong picture under the right filename.
 *
 * The seeder deliberately leaves the department on `detailed`, so a run that
 * captures nothing from this group leaves the demo database as it found it.
 */
/**
 * The seeded bylaw draft, put back the way the seeder leaves it.
 *
 * Applying a saved ballot template replaces the whole ballot *and* writes the
 * template's own voting method over the election's — which is the subject of
 * `19-26`, and which leaves this draft holding four officer seats at simple
 * majority once that shot has run. Three shots read it in its seeded state
 * (`14-21` and `14-22` match on "Ballot Items (1)"), so each restores what it
 * needs rather than trusting manifest order or a fresh database. The seeder
 * repairs it too, for the run that starts from a database somebody else left
 * mutated.
 *
 * The draft is `simple_majority` with a two-thirds victory condition -- the
 * create form's "Supermajority Required (2/3)", which is one control setting
 * both. The saved template is ranked choice, so applying it visibly changes the
 * method. A template carrying the election's own method would change nothing
 * visible, and the silent overwrite the pair is about would have no picture.
 */
export async function resetBylawDraft(page) {
  await page.evaluate(async () => {
    const csrf =
      document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] ?? "";
    const list = await (
      await fetch("/api/v1/elections?limit=50", { credentials: "include" })
    ).json();
    const rows = Array.isArray(list) ? list : (list.elections ?? []);
    const bylaw = rows.find((row) => row.title === "Bylaw Amendment Vote");
    if (!bylaw) return;
    // The list carries neither the voting method nor the ballot items, so
    // whether a reset is needed can only be read from the detail.
    const current = await (
      await fetch(`/api/v1/elections/${bylaw.id}`, { credentials: "include" })
    ).json();
    // Keyed on the ballot, not the method: the item count is what the shots
    // match on, and a reset that leaves four items behind is worse than none.
    if (
      (current.ballot_items ?? []).length === 1 &&
      current.voting_method === "simple_majority"
    ) {
      return;
    }
    await fetch(`/api/v1/elections/${bylaw.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": decodeURIComponent(csrf),
      },
      body: JSON.stringify({
        ballot_items: [
          {
            id: "item-1",
            type: "general_vote",
            title: "Article VII Amendment",
            description: "Vote for Article VII Amendment.",
            position: "Article VII Amendment",
            eligible_voter_types: ["all"],
            vote_type: "approval",
          },
        ],
        voting_method: "simple_majority",
        victory_condition: "supermajority",
        victory_percentage: 67,
        allow_write_ins: true,
      }),
    });
  });
}

/**
 * Open the seeded bylaw draft's detail page, in its seeded state.
 *
 * Matched on title rather than "the first draft": which election that is
 * depends on seed order, and the two shots either side of an applied template
 * have to be looking at the same record.
 */
export async function openBylawDraft(page) {
  await resetBylawDraft(page);
  await openFirstFromApi(
    "/elections?limit=50",
    (id) => `/elections/${id}`,
    "elections",
    (election) => (election.title ?? "") === "Bylaw Amendment Vote",
  )(page);
}

export function setCallTracking(mode) {
  return async (page) => {
    await page.evaluate(async (wanted) => {
      const csrf =
        document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] ?? "";
      const current = await (
        await fetch("/api/v1/scheduling/settings", { credentials: "include" })
      ).json();
      const tracking = current.call_tracking ?? {};
      if ((tracking.mode ?? "detailed") === wanted) return;
      // The payload replaces the whole call_tracking object, so the type list
      // has to be sent back with it. Omitting it wipes the department's own
      // call types — which is exactly what step 2 of the wizard renders.
      await fetch("/api/v1/scheduling/settings", {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": decodeURIComponent(csrf),
        },
        body: JSON.stringify({
          call_tracking: {
            mode: wanted,
            call_types: tracking.call_types ?? [],
          },
        }),
      });
    }, mode);
  };
}

/**
 * Force the organization's "require end-of-shift checks" rule.
 *
 * Same self-healing contract as `setCallTracking`: the rule decides whether
 * close-out shows the outstanding-checks warning at all, and two shots want
 * opposite answers, so each sets the one it needs rather than inheriting
 * whatever ran before it. The seeder leaves the department with the rule off.
 */
export function setRequireEndOfShiftChecks(wanted) {
  return async (page) => {
    await page.evaluate(async (want) => {
      const csrf =
        document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] ?? "";
      const current = await (
        await fetch("/api/v1/scheduling/settings", { credentials: "include" })
      ).json();
      if (Boolean(current.require_end_of_shift_checks) === want) return;
      await fetch("/api/v1/scheduling/settings", {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": decodeURIComponent(csrf),
        },
        body: JSON.stringify({ require_end_of_shift_checks: want }),
      });
    }, wanted);
  };
}

/**
 * The seeder's dedicated close-out fixture: a past 24-hour shift, four crew.
 *
 * Kept in step with CLOSEOUT_SHIFT_NOTE in seed_demo_data.py, which matches on
 * this string exactly to decide whether to reuse the fixture or build one.
 */
const CLOSEOUT_SHIFT_NOTE =
  "Close-out wizard fixture — 24-hour tour, four crew, count-only captures.";

/**
 * Open the close-out wizard on the seeded fixture, at a chosen step.
 *
 * Two normalizations happen here, and both exist because these shots would
 * otherwise photograph each other's leftovers:
 *
 * 1. **The mode is forced to `count_only`**, because `03-45` sets it back to
 *    `detailed` and either may run first.
 * 2. **The step is walked from 1**, because the server remembers how far the
 *    last run got (`shifts.closeout_step`) and reopens there. Without this, a
 *    second capture run would open at step 3 and the "step 1" shot would
 *    quietly contain step 3. Back is pure client state and saves nothing, so
 *    rewinding is free; Next saves, which is idempotent here — it rewrites the
 *    same attendance times and reconciles to the same call rows.
 *
 * `Close out shift` is **never** clicked. That finalizes, and a finalized shift
 * will not reopen the wizard — one capture run would spend the fixture for
 * every run after it.
 */
/**
 * The close-out wizard card itself.
 *
 * These three shots are clipped to it rather than framed by the viewport, for
 * two reasons the uncropped captures showed plainly:
 *
 * 1. **The subject sits below the fold.** The wizard renders inside a
 *    right-hand drawer that scrolls independently, so a 900px viewport cut off
 *    step 1's combined-hours figure — which its marker explicitly asks for —
 *    and opened step 2 already scrolled past the EMS and Fire rows it exists to
 *    show, leaving nine zeroes on screen.
 * 2. **The drawer below the wizard carries the fixture's own note.** The card
 *    reading "Close-out wizard fixture — 24-hour tour, four crew, count-only
 *    captures" is seeding scaffolding, not something a department would ever
 *    write, and it has no business in a published guide image.
 *
 * Matched on the progress nav's aria-label, which the wizard owns, rather than
 * on a utility class string that a restyle would silently change.
 */
/**
 * The close-out shots are framed at 1440x1300 rather than the 900px default.
 *
 * The wizard card sits in a right-hand drawer with its own scroll, and clipping
 * to the card captures only what the drawer can show at once. At 900px the
 * step indicator was cut off the top of every one of the three, so a reader
 * could not tell which step they were looking at — on a sequence whose whole
 * point is that it is three steps.
 */
const CLOSEOUT_VIEWPORT = { width: 1440, height: 1300 };

const CLOSEOUT_WIZARD_CARD = "div:has(> nav[aria-label='Close-out progress'])";

export function openCloseoutWizard({ step = 1, calls = null, credit = null }) {
  return async (page) => {
    await setCallTracking("count_only")(page);
    // Passed as source text, not as a closure: the predicate is rebuilt inside
    // the page, where CLOSEOUT_SHIFT_NOTE does not exist. See openStaffedShift.
    await openStaffedShift(
      `(shift) => (shift.notes || "").trim() === ${JSON.stringify(
        CLOSEOUT_SHIFT_NOTE,
      )}`,
    )(page);
    await clickByName(/^Close out shift$/i)(page);

    const wizard = page.getByLabel("Close-out progress");
    await wizard.waitFor({ state: "visible" });

    const currentStep = async () => {
      const marker = page.locator('[aria-current="step"]').first();
      const label = (await marker.getAttribute("aria-label")) || "";
      return Number(label.match(/Step (\d)/)?.[1] ?? 1);
    };

    // Wait for the step marker itself to move, not for the wizard to be
    // "visible". The progress nav renders on every step, so waiting on the
    // wizard is satisfied the instant Next is clicked, and reading the step
    // straight afterwards races the re-render: it returned 1 while the body
    // was still swapping to step 2, the `=== 2` guard below never fired, and
    // the capture wrote a screen of empty call rows under a caption about
    // three EMS and one fire. Nothing failed — the picture was just wrong.
    const arriveAt = async (n) => {
      await page
        .locator(`[aria-current="step"][aria-label="Step ${n} of 3"]`)
        .waitFor({ state: "visible", timeout: 15_000 });
    };

    // Bounded: three steps, so two Backs is the most that can be needed. A
    // while(true) here would hang the whole run on an unexpected state.
    for (let guard = 0; guard < 3 && (await currentStep()) > 1; guard += 1) {
      await page.getByRole("button", { name: /^Back$/ }).click();
      await page.waitForTimeout(250);
    }
    await arriveAt(1);

    // Fill the call rows while step 1 is still on screen? No — they only exist
    // on step 2. Advance first, fill on arrival, and only then move on: step
    // 2's Next reads these rows, and the derived total is computed from them.
    for (let target = 2; target <= step; target += 1) {
      await page.getByRole("button", { name: /^Next$/ }).click();
      await arriveAt(target);
      if (target === 2 && calls) {
        for (const [label, count] of Object.entries(calls)) {
          // `${label} calls` is the input's own aria-label, one per configured
          // call type. Matching the label text alone would also hit the row's
          // name cell.
          await page
            .getByLabel(`${label} calls`, { exact: true })
            .fill(String(count));
        }
      }
    }

    if (credit !== null) {
      // Lower the first crew member, so the shot shows a deliberate correction
      // rather than four identical seeded numbers. Targeted by pattern rather
      // than by name: the roster is minted per seeder run, and the wizard sorts
      // it server-side, so "the first row" is stable where any given name is
      // not.
      const field = page.getByLabel(/^Calls credited to /).first();
      await field.fill(String(credit));
      // The field clamps on blur, not per keystroke, so the displayed value is
      // only settled once focus leaves.
      await field.blur();
    }
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

/**
 * Open the drawer of whichever applicant is currently at `stage`.
 *
 * Naming the applicant instead ties the shot to one seeding order: the
 * election-package section renders only on an election_vote stage, and it was
 * hard-coded to "Morgan Tran", so the moment the seeder spread applicants
 * differently the shot pictured someone at Interview under a caption about the
 * vote. The table's Current Stage column is the fact worth matching on.
 */
export function openApplicantAtStage(stage) {
  return async (page) => {
    await clickByName(/^table$/i)(page);
    const row = page.locator("tbody tr").filter({ hasText: stage }).first();
    await row.waitFor({ timeout: 15_000 });
    await row.click({ timeout: 10_000 });
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

export const isClosedElection = (election) =>
  (election.status ?? "") === "closed";

export const isOpenElection = (election) => (election.status ?? "") === "open";

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
    if (!id)
      throw new Error(`${shotId}: no future shift has exactly one open seat`);
    const url = new URL(page.url());
    url.searchParams.set("shift", id);
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
  };
}

/** Open the Shift Reports tab and switch to one of its views. */
function openReportView(name) {
  return async (page) => {
    await page.getByRole("button", { name }).first().click({ timeout: 20_000 });
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
  // The shift picker is a list of cards, not a select, listed oldest-first —
  // so "the first ladder card" is a lottery on who crewed it, and on a fresh
  // seed the trainee-carrying ladder shifts sit at the bottom of the list.
  // Resolve the date whose crew actually holds an evaluable trainee through
  // the same endpoint the form itself reads, restricted to the dates the
  // picker is showing, and click that exact card.
  const listedCards = await page
    .getByText(/Ladder 4 — \d{4}-\d{2}-\d{2}/)
    .allInnerTexts();
  const listedDates = listedCards
    .map((text) => text.match(/Ladder 4 — (\d{4}-\d{2}-\d{2})/)?.[1])
    .filter(Boolean);
  const targetDate = await page.evaluate(
    async ([dates]) => {
      const listed = await fetch("/api/v1/scheduling/shifts?limit=200", {
        credentials: "include",
      });
      if (!listed.ok) return null;
      const ladders = ((await listed.json()).shifts ?? [])
        .filter(
          (shift) =>
            (shift.apparatus_name ?? "") === "Ladder 4" &&
            dates.includes(shift.shift_date),
        )
        .sort((a, b) => (a.shift_date < b.shift_date ? 1 : -1));
      for (const shift of ladders) {
        const crewRes = await fetch(
          `/api/v1/training/shift-reports/shift-crew/${shift.id}`,
          { credentials: "include" },
        );
        if (!crewRes.ok) continue;
        const body = await crewRes.json();
        const crew = Array.isArray(body) ? body : (body.crew ?? []);
        if (crew.some((m) => m.program_name && !m.has_existing_report)) {
          return shift.shift_date;
        }
      }
      return null;
    },
    [listedDates],
  );
  if (!targetDate) {
    throw new Error(
      "openBatchReportForm: no listed Ladder 4 shift carries an evaluable trainee",
    );
  }
  await page
    .getByText(`Ladder 4 — ${targetDate}`)
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
    .evaluateAll((els) =>
      els.map((e) => e.getAttribute("value")).filter(Boolean),
    );
  if (sizes[0]) await sizeField.selectOption(sizes[0]);
  await page.waitForTimeout(600);
  // The stock select only renders once a size field is chosen, and only a
  // stock category turns the size panel into shortfall-and-cost columns.
  const stock = page
    .locator("select")
    .filter({ hasText: /subtract current stock/i });
  const opts = await stock
    .locator("option")
    .evaluateAll((els) =>
      els.map((e) => e.getAttribute("value")).filter(Boolean),
    );
  if (opts[0]) await stock.selectOption(opts[0]);
  await page.waitForTimeout(400);
  await page
    .getByRole("button", { name: /Analyze Impact/i })
    .click({ timeout: 15_000 });
  // The analysis is a round trip over the whole roster.
  await page.waitForTimeout(3000);
}

/**
 * Navigate a signed-out page to a published public form.
 *
 * The slug is minted per seed, and these shots have no session, so the lookup
 * borrows the administrator's. `/f/{slug}` serves published forms only, which
 * is what the seeder publishes.
 */
export async function openPublicForm(page, helpers) {
  const admin = await helpers.lookupPage();
  const slug = await admin.evaluate(async () => {
    const response = await fetch("/api/v1/forms", { credentials: "include" });
    if (!response.ok) return null;
    const body = await response.json();
    const forms = Array.isArray(body) ? body : body.forms || body.items || [];
    const target = forms.find((f) => f.is_public && f.public_slug);
    return target ? target.public_slug : null;
  });
  if (!slug) throw new Error("no published public form to capture");
  await page.goto(`${new URL(page.url()).origin}/f/${slug}`, {
    waitUntil: "domcontentloaded",
  });
}

/**
 * Open the TOTP-enrolled demo member's profile.
 *
 * Both halves of the 17-03/17-04 pair must land on the *same* record for the
 * comparison to mean anything, so the member is chosen by username rather than
 * by position in the roster, which changes with the seed.
 */
export async function openMemberProfile(page) {
  const id = await page.evaluate(async () => {
    const response = await fetch("/api/v1/users?limit=200", {
      credentials: "include",
    });
    if (!response.ok) return null;
    const body = await response.json();
    const users = Array.isArray(body) ? body : body.users || body.items || [];
    const target = users.find((u) => u.username === "whalloway");
    return target ? target.id : null;
  });
  if (!id)
    throw new Error("the TOTP-enrolled demo member is not in the roster");
  await page.goto(`${new URL(page.url()).origin}/members/${id}`, {
    waitUntil: "domcontentloaded",
  });
}

/** The election seeded past its nomination phase with one nominee still pending. */
export const isPostNominationElection = (election) =>
  /Lieutenant Election/.test(election.title ?? "");

/**
 * Open the item that is out on loan past its return date.
 *
 * Found through the overdue endpoint rather than by name: which item is late
 * depends on the seeder's checkout plan, and a shot that hard-codes one goes
 * quietly wrong the day that plan changes.
 */
export async function openOverdueItem(page) {
  const id = await page.evaluate(async () => {
    const response = await fetch("/api/v1/inventory/checkout/overdue", {
      credentials: "include",
    });
    if (!response.ok) return null;
    const body = await response.json();
    const rows = Array.isArray(body)
      ? body
      : body.checkouts || body.items || [];
    return rows.length ? rows[0].item_id : null;
  });
  if (!id) throw new Error("no overdue loan in the demo data");
  await page.goto(`${new URL(page.url()).origin}/inventory/items/${id}`, {
    waitUntil: "domcontentloaded",
  });
}

/**
 * Press Approve on the swap the capturing account raised itself, and wait for
 * the server's refusal.
 *
 * The row is found by the heading the page gives your own request rather than
 * by position: the list sorts pending first and then newest, so which of the
 * two pending swaps sits on top depends on the order the seeder created them.
 *
 * Nothing is mutated — that is the point of the shot. The request is refused
 * before the service touches it, so the swap is still pending afterwards and
 * this needs no `mutatesSeedData` flag.
 */
export async function reviewOwnSwapBlocked(page) {
  const own = page
    .locator(".card")
    .filter({ hasText: /Your swap request/ })
    .first();
  await own.waitFor({ state: "visible", timeout: 20_000 });
  await own.getByRole("button", { name: /approve swap/i }).click();
  await page
    .getByText(/Requesters cannot review their own swap requests/i)
    .waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(400);
}

/**
 * Widen the Requests tab to its full time-off history and scroll to the
 * control that fetches the next page.
 *
 * The status filter opens on Pending, and a history long enough to page
 * through is by definition resolved — so with the default filter the tab shows
 * a single row and no control at all.
 */
export async function openRequestsHistoryPage(page) {
  await page.getByRole("tab", { name: /Time Off/i }).click();
  await page
    .getByLabel(/Filter requests by status/i)
    .selectOption("", { timeout: 20_000 });
  const more = page.getByRole("button", {
    name: /Load more time-off requests/i,
  });
  await more.waitFor({ state: "visible", timeout: 20_000 });
  await more.scrollIntoViewIfNeeded({ timeout: 10_000 });
  await page.waitForTimeout(400);
}

/**
 * Open one submitted check from the member's own history.
 *
 * Reached through the Completed checklists section rather than through the
 * card grid: opening a completed card reopens the *form* with its saved
 * answers, which is the working screen, not the record. The history row opens
 * the read-back view — who signed it, when, and every item as answered.
 */
export async function openSubmittedCheck(page) {
  await page.getByRole("button", { name: /completed checklists/i }).click();
  const row = page
    .locator("#check-history-content button")
    .filter({ hasText: /Passed/ })
    .first();
  await row.waitFor({ state: "visible", timeout: 20_000 });
  await row.click();
  await page
    .getByText(/Completed checklist/i)
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(500);
}

/**
 * Open a dialog taller than a phone screen and scroll it to its action row.
 *
 * "Add Course" because it is the tallest dialog the demo department has --
 * roughly 1250px of form inside a panel capped at 90dvh -- so on a 390x844
 * viewport it genuinely scrolls internally, which is what the marker is about.
 * The shot is NOT `fullPage`: this capture is about what covers the action row,
 * and `capture.mjs` hides the bottom bar for full-page shots (it would
 * otherwise be stitched in at a document offset), which would prove the point
 * by removing the thing being tested.
 *
 * The bar is asserted present before the dialog opens. Without that check a
 * release that stopped rendering it altogether would leave this capture
 * looking exactly the same and still captioned "the bar is hidden while a
 * dialog is open".
 */
export async function openTallDialogAtActionRow(page) {
  const bar = page.locator('nav[aria-label="Primary"]');
  await bar.waitFor({ state: "visible", timeout: 20_000 });
  await page
    .getByRole("button", { name: /add course/i })
    .first()
    .click();
  const panel = page.locator(".modal-panel").first();
  await panel.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(400);
  await panel.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(400);
}

/**
 * Open one member's training history and put its table at the top of the frame.
 *
 * The member is chosen by username rather than by roster position, so both
 * halves of the reflow pair land on the same records — a comparison between
 * two different members' histories would show a difference that is not the
 * one being illustrated.
 *
 * Both halves are viewport shots rather than element clips. Clipping to the
 * table works at desktop width and does not on a phone: the element is then
 * taller than the screen, and a Playwright element screenshot paints the
 * sticky header and the bottom bar at their document offsets, stamping both
 * across the middle of the table.
 */
export async function openTrainingHistoryTable(page) {
  const id = await page.evaluate(async () => {
    const response = await fetch("/api/v1/users?limit=200", {
      credentials: "include",
    });
    if (!response.ok) return null;
    const body = await response.json();
    const users = Array.isArray(body) ? body : body.users || body.items || [];
    const target = users.find((u) => u.username === "whalloway");
    return target ? target.id : null;
  });
  if (!id)
    throw new Error("the demo member whose history this pair uses is missing");
  await page.goto(`${new URL(page.url()).origin}/members/${id}/training`, {
    waitUntil: "domcontentloaded",
  });
  const table = page.locator("table.rwd-table").first();
  await table.waitFor({ state: "visible", timeout: 20_000 });
  await table.evaluate((el) => {
    el.scrollIntoView({ block: "start" });
    // Clear of the sticky page header, which `block: "start"` parks the
    // table's first row underneath.
    window.scrollBy(0, -120);
  });
  await page.waitForTimeout(500);
}

/** Open the Terms of Service tab of the legal-documents screen. */
async function openTermsTab(page) {
  await page.getByRole("tab", { name: /Terms of Service/i }).click();
  await page
    .getByText(/Second pass after the officers' meeting/)
    .waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(400);
}

/**
 * Show the secretary their own proposal, where the permission is visible.
 *
 * Publishing is not a control in the revision editor -- that form offers
 * Cancel and Save draft to everybody, publisher included. It is an action on
 * the saved proposal, so the proposal card is the only place the difference
 * between `legal.propose` and `legal.publish` can be photographed.
 */
export async function openOwnLegalProposal(page) {
  await openTermsTab(page);
  await page
    .getByText(/Second pass after the officers' meeting/)
    .first()
    .evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
}

/** Reopen that proposal in the editor, with all three fields already filled. */
export async function openLegalRevisionEditor(page) {
  await openTermsTab(page);
  const proposal = page
    .locator("li.card")
    .filter({ hasText: /Second pass after the officers' meeting/ })
    .first();
  await proposal.getByRole("button", { name: /^Edit$/ }).click();
  await page
    .locator("#revision-note")
    .waitFor({ state: "visible", timeout: 20_000 });
  // The panel scrolls internally and opens at the top, which puts the
  // effective-date field -- printed to members as "Last updated", and half of
  // what the marker asks for -- below the fold. Scrolled to the end so the
  // change note and that field are both in frame; the body textarea is 24rem
  // tall, so its tail stays visible above them.
  await page
    .locator("#revision-note")
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(400);
}

/** The published history of the privacy notice, three revisions deep. */
export async function openLegalHistory(page) {
  const history = page.getByText(/Published history/).first();
  await history.waitFor({ state: "visible", timeout: 20_000 });
  await history.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(400);
}

/**
 * The Admin Hours Summary tab, on its calendar-year preset.
 *
 * Both the tab and the reporting period are local component state with no URL
 * form, so each has to be clicked. "This calendar year" specifically, because
 * the guide's point is that it is a calendar year rather than a rolling 365
 * days, and the default preset is All time.
 */
export async function openAdminHoursSummary(page) {
  await clickByName(/^Summary$/)(page);
  await page
    .getByRole("combobox")
    .first()
    .selectOption("year", { timeout: 20_000 });
  await page
    .getByText(/Where the hours came from/i)
    .waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(600);
}

/**
 * Open the rescue's edit form at its crew-seat list.
 *
 * Found by unit number rather than by position in the fleet, and the rescue
 * specifically: the seeder puts a legacy free-text seat on that one, which is
 * the half of the marker no other apparatus can show.
 */
export async function openApparatusCrewSeats(page) {
  const id = await page.evaluate(async () => {
    const response = await fetch("/api/v1/apparatus?limit=50", {
      credentials: "include",
    });
    if (!response.ok) return null;
    const body = await response.json();
    const fleet = Array.isArray(body)
      ? body
      : body.apparatus || body.items || [];
    const target = fleet.find(
      (unit) =>
        (unit.unit_number ?? unit.unitNumber ?? "").toUpperCase() === "R-7",
    );
    return target ? target.id : null;
  });
  if (!id) throw new Error("the rescue this shot uses is not in the fleet");
  await page.goto(`${new URL(page.url()).origin}/apparatus/${id}/edit`, {
    waitUntil: "domcontentloaded",
  });
  const seats = page.getByText(/Crew Positions \/ Seats/i).first();
  await seats.waitFor({ state: "visible", timeout: 20_000 });
  await seats.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(500);
}

/**
 * Generate the Call Volume report and frame its summary cards.
 *
 * The mode is forced by the caller, not inherited: this report renames all
 * three stat cards on it (Unit Responses vs Total Calls) and shows the
 * per-unit footnote only in count-only, so a shot that inherited the mode
 * would still succeed and write the other half's picture under this half's
 * name.
 *
 * Last 90 Days rather than the default: the department's recorded calls sit in
 * a three-week band, and a year-to-date window divides them across 236 days
 * and reports an average of 0.2 per day — arithmetic that is correct and reads
 * as a broken screen.
 */
export function openCallVolumeReport(mode) {
  return async (page) => {
    await setCallTracking(mode)(page);
    await page.goto(`${new URL(page.url()).origin}/reports`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: /Last 90 Days/i }).click();
    await page.waitForTimeout(500);
    const heading = page
      .getByText("Incident / Call Volume", { exact: true })
      .first();
    await heading.waitFor({ state: "visible", timeout: 20_000 });
    // The card is the nearest ancestor that owns a button; the grid renders one
    // Generate Report per report, so scoping to the card is what picks this one.
    await heading
      .locator("xpath=ancestor::*[.//button][1]")
      .getByRole("button", { name: /Generate Report/i })
      .first()
      .click({ timeout: 15_000 });
    const label = mode === "count_only" ? /Unit Responses/ : /Total Calls/;
    const card = page.getByText(label).first();
    await card.waitFor({ state: "visible", timeout: 20_000 });
    await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(500);
  };
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
        const response = await fetch(
          "/api/v1/training/shift-reports/all?limit=50",
          {
            credentials: "include",
          },
        );
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
    // "No calls logged for this shift." belongs to the Calls sub-panel further
    // down the same drawer, and the shift is deliberately in the future — the
    // crew board this pictures is populated.
    allowEmptyState: true,
  },
  {
    id: "03-58-assign-member-form",
    doc: "03-scheduling.md",
    line: 1278,
    anchor: "Screenshot of the Assign Member form",
    alt: "The Assign someone form on a shift, with its position and member pickers",
    route: "/scheduling",
    prepare: async (page) => {
      await openPartStaffedShift("03-58")(page);
      // The form is behind "Assign Member" on a board with riding positions,
      // and behind "Assign" on one without. Either name opens the same form.
      await page
        .getByRole("button", { name: /^Assign( someone| Member)?$/ })
        .first()
        .click({ timeout: 15_000 });
      // Wait for the member list to load rather than for a fixed pause: the
      // select renders empty first and a fixed wait pictured it that way.
      await page.locator("#assign-member-search").waitFor({ timeout: 15_000 });
      await page.waitForTimeout(1500);
    },
    // Clipped to the form. The panel scrolls in its own container, so
    // `window.scrollBy` moves the calendar behind it and leaves the form
    // hanging off the bottom of the frame; an element screenshot brings it
    // into view by itself, and the form is the subject anyway. The heading
    // reads "Assign someone to this shift" since the crew-board redesign.
    selector:
      "div.rounded-lg:has(> h4:text-is('Assign someone to this shift'))",
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
    alt: "The dashboard's Next 7 Days timeline, listing the member's own shifts alongside open slots and events",
    auth: "member",
    route: "/dashboard",
    prepare: async (page) => {
      // The dashboard redesign merged "My Upcoming Shifts" into the Next 7
      // Days timeline — one seven-day list of the member's shifts, open slots
      // and events. It is a <section class="card">, not a div.
      const panel = page
        .locator("section.card:has(h3:has-text('Next 7 Days'))")
        .first();
      await panel.waitFor({ timeout: 20_000 });
      await panel.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(1200);
    },
    selector: "section.card:has(h3:has-text('Next 7 Days'))",
  },
  {
    id: "03-62-dashboard-signup-positions",
    doc: "03-scheduling.md",
    line: 790,
    anchor: "Screenshot of the Dashboard's Open Shifts section",
    alt: "An open shift expanded after pressing Sign Up, its position dropdown holding only the positions the member's rank qualifies for",
    auth: "member",
    route: "/dashboard",
    prepare: async (page) => {
      // The eligibility check happens on press, not on render — every open
      // shift shows Sign Up regardless of rank — so the dropdown this pictures
      // only exists after the card is expanded. Open slots live inside the
      // Next 7 Days timeline since the dashboard redesign.
      const panel = page
        .locator("section.card:has(h3:has-text('Next 7 Days'))")
        .first();
      await panel.waitFor({ timeout: 20_000 });
      await panel.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await panel
        .getByRole("button", { name: /sign up/i })
        .first()
        .click({ timeout: 10_000 });
      // The positions come from a request fired by the click; waiting on the
      // select rather than a fixed delay keeps the shot off the spinner.
      await panel.locator("select").first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(400);
    },
    selector: "section.card:has(h3:has-text('Next 7 Days'))",
  },
  {
    id: "03-63-offline-banner",
    doc: "03-scheduling.md",
    line: 2158,
    anchor: "The offline banner on the Shift Reports tab",
    alt: "The Shift Reports tab offline banner — reports will be saved locally and submitted when connectivity returns",
    route: "/scheduling?tab=shift-reports",
    prepare: async (page) => {
      // A page-level fake rather than `context.setOffline(true)`. The context
      // is shared by every later shot and nothing in the harness restores it,
      // so a real offline flag set here would silently break the rest of the
      // run. `useOnlineStatus` reads `navigator.onLine` and listens for the
      // window events, both of which can be faked inside this one page — and a
      // page navigation resets it, so the leak cannot outlive the shot.
      await page.evaluate(() => {
        Object.defineProperty(window.navigator, "onLine", {
          configurable: true,
          get: () => false,
        });
        window.dispatchEvent(new Event("offline"));
      });
      const banner = page.getByText(/You're offline\. Reports will be saved/);
      await banner.waitFor({ timeout: 20_000 });
      await banner.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(400);
    },
    selector:
      "div:has(> svg) >> text=/You're offline\\. Reports will be saved/",
  },
  {
    id: "02-90-crew-summary-table",
    doc: "02-training.md",
    line: 2470,
    anchor: "The Crew summary table on",
    alt: "The Crew summary table on Scheduling > Shift Reports — one row per crew member with report count, hours, calls and average rating",
    route: "/scheduling?tab=shift-reports",
    prepare: async (page) => {
      // Guide 02's worked example calls this "the Shift Reports tab", and the
      // tab lives under Scheduling rather than Training — the same screen
      // guide 03 photographs, shown here for its per-crew roll-up rather than
      // its Review Queue.
      const table = page
        .locator("table:has(th:text-is('Crew member'))")
        .first();
      await table.waitFor({ timeout: 20_000 });
      await table.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(600);
    },
    selector: "div:has(> div > table:has(th:text-is('Crew member')))",
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
      // The bar's label changed from "… pending" to "… awaiting your
      // confirmation" in the My Shifts redesign.
      const selectAll = page.getByText(/Select all \d+ awaiting/).first();
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
    alt: "A shift's crew board — open positions each offering Assign someone and Sign myself up, with the bulk Fill All Open action beneath them",
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
    // "No calls logged for this shift." is the Calls sub-panel on a shift that
    // is deliberately in the future; the open-slots crew board is the subject
    // and it is populated.
    allowEmptyState: true,
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
    // "No EVOC requirement" is the select's placeholder option, present in the
    // DOM on every render — including this one, where a real level is chosen.
    allowEmptyState: true,
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
        // The probationary pipeline is where the checklist with hidden
        // steps lives; the member's first enrollment is a program without
        // one, and "first" quietly changed when a second enrollment was
        // seeded.
        (enrollment) => /Probationary/i.test(enrollment.program?.name || ""),
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
    id: "02-104-cohort-preview-step",
    doc: "02-training.md",
    line: 220,
    anchor:
      "Screenshot of the cohort wizard on the Preview step, showing a numbered list",
    alt: "The cohort wizard's Preview step — computed class dates, a weekend-move warning, and the holidays offered as blackout dates",
    route: "/training/admin?tab=cohorts",
    prepare: async (page) => {
      await clickByName("New cohort")(page);
      // The wizard fetches the course list and the member roster before it
      // renders step 1 at all; until they land it is a pair of skeletons.
      await page.waitForSelector("#cohort-course", { timeout: 20_000 });

      // Recruit School is the only seeded course with a syllabus, and the
      // wizard refuses to advance without one. Matched on the option's text
      // rather than passed as a label: the picker appends each course's code,
      // so the exact label is "Recruit School (RS-100)".
      const courseValue = await page.$eval("#cohort-course", (select) => {
        const match = Array.from(select.options).find((option) =>
          option.text.startsWith("Recruit School"),
        );
        return match ? match.value : "";
      });
      await page.selectOption("#cohort-course", courseValue);
      await page.fill("#cohort-name", "Recruit School — Fall 2026");
      await clickByName("Next")(page);

      // 5 Nov 2026 is chosen so the syllabus's own day offsets (0, 3, 7, 10,
      // 14) land two classes on a Sunday and put Veterans Day inside the
      // span — which is what makes the warning and the blackout suggestion
      // appear at all. Any other start date renders the step empty of both.
      await page.fill("#cohort-start", "2026-11-05");
      await page.selectOption("#cohort-policy", "next_business_day");
      await page.fill("#cohort-time", "19:00");
      await clickByName("Next")(page);

      // The Next click fires the preview request; the step renders a skeleton
      // until it lands.
      await page.waitForSelector("text=Holidays in this range", {
        timeout: 20_000,
      });
      await page.waitForTimeout(600);
    },
    viewport: { width: 1440, height: 1500 },
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
    id: "04-43-create-election",
    doc: "04-events-meetings.md",
    line: 649,
    anchor: "Screenshot of the election creation form showing the title",
    alt: "The Create New Election dialog — title, description, voting window, and the victory-condition and runoff settings",
    route: "/elections",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^Create Election$/ })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ timeout: 20_000 });
      await dialog.getByLabel(/^Title/).fill("Fall 2026 Officer Election");
      await dialog
        .getByLabel(/^Description/)
        .fill(
          "Annual officer election held at the November business meeting. " +
            "Polls open at the call to order and close before adjournment.",
        );
      // The labelled control is the date half of DateTimeQuarterHour — a
      // native `type=date` input — so it takes a plain date, not a
      // datetime-local value. The time is three separate selects beside it.
      // Filling the start date also reveals the quick-duration row beneath the
      // end date, which is part of what this shot is for.
      await dialog.getByLabel(/^Start Date & Time/).fill("2026-11-10");
      await dialog.getByLabel(/^End Date & Time/).fill("2026-11-10");
      // Blur so the last field is not left with a focus ring and a selected
      // date segment, which reads as a half-finished edit.
      await dialog.getByLabel(/^Title/).click();
      await page.waitForTimeout(600);
    },
    selector: '[role="dialog"]',
    // "No linked meeting" is the Linked Meeting select's default option, which
    // is in the DOM on every new election — the field is optional and the
    // guide's steps do not ask for it to be set.
    allowEmptyState: true,
    fullPage: false,
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
    id: "02-96-bulk-enroll-picker",
    doc: "02-training.md",
    line: 310,
    anchor: "The Enroll Members picker with several members selected",
    alt: "The Enroll Members picker — members selected, the ineligible listed with their reason, and the button counting the selection",
    route: "/training/programs",
    prepare: async (page) => {
      const programId = await page.evaluate(async () => {
        const response = await fetch("/api/v1/training/programs/programs", {
          credentials: "include",
        });
        if (!response.ok) return null;
        const rows = await response.json();
        const list = Array.isArray(rows) ? rows : [];
        const wanted =
          list.find((row) => /Probationary/.test(row.name || "")) || list[0];
        return wanted ? wanted.id : null;
      });
      if (!programId) throw new Error("02-96: no training programme to open");
      await page.goto(
        new URL(`/training/programs/${programId}`, page.url()).toString(),
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForTimeout(2500);
      await page
        .getByRole("button", { name: /^Enroll$/ })
        .first()
        .click({ timeout: 20_000 });
      await page.waitForTimeout(2000);
      // Off, so the members who cannot be enrolled are listed with the reason
      // rather than filtered away — which is the half of this the guide
      // described as an after-the-fact summary.
      await page
        .getByText(/Show eligible only/)
        .first()
        .click();
      await page.waitForTimeout(1200);
      const dialog = page.locator("div.fixed.inset-0").first();
      // The eligible members sort first, so the first three rows are a
      // selection the Enroll button will count. Selecting mutates nothing —
      // only the button does, and it is deliberately not pressed.
      for (const index of [0, 1, 2]) {
        await dialog
          .getByText(/#0\d\d/)
          .nth(index)
          .click()
          .catch(() => {});
        await page.waitForTimeout(300);
      }
      // The list scrolls inside the dialog; its foot is where the ineligible
      // rows and their reasons are, next to the button carrying the count.
      await dialog.evaluate((el) => {
        const scroller = [...el.querySelectorAll("*")].find(
          (node) => node.scrollHeight > node.clientHeight + 40,
        );
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
      await page.waitForTimeout(600);
    },
    selector: "div.fixed.inset-0 > div",
  },
  {
    id: "02-102-shift-report-crew-form",
    doc: "02-training.md",
    line: 1000,
    anchor: "The shift report form with a shift chosen and its crew loaded",
    alt: "A shift completion report — the hours and calls carried over from the shift, its crew listed, and the buttons that file the batch",
    route: "/scheduling?tab=shift-reports&view=create",
    prepare: async (page) => {
      await page.waitForTimeout(3500);
      // Shift-first: the form has nothing to show until a shift is picked, and
      // picking one is what fills the hours and loads the crew.
      // A shift with a crew, not the first row: a one-member shift pictures a
      // batch form filing one report.
      await page
        .locator("button", { hasText: /[3-9] members ·/ })
        .first()
        .click({ timeout: 20_000 });
      await page.waitForTimeout(2500);
      const submit = page.getByRole("button", { name: /Submit Report/ });
      await submit.waitFor({ timeout: 20_000 });
      await submit.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(600);
    },
    // Stops short of pressing Submit: filing the batch is finite, and the
    // shift's reports would exist on the next run.
    selector:
      "div.bg-theme-surface.rounded-xl:has(h3:text-is('New Shift Completion Report'))",
  },
  {
    id: "02-103-shift-report-drafts",
    doc: "02-training.md",
    line: 1143,
    anchor: "The Drafts view listing reports waiting to be finished",
    alt: "The Drafts view — each draft with its shift date, trainee, hours and calls, and the control that opens it to finish",
    route: "/scheduling?tab=shift-reports&view=drafts",
    prepare: async (page) => {
      await page.waitForTimeout(3500);
      await page
        .getByText(/Submit All Drafts|draft/i)
        .first()
        .waitFor({ timeout: 20_000 });
      await page.waitForTimeout(800);
    },
    viewport: { width: 1400, height: 900 },
  },
  {
    id: "02-100-checklist-steps-editor",
    doc: "02-training.md",
    line: 365,
    anchor:
      "The checklist steps editor, with one step kept off the member's view",
    alt: "The requirement editor's checklist steps — each with its own eye toggle, the officer-recorded ones switched to officer-only",
    route: "/training/admin?page=setup&tab=requirements",
    prepare: async (page) => {
      await page.waitForTimeout(3000);
      await page
        .getByPlaceholder(/Search requirements/)
        .first()
        .fill("Station Duties");
      await page.waitForTimeout(1500);
      await page
        .getByRole("button", { name: "Edit requirement" })
        .first()
        .click({ timeout: 20_000 });
      await page.waitForTimeout(2500);
      const editor = page
        .locator("div:has(> span:text-is('Checklist steps'))")
        .first();
      await editor.waitFor({ timeout: 20_000 });
      await editor.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(600);
    },
    selector: "div:has(> span:text-is('Checklist steps'))",
  },
  {
    id: "02-101-expired-enrollment-reopen",
    doc: "02-training.md",
    line: 483,
    anchor: "The Enrollments tab filtered to Expired, and the reopen control",
    alt: "An expired enrollment opened by an officer — the deadline it ran past, and the reopen control with its optional new date",
    route: "/training/programs",
    prepare: async (page) => {
      const programId = await page.evaluate(async () => {
        const response = await fetch("/api/v1/training/programs/programs", {
          credentials: "include",
        });
        if (!response.ok) return null;
        const rows = await response.json();
        const list = Array.isArray(rows) ? rows : [];
        const wanted = list.find((row) =>
          /Recruit School/.test(row.name || ""),
        );
        return wanted ? wanted.id : null;
      });
      if (!programId) throw new Error("02-101: no Recruit School pipeline");
      await page.goto(
        new URL(
          `/training/programs/${programId}?tab=enrollments`,
          page.url(),
        ).toString(),
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForTimeout(3000);
      await page.getByLabel("Status").selectOption("expired");
      await page.waitForTimeout(1500);
      await page
        .getByRole("button", { name: /Manage progress for/ })
        .first()
        .click({ timeout: 20_000 });
      await page.waitForTimeout(2500);
      const reopen = page.getByRole("button", { name: /Reopen enrollment/ });
      await reopen.waitFor({ timeout: 20_000 });
      await reopen.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(600);
    },
    // Stops short of pressing Reopen: doing so would clear the one expired
    // enrollment the demo has.
    selector: "div.fixed.inset-0 > div",
  },
  {
    id: "02-98-requirement-prerequisite",
    doc: "02-training.md",
    line: 445,
    anchor:
      "The pipeline detail page with one requirement set to be done first",
    alt: "A phase on the pipeline detail page — one requirement chipped 'Do this first', the rest 'Any order'",
    route: "/training/programs",
    prepare: async (page) => {
      const programId = await page.evaluate(async () => {
        const response = await fetch("/api/v1/training/programs/programs", {
          credentials: "include",
        });
        if (!response.ok) return null;
        const rows = await response.json();
        const list = Array.isArray(rows) ? rows : [];
        const wanted =
          list.find((row) => /Probationary/.test(row.name || "")) || list[0];
        return wanted ? wanted.id : null;
      });
      if (!programId) throw new Error("02-98: no training programme to open");
      await page.goto(
        new URL(`/training/programs/${programId}`, page.url()).toString(),
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForTimeout(3000);
      // Every phase is expanded once the page loads, so there is nothing to
      // open — clicking the phase header here *collapsed* the requirements this
      // shot is of.
      // The gate is seeded, not toggled here: clicking the chip would flip it
      // back off on the next run.
      const gate = page.getByText("Do this first").first();
      await gate.waitFor({ timeout: 20_000 });
      await gate.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(600);
    },
    // The phase card the gate sits in, so its siblings and their chips are in
    // the frame alongside it.
    selector: "div.rounded-lg.border:has(h3:text-is('Basic Skills'))",
  },
  {
    id: "02-99-member-locked-requirement",
    doc: "02-training.md",
    line: 452,
    anchor: "The member's view of a requirement held back by the gate",
    alt: "A member's progression view — the gated requirement greyed out and reading 'Locked until you finish Firefighter I Written Exam'",
    // The member's own: the progression view is reachable only as the member
    // whose enrollment it is.
    auth: "member",
    route: "/training/my-training",
    prepare: async (page) => {
      // Straight to the Probationary enrollment rather than the first "View
      // full progress" link: the member carries several enrollments, the
      // list's first is a program with no gates, and the lock this pictures
      // lives on the probationary pipeline. The gate is the written exam —
      // hour auto-credit quietly completed the old Hose Deployment gate, and
      // a satisfied gate locks nothing.
      const enrollments = await page.evaluate(async () => {
        const response = await fetch(
          "/api/v1/training/programs/enrollments/me?status=active",
          { credentials: "include" },
        );
        return response.ok ? response.json() : [];
      });
      const list = Array.isArray(enrollments) ? enrollments : [];
      const probationary = list.find(
        (enrollment) =>
          enrollment.program?.name === "Probationary Firefighter Pipeline",
      );
      if (!probationary?.id) {
        throw new Error("02-99: no active probationary enrollment");
      }
      await page.goto(
        new URL(
          `/training/my-progress/${probationary.id}`,
          page.url(),
        ).toString(),
        { waitUntil: "domcontentloaded" },
      );
      await page
        .getByText(/You are here/)
        .first()
        .waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      const locked = page.getByText(/Locked until you finish/).first();
      await locked.waitFor({ timeout: 20_000 });
      await locked.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(600);
    },
    // The phase the gate belongs to: the locked row means nothing without the
    // requirement it is waiting on in the same frame.
    selector:
      "div.rounded-lg:has(> div > h2:text-is('Phase 3: Certification'))",
  },
  {
    id: "02-97-manual-entry-apparatus",
    doc: "02-training.md",
    line: 1173,
    anchor: "The manual entry form's apparatus, times and computed duration",
    alt: "The manual shift report form — an apparatus chosen from the department's units, the shift's start and end, and the duration the page works out from them",
    route: "/training/log-shift",
    prepare: async (page) => {
      await page.waitForTimeout(2500);
      const select = page.locator("select").first();
      await select.waitFor({ timeout: 20_000 });
      // Pick a real unit rather than the placeholder option, so the field shows
      // how the units are labelled — name, unit number and type.
      const value = await select.evaluate((el) => {
        const option = [...el.options].find((o) => o.value);
        return option ? option.value : "";
      });
      if (!value) throw new Error("02-97: no apparatus to choose");
      await select.selectOption(value);
      // An overnight shift: the end date is the following day, which is what
      // the duration below has to reckon with.
      await page.locator('input[type="time"]').first().fill("19:00");
      await page.locator('input[type="time"]').nth(1).fill("07:00");
      const dates = page.locator('input[type="date"]');
      const start = await dates.first().inputValue();
      const [y, m, d] = start.split("-").map(Number);
      const next = new Date(Date.UTC(y, m - 1, d + 1));
      await dates.nth(1).fill(next.toISOString().slice(0, 10));
      await page.locator('input[type="number"]').first().fill("3");
      await page
        .getByText(/^Structure Fire$|^EMS$/)
        .first()
        .click()
        .catch(() => {});
      // Two of the crew, so the section shows the row and its Evaluate control
      // rather than the "search and add members above" it starts at. Adding a
      // member is client-side only — nothing is filed until Submit.
      for (const name of ["Belhaj", "Solberg"]) {
        const search = page.getByPlaceholder(/Search members to add/);
        await search.fill(name);
        await page.waitForTimeout(900);
        await page
          .locator("button", { hasText: /@/ })
          .first()
          .click()
          .catch(() => {});
        await page.waitForTimeout(500);
      }
      await page.waitForTimeout(800);
    },
    // The viewport, not the whole card: the subject is the top of the form, and
    // the card runs on past the crew list to the submit buttons.
    viewport: { width: 1180, height: 1000 },
  },
  {
    id: "02-95-knowledge-test-entry",
    doc: "02-training.md",
    line: 379,
    anchor: "The knowledge-test entry panel showing the last score",
    alt: "A knowledge-test requirement — the last score with its pass, the attempts used, and the score field that records the next",
    route: "/training/programs",
    prepare: async (page) => {
      const programId = await page.evaluate(async () => {
        const response = await fetch("/api/v1/training/programs/programs", {
          credentials: "include",
        });
        if (!response.ok) return null;
        const rows = await response.json();
        const list = Array.isArray(rows) ? rows : [];
        const wanted =
          list.find((row) => /Probationary/.test(row.name || "")) || list[0];
        return wanted ? wanted.id : null;
      });
      if (!programId) throw new Error("02-95: no training programme to open");
      await page.goto(
        new URL(
          `/training/programs/${programId}?tab=enrollments`,
          page.url(),
        ).toString(),
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForTimeout(2500);
      // The member whose written exam carries a recorded score, so the panel
      // shows a used attempt rather than "Attempts: 0 / 3" beside an empty
      // field. Recording one here instead would spend an attempt on every
      // capture run.
      await page
        .getByText(/Nadia Belhaj/)
        .first()
        .click({ timeout: 20_000 });
      await page.waitForTimeout(2500);
      const panel = page
        .locator("div:has(> div > label:has-text('Test score'))")
        .first();
      await panel.waitFor({ timeout: 20_000 });
      await panel.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(600);
    },
    selector: "div.fixed.inset-0 > div",
  },
  {
    id: "02-94-officer-progress-detail",
    doc: "02-training.md",
    line: 322,
    anchor:
      "A member's enrollment progress detail showing requirements grouped by phase",
    alt: "The officer's view of a member's pipeline progress, with the controls that credit and verify each requirement",
    route: "/training/programs",
    prepare: async (page) => {
      // The Enrollments tab of a pipeline, which is a route of its own —
      // `/training/programs/:programId`, not `/training/pipelines/...`.
      const programId = await page.evaluate(async () => {
        const response = await fetch("/api/v1/training/programs/programs", {
          credentials: "include",
        });
        if (!response.ok) return null;
        const rows = await response.json();
        const list = Array.isArray(rows) ? rows : [];
        // The probationary pipeline: the longest of the three, so its phases
        // show finished, in-flight and untouched requirements at once.
        const wanted =
          list.find((row) => /Probationary/.test(row.name || "")) || list[0];
        return wanted ? wanted.id : null;
      });
      if (!programId) throw new Error("02-94: no training programme to open");
      await page.goto(
        new URL(
          `/training/programs/${programId}?tab=enrollments`,
          page.url(),
        ).toString(),
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForTimeout(2500);
      // A member with progress to act on, not the first row for its own sake.
      await page
        .getByText(/Nadia Belhaj/)
        .first()
        .click({ timeout: 20_000 });
      await page.waitForTimeout(2500);
      await page.evaluate(() => window.scrollTo(0, 0));
    },
    fullPage: true,
  },
  {
    id: "02-93-member-full-progress",
    doc: "02-training.md",
    line: 501,
    anchor: "The member's full progress view showing the phase timeline",
    alt: "A member's full pipeline progress — the current phase marked You are here, with milestones and every requirement",
    // The member's own, because the view is reachable only as the member whose
    // enrollment it is.
    auth: "member",
    route: "/training/my-training",
    prepare: async (page) => {
      await page
        .getByText(/View full progress/)
        .first()
        .click({ timeout: 20_000 });
      await page
        .getByText(/You are here/)
        .first()
        .waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.scrollTo(0, 0));
    },
    fullPage: true,
  },
  {
    id: "02-91-session-confirmation-toggle",
    doc: "02-training.md",
    line: 715,
    anchor: "The Create Training Session form (Step 3)",
    alt: "Step 3 of the Create Session form — the settings, with Require instructor confirmation among them",
    // `/training/sessions/new` redirects here; the form is a tab of the
    // training admin page rather than a route of its own.
    route: "/training/admin?page=records&tab=sessions",
    prepare: async (page) => {
      // Step 3 is behind two Next buttons, and Next is disabled until the
      // step's required fields are filled: a title and a type on step 1, the
      // date and times on step 2.
      // The labels are not associated with their inputs, so `getByLabel` finds
      // nothing — reach the field by its placeholder.
      await page
        .getByPlaceholder(/CPR\/AED Renewal Training/i)
        .first()
        .fill("Ladder Company Drill", { timeout: 20_000 });
      await page.waitForTimeout(300);
      for (let step = 0; step < 2; step += 1) {
        const next = page.getByRole("button", { name: /^Next/ }).first();
        await next.waitFor({ timeout: 15_000 });
        await next.click();
        await page.waitForTimeout(1200);
      }
      await page
        .locator("#require_completion_confirmation")
        .waitFor({ timeout: 15_000 });
      await page.waitForTimeout(600);
    },
    fullPage: false,
  },
  {
    id: "02-92-requirement-evaluation-period",
    doc: "02-training.md",
    line: 780,
    anchor: "The requirement add/edit form showing the",
    alt: "The Evaluation Period selector on a requirement, with the note on what it changes",
    route: "/training/requirements",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /Create Requirement/i })
        .first()
        .click({ timeout: 20_000 });
      await page
        .locator("#req-include-current-month")
        .waitFor({ timeout: 15_000 });
      // The dialog scrolls in its own container, so an element clip otherwise
      // stops at the top of the form and never reaches this control.
      await page
        .locator("#req-include-current-month")
        .evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(800);
    },
    // The dialog, not the field. A native select cannot be photographed with
    // its list open, and the control clipped on its own is three lines of text
    // with nothing to say which form they belong to — the three options are
    // enumerated in the prose above.
    selector: "div.fixed.inset-0 > div",
  },
  {
    id: "05-66-my-equipment",
    doc: "05-inventory.md",
    line: 1357,
    anchor: "Screenshot of My Equipment as an ordinary member",
    alt: "My Equipment as an ordinary member — the count tiles and their permanent assignments",
    // My Equipment rather than the inventory page: the item list on the latter
    // is the department catalogue by design, and only its figures are scoped.
    auth: "member",
    route: "/inventory/my-equipment",
    prepare: async (page) => {
      await page
        .getByRole("heading", { name: /My Equipment/i })
        .first()
        .waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1500);
    },
    fullPage: false,
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
    anchor: "the My Updates feed — unread rows dotted amber",
    alt: "The dashboard's My Updates feed — unread rows dotted amber, the unread count in the header, and Older Items linking to the full inbox",
    route: "/dashboard",
    // The station-board rebuild replaced the Notifications panel (per-card ✕,
    // Clear All header) with the My Updates feed: notifications and
    // department messages merged, an amber dot per unread row, and a clear
    // control only on persistent messages. The old selector waited on a
    // "Mark all as read" button that no longer exists anywhere on the page.
    prepare: async (page) => {
      const panel = page
        .locator("section.card:has(h3:has-text('My Updates'))")
        .first();
      await panel.waitFor({ timeout: 15_000 });
      await panel.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(600);
    },
    selector: "section.card:has(h3:has-text('My Updates'))",
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
    // Same blank-create-form false positive as 04-05 — the recurrence panel
    // this pictures is populated.
    allowEmptyState: true,
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
    alt: "A shift report card naming the trainee in its header, with the filing officer in the metadata row beneath it",
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
    alt: "The navigation sidebar as an ordinary member sees it, with the Training and Operations groups expanded",
    // As a MEMBER. This shot had no `auth` key, so it defaulted to the
    // administrator and published the admin sidebar — ADMINISTRATION section
    // and Department Setup included — under a caption promising "the
    // member-facing sections". 00-16's comment beside it recorded the
    // symptom without naming the cause: the two shots rendered "the same
    // picture" precisely because both were the same user.
    auth: "member",
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
    // The board spreads seven applicants across six stages, so some columns
    // read "No applicants", and a drawer for an applicant who has uploaded
    // nothing reads "No documents yet". Both are honest; the populated
    // check is Total Active.
    allowEmptyState: true,
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
    id: "00-23-login-two-factor",
    doc: "00-getting-started.md",
    line: 98,
    anchor: "The login page showing the two-factor",
    alt: "The login page's two-factor step — the 6-digit code field and the Use a recovery code link",
    route: "/login",
    auth: "anonymous",
    prepare: async (page) => {
      // The code step is one render branch keyed on `mfaRequired`, reached the
      // same way whether the first factor was a password or a returning OAuth
      // sign-in — so a password sign-in as the enrolled demo member puts the
      // page in exactly the state the guide is describing. `signIn` cannot be
      // reused: it waits to leave /login, which is precisely what a 2FA
      // account does not do.
      await page
        .getByLabel(/username|email/i)
        .first()
        .fill(DEMO_TWO_FACTOR_CREDENTIALS.username);
      await page
        .getByLabel(/password/i)
        .first()
        .fill(DEMO_TWO_FACTOR_CREDENTIALS.password);
      await page
        .getByRole("button", { name: /sign in|log ?in/i })
        .first()
        .click();
      const code = page.locator("#mfa-code");
      await code.waitFor({ timeout: 20_000 });
      await page.waitForTimeout(500);
    },
  },
  {
    id: "00-21-login-sso-options",
    doc: "00-getting-started.md",
    line: 85,
    anchor: "Login page showing the username/password fields",
    alt: "Login page with Google and Microsoft single sign-on choices",
    route: "/login",
    auth: "anonymous",
    beforeNavigate: async (page) => {
      // The UI needs only these booleans. Real client ids and secrets are
      // deliberately absent from the screenshot department.
      await page.route("**/api/v1/auth/oauth-config", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            googleEnabled: true,
            microsoftEnabled: true,
          }),
        });
      });
    },
  },
  {
    id: "03-97-shift-reminder-expanded",
    doc: "03-scheduling.md",
    line: 1887,
    anchor:
      "Screenshot of the notification inbox with a shift reminder expanded to show its crew and checklists",
    alt: "The notification inbox with a shift reminder expanded — the crew by position, the apparatus checklists, and a View Shift button — between collapsed cards showing only a summary line",
    route: "/notifications?tab=inbox",
    prepare: async (page) => {
      // 00-22 leaves a card pinned, and a pinned card sorts to the top. Clear
      // pins so this shot is about the expanded reminder, not that leftover.
      await page.evaluate(async () => {
        const listed = await fetch("/api/v1/notifications/my?limit=100", {
          credentials: "include",
        });
        const csrf =
          document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] ?? "";
        for (const log of ((await listed.json()).logs ?? []).filter(
          (l) => l.pinned,
        )) {
          await fetch(`/api/v1/notifications/my/${log.id}/pin?pinned=false`, {
            method: "POST",
            credentials: "include",
            headers: { "X-CSRF-Token": decodeURIComponent(csrf) },
          });
        }
      });
      await page.reload({ waitUntil: "networkidle" });

      const card = page
        .locator("div.card")
        .filter({ hasText: "Shift Reminder" })
        .first();
      await card
        .locator('button[aria-expanded="false"]')
        .first()
        .click({ timeout: 15_000 });
      await page.waitForTimeout(900);
    },
    fullPage: true,
  },
  {
    id: "00-22-notification-card-expanded",
    doc: "00-getting-started.md",
    line: 254,
    anchor:
      "Screenshot of the notifications inbox showing one card pinned and expanded",
    alt: "The notifications inbox — a shift assignment pinned and expanded to its details, View Shift button and Unpin control, the rest collapsed to a summary line",
    route: "/notifications?tab=inbox",
    prepare: async (page) => {
      // Pinning writes to the database, so a re-run would otherwise shoot the
      // pins left behind by the previous run stacked on top of this one's.
      // page.request shares the page's cookies, so this is the logged-in member.
      await page.evaluate(async () => {
        // /my, not /logs — the latter is the org-wide admin send log, which is
        // ordered differently and is not what this page reads.
        const listed = await fetch("/api/v1/notifications/my?limit=100", {
          credentials: "include",
        });
        const logs = (await listed.json()).logs ?? [];
        // The pin endpoint is state-changing, so it needs the double-submit
        // header the app's axios interceptor would normally attach.
        const csrf =
          document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] ?? "";
        for (const log of logs.filter((l) => l.pinned)) {
          await fetch(`/api/v1/notifications/my/${log.id}/pin?pinned=false`, {
            method: "POST",
            credentials: "include",
            headers: { "X-CSRF-Token": decodeURIComponent(csrf) },
          });
        }
      });
      await page.reload({ waitUntil: "networkidle" });

      // A shift assignment specifically, because it is the case the guide
      // describes: only notifications carrying an action_url render a CTA, and
      // this is the one whose CTA is "View Shift".
      const card = page
        .locator("div.card")
        .filter({ hasText: "New Shift Assignment" })
        .first();
      // Expand first — the Pin control lives inside the expanded panel, so
      // there is nothing to click until a card is open.
      // Scoped to the card, not the page: the sidebar's collapsible nav groups
      // also carry `aria-expanded`, and there are more of them than there are
      // notifications — an unscoped `.first()` clicks the navigation.
      await card
        .locator('button[aria-expanded="false"]')
        .first()
        .click({ timeout: 15_000 });
      await page.waitForTimeout(700);
      await card.locator('button[title="Pin notification"]').first().click({
        timeout: 15_000,
      });
      // Pinning re-sorts the list to put this card first; give the reorder a
      // moment before shooting.
      await page.waitForTimeout(1200);
    },
    fullPage: true,
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
    alt: "Account Settings on its Account tab — the tab row leads to password, security, emergency contacts, appearance and notifications",
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
    // "No applicants" is the per-column empty text, and a board that spreads
    // seven applicants across six stages necessarily leaves some columns
    // empty — that spread is the point of the shot. The board itself is
    // populated; check the Total Active card, not the column text.
    allowEmptyState: true,
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
    id: "01-35-applicant-drawer-final-stage",
    doc: "01-membership.md",
    line: 487,
    anchor: "A prospect detail drawer on the final stage",
    alt: "An applicant's drawer on the last stage of the pipeline — their details, the stage they are on, and Convert where Advance sits elsewhere",
    route: "/prospective-members",
    prepare: async (page) => {
      await page.waitForTimeout(2500);
      // The applicant on the final stage: the action bar's last button reads
      // Convert rather than Advance there, which is the whole point of the
      // shot, and the documents seeded onto this same applicant are below it.
      await page
        .locator("[role='button'][aria-label*='Bishop']")
        .first()
        .click({ timeout: 20_000 });
      await page.waitForTimeout(2500);
      await page
        .getByRole("button", { name: /^Convert$/ })
        .first()
        .waitFor({ timeout: 20_000 });
    },
    // The drawer itself, from its header down: taller than the viewport, so
    // the element rather than the screen.
    selector: "div.drawer-panel",
    // "No checklist data recorded yet" is the Checklist Progress section for
    // an applicant whose onboarding checklist has not been started. The shot
    // is about the final stage and its Convert action, both of which render.
    allowEmptyState: true,
  },
  {
    id: "01-34-desired-membership-type",
    doc: "01-membership.md",
    line: 480,
    anchor: "The Desired Membership Type cards in a prospect's detail drawer",
    alt: "Desired Membership Type — Regular Member selected, Administrative beside it as the alternative",
    route: "/prospective-members",
    prepare: async (page) => {
      await page.waitForTimeout(2500);
      await page
        .locator("[role='button'][aria-label]")
        .first()
        .click({ timeout: 20_000 });
      await page.waitForTimeout(2000);
      const section = page
        .locator("div:has(> h3:text-is('Desired Membership Type'))")
        .last();
      await section.waitFor({ timeout: 20_000 });
      await section.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(600);
    },
    // The pair, not one card: the point is that the other is one click away.
    selector: "div:has(> h3:text-is('Desired Membership Type'))",
  },
  {
    id: "01-33-import-review-rejected-rows",
    doc: "01-membership.md",
    line: 212,
    anchor: "The Import Members review step",
    alt: "The import review — the rows that will import, the rows that will not with their reasons, and the welcome-email choice",
    route: "/members/admin?tab=import",
    prepare: async (page) => {
      await page.waitForTimeout(2500);
      // A roster with real faults in it: a missing surname, a rank the
      // department does not have, a malformed address and a duplicate email.
      // The file never leaves the browser — the review step is reached without
      // importing anything, and this stops short of the Import button.
      const header = [
        "firstName",
        "lastName",
        "membershipNumber",
        "username",
        "dateOfBirth",
        "email",
        "joinDate",
        "rank",
        "emergencyName1",
        "emergencyRelationship1",
        "emergencyPhone1",
      ];
      const rows = [
        [
          "Wren",
          "Adisa",
          "241",
          "wadisa",
          "1994-02-11",
          "wren.adisa@example.org",
          "2026-02-01",
          "firefighter",
          "Ada Adisa",
          "Sister",
          "555-0142",
        ],
        [
          "Tomas",
          "Vlk",
          "242",
          "tvlk",
          "1990-07-03",
          "tomas.vlk@example.org",
          "2026-02-01",
          "emt",
          "Petra Vlk",
          "Spouse",
          "555-0143",
        ],
        [
          "Ines",
          "",
          "243",
          "ifer",
          "1988-11-30",
          "ines.ferreira@example.org",
          "2026-02-01",
          "firefighter",
          "Luis Ferreira",
          "Father",
          "555-0144",
        ],
        [
          "Bo",
          "Nakashima",
          "244",
          "bn",
          "1996-05-19",
          "bo.nakashima@example.org",
          "2026-02-01",
          "Engine Operator",
          "Rei Nakashima",
          "Mother",
          "555-0145",
        ],
        [
          "Hala",
          "Zayed",
          "245",
          "hzayed",
          "not-a-date",
          "hala.zayed@example.org",
          "2026-02-01",
          "emt",
          "Omar Zayed",
          "Brother",
          "555-0146",
        ],
        [
          "Petr",
          "Vlk",
          "246",
          "pvlk",
          "1992-09-08",
          "tomas.vlk@example.org",
          "2026-02-01",
          "firefighter",
          "Jana Vlk",
          "Spouse",
          "555-0147",
        ],
      ];
      const csv = [header, ...rows].map((line) => line.join(",")).join("\n");
      await page.locator('input[data-testid="csv-file-input"]').setInputFiles({
        name: "roster.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv, "utf8"),
      });
      await page.waitForTimeout(2500);
      const rejected = page.getByText(/row\(s\) will not be imported/);
      await rejected.waitFor({ timeout: 20_000 });
      await rejected.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(600);
    },
    viewport: { width: 1400, height: 1100 },
  },
  {
    id: "01-32-duplicate-applicant-warning",
    doc: "01-membership.md",
    line: 1055,
    anchor: "The duplicate check shown before an applicant is created",
    alt: "The duplicate warning — the name and email match an existing member, with Create anyway and Go back",
    route: "/prospective-members",
    prepare: async (page) => {
      await page.waitForTimeout(2500);
      await page
        .getByRole("button", { name: /Add Applicant|Add Prospect/ })
        .first()
        .click({ timeout: 20_000 });
      await page.waitForTimeout(1200);
      const modal = page.locator("div.fixed.inset-0 > div").first();
      // A serving member's own name and address, which is what makes the check
      // fire. The dialog is raised *before* anything is written, so this stops
      // one click short of creating the duplicate it is warning about.
      const inputs = modal.locator("input");
      await inputs.nth(0).fill("Nadia");
      await inputs.nth(1).fill("Belhaj");
      await inputs.nth(2).fill("nbelhaj@oakvillefd.example.org");
      await page.waitForTimeout(400);
      await modal
        .getByRole("button", { name: /Add to Pipeline/ })
        .click({ timeout: 20_000 });
      await page.waitForTimeout(2000);
      await page
        .getByText(/This may be a duplicate/)
        .first()
        .waitFor({ timeout: 20_000 });
      await page.waitForTimeout(600);
    },
    selector: "div[role='dialog'], div.fixed.inset-0 > div",
  },
  {
    id: "01-31-applicant-documents",
    doc: "01-membership.md",
    line: 422,
    anchor: "The prospect detail drawer's documents area",
    alt: "An applicant's documents — each with its type, size and upload date, and a link that downloads it",
    route: "/prospective-members",
    prepare: async (page) => {
      await page.waitForTimeout(2500);
      // The applicant whose paperwork the seeder files — the one furthest
      // along the pipeline, since an applicant at the first stage with their
      // ID already on file would say the wrong thing about the process.
      await page
        .locator("[role='button'][aria-label*='Bishop']")
        .first()
        .click({ timeout: 20_000 });
      await page.waitForTimeout(2000);
      const section = page
        .locator("div:has(> div > h3:text-is('Documents'))")
        .last();
      await section.waitFor({ timeout: 20_000 });
      await section.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(600);
    },
    selector: "div:has(> div > h3:text-is('Documents'))",
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
    // The board spreads seven applicants across six stages, so some
    // columns read "No applicants" — and the drawer reads "No documents
    // yet" for an applicant who has uploaded none. Both are honest, and
    // neither means the page is empty; check Total Active.
    allowEmptyState: true,
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
    // The board spreads seven applicants across six stages, so some
    // columns read "No applicants" — and the drawer reads "No documents
    // yet" for an applicant who has uploaded none. Both are honest, and
    // neither means the page is empty; check Total Active.
    allowEmptyState: true,
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
    // "No EVOC level" is this select's placeholder option — in the DOM on
    // every operator, including this one, which has Level 1 selected.
    allowEmptyState: true,
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
      "Screenshot of the External Training Integrations page showing a saved provider card with",
    alt: "The Integrations tab with a saved provider — its platform, last sync, auto-sync interval and sync actions",
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
    id: "02-02-historical-import-preview",
    doc: "02-training.md",
    line: 1480,
    anchor:
      "Screenshot of the historical import page showing the file upload area",
    alt: "The historical-import wizard on its Preview step: parsed rows, matched members, and the confirm button",
    route: "/training/admin?page=setup&tab=import",
    prepare: async (page) => {
      // A CSV built here rather than committed: the importer matches rows to
      // members by email, so the file has to name members this department
      // actually has, and those are minted per seed run.
      const csv = [
        "email,course_name,completion_date,hours,training_type,certification_number,expiration_date,instructor,location,score,notes",
        "isolberg@oakvillefd.example.org,Firefighter I,2024-01-15,40,certification,FF-12345,2026-01-15,Chief Ruiz,Station 1,95,Annual certification",
        "ytanaka@oakvillefd.example.org,EMT Refresher,2024-03-20,8,refresher,,,Dr. Jones,Training Center,,Quarterly refresher",
        "hvance@oakvillefd.example.org,Pump Operations,2024-05-02,12,certification,PO-8891,2027-05-02,Capt. Frazier,Station 1,88,",
        "jwhitfield@oakvillefd.example.org,Hazmat Awareness,2024-06-11,6,refresher,,,Chief Ruiz,Training Center,,",
      ].join("\n");
      // The wizard defaults to matching on membership number, and rejects an
      // email-keyed file outright — "CSV must contain a 'membership_number'
      // column". Choose the match mode before uploading.
      await page.getByText("Email Address", { exact: true }).first().click();
      await page.waitForTimeout(600);
      await page.setInputFiles('input[type="file"]', {
        name: "historical-training-2024.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv, "utf8"),
      });
      await page.waitForTimeout(2_000);
      // Upload -> Map courses -> Preview. The wizard advances on its own
      // button rather than by step number.
      for (let step = 0; step < 2; step += 1) {
        const next = page
          .getByRole("button", { name: /Continue to (Course Mapping|Preview)/ })
          .first();
        if (!(await next.count())) break;
        await next.click();
        await page.waitForTimeout(1_500);
      }
    },
    fullPage: true,
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
    holdBack:
      "Category mappings are created only by POST /providers/{id}/sync-categories, " +
      "which fetches the live vendor catalogue — no seeder-reachable create " +
      "exists, so the capture lands on the provider card, not the mapping " +
      "table the caption describes. See SCREENSHOT_CURRENCY.md, 'Held back " +
      "deliberately'.",
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
    alt: "The shift patterns page — each pattern with its type badge, rotation settings and Generate Shifts action",
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

  {
    id: "03-59-supply-worklist",
    doc: "03-scheduling.md",
    line: 894,
    anchor:
      "Screenshot of the Expiring on Apparatus page with the three summary pills",
    alt: "Expiring on Apparatus: the summary pills, the 30/60/90 window, and three rows — one expiring, one reported used, one short of par",
    route: "/scheduling/supply/expiring",
    fullPage: true,
    // "No stock" is the per-row label on the deliberately-unlinked traffic
    // cones position ("No stock · Not linked to inventory") — the page's
    // summary pills and the other rows are populated.
    allowEmptyState: true,
  },

  {
    id: "03-60-report-used-sheet",
    doc: "03-scheduling.md",
    line: 880,
    anchor:
      'Screenshot of the "report used" sheet on a phone showing the quantity stepper',
    alt: "The Flag sheet on a counted position — it raises the restock report with an optional note, leaving the count to the minus button",
    auth: "member",
    route: "/scheduling/apparatus-inventory",
    viewport: "mobile",
    prepare: async (page) => {
      await selectMedicApparatus(page);
      // "Flag" on a counted position, "Used" on one with no target — the same
      // report by either name, so match both rather than assuming which the
      // seeder produced for the first row.
      const trigger = page
        .getByRole("button", { name: /^(Flag|Used)$/ })
        .first();
      await trigger.waitFor({ timeout: 20_000 });
      await trigger.click();
      await page.waitForTimeout(900);
    },
    fullPage: false,
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
    // "No reminders" is a line inside the notification defaults on a blank
    // create form; the Reminder Schedule beside it carries its 1-day chip and
    // the audience selector the caption is about.
    allowEmptyState: true,
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

  {
    id: "05-53-items-grid-lot-stock",
    doc: "05-inventory.md",
    line: 662,
    anchor:
      "Screenshot of the inventory items grid with two consumable rows visible",
    alt: 'Items grid showing a lot-stocked Qty labelled "in-date lots" beside a plain pool figure',
    // Needs `seed_supply_tracking` to have run: without dated lots on at least
    // one item every row reports the pool figure and the two ledgers cannot be
    // told apart, which is the entire subject of the caption.
    route: "/inventory/items",
    prepare: async (page) => {
      // Filtered to a term matching both ledgers. The grid is alphabetical and
      // the lot-stocked consumables sit mid-list, so an unfiltered shot shows
      // one kind or the other depending on where the fold lands — and the whole
      // claim is that the two are distinguishable side by side.
      const search = page.getByPlaceholder(/search/i).first();
      await search.waitFor({ timeout: 20_000 });
      await search.fill("s");
      await page.waitForTimeout(1_800);
    },
    // Slightly taller than the default frame so the last row in view is a whole
    // row: at 900px the fold lands through "in-date lots" and reads as a
    // clipped control rather than a list that continues.
    viewport: { width: 1440, height: 1010 },
    fullPage: false,
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
      "Screenshot of the Organization Settings page showing the department name, timezone,",
    alt: "Organization Settings page with department name, timezone and contact details",
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

  {
    id: "08-64-email-footers-tab",
    doc: "08-admin-reports.md",
    line: 1516,
    anchor: "Screenshot of the Footers tab showing the three seeded footers",
    alt: "The Footers tab: the seeded library, the default marked, and a per-footer usage count",
    // `?tab=footers` only started working on 2026-08-11. The page held its tab
    // in plain state before that, so this shot would have silently captured the
    // Templates tab — the same way `02-21` and `02-41` came to be byte-identical.
    route: "/communications/email-templates?tab=footers",
    // The whole page: the guide's claim is about the *library* — three footers,
    // one of them the default — and a single viewport holds one and a half.
    fullPage: true,
    // The empty-state detector fires on "No templates close with this footer",
    // which is the honest count beside a footer nobody has assigned yet, not a
    // page that failed to load.
    allowEmptyState: true,
  },

  {
    id: "08-68-compliance-dashboard",
    doc: "08-admin-reports.md",
    line: 1001,
    anchor:
      "Screenshot of the ComplianceDashboard showing compliance rate cards",
    alt: "The medical-screening Compliance tab: a rate card per screening type, with expiring and overdue called out",
    // `?tab=compliance` only started working on 2026-08-11. The page held its
    // tab in plain state before that, so this shot would have silently
    // captured the Requirements tab — the way `02-21`/`02-41` came to be
    // byte-identical images under different captions.
    route: "/medical-screening?tab=compliance",
    fullPage: true,
  },
  {
    id: "08-69-compliance-requirements-config",
    doc: "08-admin-reports.md",
    line: 1044,
    anchor:
      "Screenshot of the ComplianceRequirementsConfigPage showing the threshold configuration",
    alt: "Compliance requirements configuration: the thresholds at the top and the profiles beneath them",
    route: "/training/compliance-config",
    fullPage: true,
  },
  {
    id: "08-70-compliance-profiles",
    doc: "08-admin-reports.md",
    line: 1044,
    // Applied by hand: the placeholder this replaces was a bullet list, not a
    // `> _[Screenshot …]_` block, so there was nothing for the anchor matcher
    // to find.
    anchor: "Set **priority** — when a member matches multiple profiles",
    alt: "The Profiles tab: each profile with the groups it targets and the requirements it demands",
    // `?tab=profiles` only started working on 2026-08-11 — plain state before
    // that, so this shot would have silently captured the Thresholds tab.
    route: "/training/compliance-config?tab=profiles",
    fullPage: true,
  },
  {
    id: "08-71-compliance-report-history",
    doc: "08-admin-reports.md",
    line: 1061,
    anchor:
      "Screenshot of the report generation dialog showing report type selector",
    alt: "Generating a compliance report: the type selector, the email switch and the extra recipients field",
    route: "/training/compliance-config?tab=reports",
    fullPage: true,
  },
  {
    id: "08-65-template-footer-selector",
    doc: "08-admin-reports.md",
    line: 1521,
    anchor:
      "Screenshot of the email template editor with the footer selector visible",
    alt: "The template editor's Closes with selector, set to the Public footer, with that footer's own description under it",
    route: "/communications/email-templates",
    prepare: async (page) => {
      const select = page.locator("#template-footer");
      await select.waitFor({ timeout: 20_000 });
      // Changing the select only moves component state — nothing is written
      // until Save, which is deliberately not clicked. Picking Public rather
      // than leaving the default is the point: the hint under the control
      // swaps to the chosen footer's own description, which is how an
      // administrator tells the three apart without opening the Footers tab.
      await select.selectOption("public");
      await page.waitForTimeout(800);
      await select.scrollIntoViewIfNeeded().catch(() => {});
    },
  },
  {
    id: "08-66-template-variable-palette",
    doc: "08-admin-reports.md",
    line: 1558,
    anchor: "Screenshot of the template editor's variable palette expanded",
    alt: "The Available Variables palette expanded, the organization variables among the rest",
    route: "/communications/email-templates",
    prepare: async (page) => {
      await clickByName(/^Available Variables \(\d+\)$/)(page);
      await page.waitForTimeout(800);
    },
    // Not `fullPage`: this page's template list runs to sixty entries, so a
    // full-page shot is 2,700px tall to picture a panel that occupies 250 of
    // them.
    fullPage: false,
  },
  {
    id: "08-67-email-preview-design",
    doc: "08-admin-reports.md",
    line: 1600,
    anchor:
      "Screenshot of the email preview pane showing the new white-card-on-grey design",
    alt: "The rendered preview: a white card on grey, its header band, details table and footer",
    route: "/communications/email-templates",
    // The Preview tab, not the editor: the two are alternate views of the same
    // panel and cannot both be on screen.
    prepare: async (page) => {
      // "Shift Assignment" rather than whichever template the list opens on.
      // The footer only renders where the body contains `{{footer_html}}`, and
      // most of the shipped bodies predate footers — a preview of one of those
      // would picture the design without the closing block the guide points at.
      await page.getByText("Shift Assignment", { exact: true }).first().click();
      await page.waitForTimeout(1_000);
      await clickByName(/^Preview$/)(page);
      await page.waitForTimeout(2_000);
      await page
        .getByText(/automated message from|Sent by/i)
        .first()
        .scrollIntoViewIfNeeded({ timeout: 10_000 })
        .catch(() => {});
    },
    // Not `fullPage`: the sixty-entry template list makes the page 2,700px
    // tall, and the rendered message sits entirely in the first viewport.
    fullPage: false,
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
    alt: "Officer review queue — completed results awaiting validation, each row with its accept, notify and void controls and a bulk Accept above them",
    // ?page=skills-testing, like 09-14: the bare ?tab=tests now lands on
    // the admin hub's default section instead of the test records.
    route: "/training/admin?page=skills-testing&tab=tests",
    fullPage: true,
    // The queue is a filter on the records tab rather than a page of its own,
    // and it is an option in the status dropdown — not a button or a tab — so
    // the shot has to select it. Without this the capture shows "All Statuses"
    // and pictures the whole history instead of the queue.
    prepare: async (page) => {
      // Picked by the option it must offer, not by being the first select on
      // the page -- the admin hub grew a section navigator ("Dashboard /
      // Records / Setup / ...") which now holds that position, and selecting
      // pending_validation on it timed out with the status filter untouched a
      // few hundred pixels away.
      const status = page
        .locator("select")
        .filter({ has: page.locator('option[value="pending_validation"]') })
        .first();
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
    prepare: openPublicForm,
  },
  {
    id: "10-13-mobile-header-menu",
    doc: "10-mobile-pwa.md",
    line: 140,
    anchor: "Re-shoot of the phone header showing the ☰ button",
    alt: "Phone header with the menu button at the left edge and the department name beside it",
    route: "/dashboard",
    viewport: "mobile",
    // Clipped to the header: the placeholder is about where one button sits,
    // and a whole-phone shot buries it above a screen of dashboard.
    selector: 'header[role="banner"].md\\:hidden',
    allowEmptyState: true,
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
    id: "10-14-scan-camera-denied",
    doc: "10-mobile-pwa.md",
    line: 547,
    anchor:
      "Screenshot of the MemberScanPage on a mobile device showing a camera error banner",
    alt: "Member ID scan on a phone after the camera is refused — the red banner naming the failure, with Start Scanning still offered",
    route: "/members/scan",
    // A tall phone rather than `viewport: "mobile"` + `fullPage`: the bottom
    // tab bar is `position: fixed`, and a full-page shot paints it once at its
    // viewport offset — across the "How to use" card that tells a member what
    // to do next, which is half the point of picturing the failure.
    viewport: { width: 390, height: 1100 },
    prepare: async (page) => {
      // No fake media device is configured, so `getUserMedia` rejects and the
      // page renders its own failure banner. That is the point of the shot:
      // the state a member reaches by declining the permission prompt is the
      // one the guide has to describe, and it is the only camera state this
      // harness can reach honestly — a webcam feed cannot be photographed on a
      // headless runner, and faking one would picture a scan that never
      // happened.
      await page
        .getByRole("button", { name: /^Start Scanning$/ })
        .click({ timeout: 20_000 });
      await page.waitForTimeout(2_500);
    },
    fullPage: false,
  },
  {
    id: "10-15-mobile-menu-notifications",
    doc: "10-mobile-pwa.md",
    line: 578,
    anchor:
      "Screenshot of the mobile top navigation bar showing the hamburger menu",
    alt: "The phone menu open, with the unread count on the Notifications entry",
    route: "/dashboard",
    viewport: "mobile",
    prepare: async (page) => {
      // Where the unread count actually lives on a phone. The collapsed bar
      // carries no bell — it is logo, department name and hamburger — so the
      // badge is only reachable with the menu open, and a shot of the bar
      // alone would picture the absence rather than the feature.
      await page
        // "Open full navigation menu" today; the two older labels are kept so
        // this does not break again the next time it is reworded. The control
        // moved into the bottom bar, so the phone header carries no hamburger
        // and matching the old name alone timed out with the button on screen.
        .getByRole("button", {
          name: /Open (full navigation|main|navigation) menu/,
        })
        .first()
        .click({ timeout: 20_000 });
      await page.waitForTimeout(1_200);
      // The drawer scrolls, and Notifications sits below the fold on a 390-wide
      // phone -- the shot came back showing Dashboard through Operations and
      // then the theme controls, with the badge the caption is about never in
      // frame. Scrolling to it is what a member does, and it keeps the shot
      // honest about how far down the entry actually is.
      await page
        .getByRole("button", { name: /^Notifications/ })
        .first()
        .scrollIntoViewIfNeeded({ timeout: 10_000 });
      await page.waitForTimeout(600);
    },
    fullPage: false,
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
    id: "10-16-mobile-item-detail",
    doc: "10-mobile-pwa.md",
    line: 613,
    anchor:
      "Screenshot of an inventory item's detail page on a phone showing its cards stacked",
    alt: "An inventory item's detail page on a phone — the status and condition badges under the name, with the Basic Info and Location cards stacked",
    route: "/inventory/items",
    prepare: openFirstFromApi(
      "/inventory/items?limit=200",
      (id) => `/inventory/items/${id}`,
      "items",
      // The gas monitor the walkthrough scans. Named rather than taken first
      // so the shot matches the story around it.
      (item) => item.name === "Gas Meter",
    ),
    // Deliberately not fullPage. The bottom nav is `position: fixed`, and a
    // full-page capture is stitched from several viewport shots with fixed
    // elements painted at their document offset — so on a page this long the
    // nav bar lands across the middle of the image, over real content. One
    // viewport is also the truer picture of a phone.
    viewport: { width: 390, height: 1000 },
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
    // The board spreads seven applicants across six stages, so some columns
    // read "No applicants", and a drawer for an applicant who has uploaded
    // nothing reads "No documents yet". Both are honest; the populated
    // check is Total Active.
    allowEmptyState: true,
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
    id: "08-73-template-builder-preview",
    doc: "08-admin-reports.md",
    line: 1308,
    anchor:
      "Screenshot of the equipment check template builder's Preview showing how the check form",
    alt: "The template builder's Preview — the check form drawn inside a phone frame, as a crew would see it",
    route: "/scheduling/equipment-check-templates",
    prepare: async (page) => {
      await openFirstFromApi(
        "/equipment-checks/templates",
        (id) => `/scheduling/equipment-check-templates/${id}`,
        "templates",
        (template) => template.name === "Engine Daily Check",
      )(page);
      await clickByName("Preview")(page);
      await page.waitForSelector("text=Safety Equipment", { timeout: 20_000 });
      await page.waitForTimeout(500);
    },
    // The phone frame itself, not the dimmed page behind it.
    selector: "div.fixed.inset-0.z-50 > div",
    viewport: { width: 1440, height: 1300 },
  },
  {
    id: "08-72-report-stage-groups",
    doc: "08-admin-reports.md",
    line: 261,
    anchor:
      "Screenshot of the ReportStageGroupsEditor showing the configured groups",
    alt: "The Report Stage Groups editor — three named groups, the stages in each, and the controls that add and remove them",
    route: "/prospective-members/settings",
    prepare: async (page) => {
      await openPipelineSettings()(page);
      const heading = page.getByText("Report Stage Groups", { exact: true });
      await heading.waitFor({ timeout: 15_000 });
      await heading.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    },
    // Clipped to the editor's own card. The settings page is long and the
    // panel is a small part of it; 15-10 already shows the page whole.
    // The editor's own root: the heading sits two levels in, and the wrapper
    // the settings page puts around it is the card with the border.
    selector: 'div:has(> div > div > h3:text-is("Report Stage Groups"))',
    viewport: { width: 1440, height: 1200 },
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
  {
    id: "16-07-calendar-subscribe",
    doc: "16-integrations.md",
    line: 339,
    anchor:
      "Screenshot of the Subscribe to my shifts card expanded on My Shifts",
    alt: "The Subscribe to my shifts card expanded — the member's private feed URL, its copy button and the reset control",
    // Not on /integrations. The ICS feed is a per-member subscription that
    // lives on My Shifts; the Integrations catalog only advertises it.
    route: "/scheduling?tab=my-shifts",
    auth: "member",
    prepare: async (page) => {
      await clickByName("Subscribe to my shifts")(page);
      // The token is minted on first open, so the URL field does not exist
      // until that round trip lands.
      await page.getByLabel("Calendar subscription URL").waitFor({
        timeout: 20_000,
      });
      await page.waitForTimeout(400);
    },
    selector: 'div.card:has([aria-label="Calendar subscription URL"])',
  },

  // ── 17 Privacy & Data Rights ────────────────────────────────────────
  {
    id: "17-01-privacy-choices",
    doc: "17-privacy-data-rights.md",
    line: 43,
    anchor:
      "Screenshot of Settings → Security showing the Privacy Choices section with three",
    alt: "Account security settings showing the privacy choices section",
    // Privacy Choices lives on the Security tab; this shot was landing on
    // Account, byte-identical to 00-09-account-settings. Note the canonical
    // path: /settings/account is a <Navigate to="/account"> with no query, so
    // React Router drops ?tab= on the redirect and the param never arrives.
    route: "/account?tab=security",
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
    // Bare /training/admin lands on the Dashboard overview, so this and
    // 02-41 captured the same default tab under two different captions —
    // byte-identical files, neither showing what it claims. The hub keys
    // this view as expiring-certs (page=dashboard).
    route: "/training/admin?tab=expiring-certs",
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
    id: "03-73-flat-check-form-header",
    doc: "03-scheduling.md",
    line: 1931,
    anchor:
      "Screenshot of the flat equipment check form on a mobile device showing a compartment header",
    alt: "The flat check form on a phone — a compartment heading, a bold section header beneath it, and the items it groups",
    route: "/scheduling?tab=equipment-checks",
    auth: "member",
    prepare: async (page) => {
      await clickByName("Unscheduled checklist")(page);
      await clickByName("Engine Daily Check")(page);
      // The section header seeded into Cab by `_add_section_header`. Waiting
      // on it rather than on the compartment name is the point: without it the
      // shot is a checklist with nothing to picture.
      await page.waitForSelector("text=Safety Equipment", { timeout: 20_000 });
      await page.waitForTimeout(500);
    },
    viewport: { width: 390, height: 1050 },
  },
  {
    id: "03-72-check-item-controls",
    doc: "03-scheduling.md",
    line: 850,
    anchor:
      "Screenshot of the equipment check form on a mobile device showing check items with",
    alt: "Check items on a phone — a quantity stepper, the note panel open with its photo button, and a pass/fail item below",
    route: "/scheduling?tab=equipment-checks",
    auth: "member",
    prepare: async (page) => {
      await clickByName("Unscheduled checklist")(page);
      await clickByName("Medic 3 Supply Check")(page);
      await page.waitForSelector("text=Trauma Bag", { timeout: 20_000 });

      // The photo button lives inside the note panel, so the note has to be
      // open for it to exist at all. `:near` rather than an index: the Note
      // buttons are identical and unlabelled, and an index would move the
      // moment the seeded template gains an item.
      await page
        .locator(
          'button:has-text("Note"):near(:text-is("Nitrile Gloves — Large"), 160)',
        )
        .first()
        .click({ timeout: 15_000 });
      await page.getByLabel("Upload photo for Nitrile Gloves — Large").waitFor({
        state: "attached",
        timeout: 15_000,
      });

      // Put that item at the top of the frame, so the shot runs from its
      // quantity stepper down through the pass/fail item beneath it.
      await page.evaluate(() => {
        const heading = Array.from(document.querySelectorAll("span")).find(
          (node) => node.textContent === "Nitrile Gloves — Large",
        );
        if (heading) heading.scrollIntoView({ block: "start" });
        // `block: "start"` puts the heading under the sticky app bar and the
        // check's own header; back off far enough that the item's name and its
        // quantity stepper are both in frame.
        window.scrollBy(0, -190);
      });
      await page.waitForTimeout(500);
    },
    viewport: { width: 390, height: 900 },
  },
  {
    id: "03-71-set-all-to-par-confirm",
    doc: "03-scheduling.md",
    line: 1113,
    anchor:
      'Screenshot of the "Set All to Par" confirmation dialog naming the items whose counts',
    alt: "The Set All to Par confirmation, naming each item it would raise and by how much",
    route: "/scheduling?tab=equipment-checks",
    auth: "member",
    prepare: async (page) => {
      await clickByName("Unscheduled checklist")(page);
      await clickByName("Medic 3 Supply Check")(page);
      await page.waitForSelector("text=Trauma Bag", { timeout: 20_000 });

      // Compartments start collapsed apart from one, and which one is not
      // fixed, so Trauma Bag's items may or may not be in the DOM: the wait
      // above passes on the header alone and the stepper lookup below then
      // timed out against a compartment that was merely closed. Toggling
      // blindly is worse than not toggling -- it closes an already-open one.
      // Read aria-expanded and only click when it needs opening.
      const traumaBag = page
        .getByRole("button", { name: /^Trauma Bag, / })
        .first();
      await traumaBag.waitFor({ state: "visible", timeout: 20_000 });
      if ((await traumaBag.getAttribute("aria-expanded")) !== "true") {
        await traumaBag.click({ timeout: 10_000 });
      }
      // Wait for the stepper rather than assuming it is painted. When this
      // once came back as pass/fail buttons the cause was a backend left
      // running across a deploy, still serving the pre-canonical check-type
      // spellings; the read boundary normalizes them now, and failing here is
      // the signal that something upstream is serving the old shape again.
      await page
        .getByLabel(/^(One fewer|Decrease) Nitrile Gloves/)
        .first()
        .waitFor({ state: "visible", timeout: 20_000 });

      // Trauma Bag arrives with one item already short (gauze, 18 of 24).
      // Counting the gloves down gives the dialog a second row, which is what
      // it is for — a single-item warning reads as a quirk, two reads as the
      // claim it actually is.
      // "One fewer <item>" since the stepper moved into CheckItemControls;
      // the older "Decrease <item> quantity" spelling is kept alongside it so a
      // rename does not silently cost the shot again.
      const decrease = page
        .getByLabel("One fewer Nitrile Gloves — Large")
        .or(page.getByLabel("Decrease Nitrile Gloves — Large quantity"))
        .first();
      await decrease.scrollIntoViewIfNeeded();
      for (let i = 0; i < 2; i += 1) {
        await decrease.click();
        await page.waitForTimeout(150);
      }

      await page.getByLabel("Set all items in Trauma Bag to par").click();
      await page.waitForSelector(
        "text=Only do this if you have actually restocked.",
        {
          timeout: 15_000,
        },
      );
      await page.waitForTimeout(400);
    },
    selector: '[role="dialog"]',
    viewport: { width: 390, height: 1000 },
  },
  {
    id: "03-70-check-form-carryover",
    doc: "03-scheduling.md",
    line: 1092,
    anchor:
      "Screenshot of the equipment check form on a phone showing the carry-over banner",
    alt: "The check form's carry-over banner above a compartment of quantity items, each reading against par with its unit and none yet marked",
    route: "/scheduling?tab=equipment-checks",
    auth: "member",
    prepare: async (page) => {
      // A check does not need a shift. "Unscheduled checklist" offers every
      // active template, which is the only way to reach the medic's supply
      // check — no seeded shift runs on M-3, and the engines' checklists are
      // pass/fail throughout with no counts to carry over.
      await clickByName("Unscheduled checklist")(page);
      await clickByName("Medic 3 Supply Check")(page);
      await page.waitForSelector("text=Drug Bag", { timeout: 20_000 });
      await page.waitForTimeout(600);
    },
    // Not fullPage: the whole checklist is eight items and four screens tall,
    // and the subject is the top of it — the banner, the progress counter and
    // the first compartment's counts.
    viewport: { width: 390, height: 1000 },
  },
  {
    id: "03-69-catalog-quick-add",
    doc: "03-scheduling.md",
    line: 1055,
    anchor:
      "Screenshot of the template builder's quick-add bar with a partial search term typed",
    alt: "The template builder's quick-add bar, its catalog matches listed beneath and the create-in-inventory option under them",
    route: "/scheduling/equipment-check-templates",
    prepare: async (page) => {
      await openFirstFromApi(
        "/equipment-checks/templates",
        (id) => `/scheduling/equipment-check-templates/${id}`,
        "templates",
        (template) => template.name === "Engine Daily Check",
      )(page);
      const search = page
        .getByPlaceholder("Search inventory or type a new item name…")
        .first();
      await search.waitFor({ timeout: 20_000 });
      // Typed, not filled: the search is debounced off change events, and a
      // programmatic value set fires none of them.
      await search.click();
      await search.type("SCBA", { delay: 80 });
      // "SCBA" matches two catalog items and is nobody's exact name, so both
      // halves of the dropdown are on screen — the matches and the offer to
      // create what was typed.
      await page.waitForSelector("text=SCBA Spare Cylinder", {
        timeout: 20_000,
      });
      await page.waitForTimeout(400);
    },
    // The dropdown is absolutely positioned and overflows the compartment, so
    // clip generously around the bar rather than to it.
    viewport: { width: 1440, height: 1100 },
  },
  {
    id: "03-68-inventory-match-dialog",
    doc: "03-scheduling.md",
    line: 1058,
    anchor:
      "Screenshot of the bulk inventory-match dialog listing the unlinked positions",
    alt: "The bulk inventory-match dialog — coverage in the header, exact matches pre-selected, a close match left for the reader to decide",
    // Engine Daily Check is the seeded template written before the catalog link
    // existed: nine positions, none of them linked. Medic 3 is mostly linked
    // already and would open this dialog on three rows.
    route: "/scheduling/equipment-check-templates",
    prepare: async (page) => {
      await openFirstFromApi(
        "/equipment-checks/templates",
        (id) => `/scheduling/equipment-check-templates/${id}`,
        "templates",
        (template) => template.name === "Engine Daily Check",
      )(page);
      // The coverage button carries the count, so match on the link icon's
      // own title rather than a label that changes with the data.
      await page.click('button[title*="not linked to inventory"]', {
        timeout: 20_000,
      });
      await page.waitForSelector(
        "text=exact name matches are selected for you",
        {
          timeout: 20_000,
        },
      );
    },
    selector: '[role="dialog"]',
    viewport: { width: 1440, height: 1200 },
  },
  {
    id: "03-67-swap-request-dialog",
    doc: "03-scheduling.md",
    line: 291,
    anchor:
      "Screenshot of the Request Shift Swap dialog with Specific Shift chosen",
    alt: "The Request Shift Swap dialog — the two swap-type cards, the shift picker and the reason field",
    route: "/scheduling?tab=my-shifts",
    prepare: async (page) => {
      // The Swap button only exists on the Upcoming view, which is the
      // default; one per assignment, so take the first.
      await clickByName("Swap")(page);
      await page.waitForSelector("#swap-reason", { timeout: 15_000 });
      // Open Swap is the default and hides the picker. The picker is half of
      // what this dialog is about, so pick the other branch — and give the
      // shift list, fetched when the dialog opened, a moment to arrive so the
      // select is not photographed reading "Loading shifts...".
      await clickByName("Specific Shift")(page);
      await page.waitForFunction(
        () => {
          const select = document.querySelector("#swap-target-shift");
          return (
            !!select && select.options.length > 0 && select.value !== "pick"
          );
        },
        { timeout: 15_000 },
      );
    },
    selector: '[role="dialog"] > div',
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
    // The page opens on Member Hours with an empty picker and "Select a Date
    // Range" where the report goes, so a plain route visit captured a
    // placeholder rather than the compliance report the placeholder asks for.
    //
    // Each tab carries its own filter bar, so the controls here are the
    // compliance tab's, not the ones visible on arrival: a single optional
    // Reference Date (no range), and a button reading "Check Compliance"
    // rather than "Generate Report". Its results are gated on hasSearched,
    // which only the submit sets — the date alone renders nothing.
    prepare: async (page) => {
      await page
        .getByRole("tab", { name: /shift compliance/i })
        .click({ timeout: 10_000 });
      await page
        .getByRole("button", { name: /check compliance/i })
        .click({ timeout: 10_000 });
      // Wait for the results themselves, not for the placeholder to vanish:
      // loadCompliance sets hasSearched *before* awaiting the fetch, so the
      // empty state disappears on click and a "hidden" wait resolves instantly
      // — asserting nothing, and happily shooting an errored or empty response
      // under the compliance caption. The filter toggle renders only in the
      // results branch, so it is the real signal.
      await page
        .getByRole("button", { name: /non-compliant only/i })
        .waitFor({ state: "visible", timeout: 20_000 });
    },
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
    id: "05-13-issue-allowance-exceeded",
    doc: "05-inventory.md",
    line: 324,
    anchor:
      'Screenshot of the pool-item issue dialog showing an "allowance exceeded" warning',
    alt: 'Pool item issue dialog warning that the quantity exceeds the member’s uniform allowance, with the "Override allowance" checkbox',
    route: "/inventory/admin/pool",
    prepare: async (page) => {
      // Job Shirt is a Uniforms pool item, and the seeder has already spent 2
      // of the demo member's 3 annual uniform allowance — so asking for 2 is
      // one over, which is what the warning is about.
      const heading = page
        .getByRole("heading", { name: "Job Shirt", exact: true })
        .first();
      await heading.waitFor({ timeout: 20_000 });
      await heading.scrollIntoViewIfNeeded();
      // The list is a card grid, not a table — walk up to the card and take
      // its own Issue button rather than the first one on the page.
      const card = heading.locator(
        "xpath=ancestor::div[contains(@class,'card-secondary')][1]",
      );
      await card
        .getByRole("button", { name: /^Issue$/ })
        .first()
        .click();
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ timeout: 20_000 });
      await dialog.getByPlaceholder("Search members...").fill("Belhaj");
      await dialog
        .getByRole("button", { name: /Belhaj/ })
        .first()
        .click();
      // The allowance banner only appears once the check returns.
      await page.waitForTimeout(900);
      const qty = dialog.locator('input[type="number"]').first();
      await qty.fill("2");
      await qty.blur();
      await page.waitForTimeout(400);
    },
    selector: '[role="dialog"]',
    fullPage: false,
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
    id: "05-10-bulk-add-items",
    doc: "05-inventory.md",
    line: 705,
    anchor: "Screenshot of the Add Several modal with eight pasted lines",
    alt: "Add Several: eight pasted lines and the parsed preview of name, quantity and unit",
    route: "/inventory/items",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /Add Several/ })
        .first()
        .click();
      const box = page.locator("textarea").first();
      await box.waitFor({ timeout: 20_000 });
      // Eight lines, three of them using the `| quantity | unit` suffix the
      // hint under the box describes, and two naming items the catalog already
      // holds — those are reported after submitting, not marked here. See the
      // guide note beside this image.
      await box.fill(
        [
          "Naloxone 4mg Nasal",
          "Burn Sheet, Sterile | 6 | Each",
          "Job Shirt",
          "Cervical Collar, Adjustable | 4 | Each",
          "Nasopharyngeal Airway Set",
          "Trauma Shears, 7.5in | 12 | Each",
          "Emergency Blanket",
          "Glucometer Test Strips",
        ].join("\n"),
      );
      await page.waitForTimeout(900);
    },
    selector: '[role="dialog"]',
    // The detector fires on the Category select's "No category" — the honest
    // default for a paste that has not chosen one, not a page that failed.
    allowEmptyState: true,
    fullPage: false,
  },
  {
    id: "05-09-receive-stock-modal",
    doc: "05-inventory.md",
    line: 685,
    anchor:
      "Screenshot of the Receive Stock modal with four delivery lines filled in",
    alt: "Receive Stock: four delivery lines, each its own item, lot and expiry, under one received date",
    route: "/inventory/items",
    prepare: async (page) => {
      // The toolbar button wraps onto two lines, so it is matched loosely
      // rather than anchored.
      await page
        .getByRole("button", { name: /Receive Stock/ })
        .first()
        .click();
      await page
        .getByPlaceholder("Search inventory…")
        .first()
        .waitFor({ timeout: 20_000 });

      // A real delivery: four different consumables, four lot numbers, four
      // dates. Nothing is submitted — the modal is a form, and the guide's
      // claim ("the whole delivery lands, or none of it does") is about what
      // happens after this screen, not on it.
      const delivery = [
        ["Naloxone", "NLX-2506", "2027-06-30", "12"],
        ["Epinephrine", "EPI-4401", "2027-02-28", "8"],
        ["Gauze", "GZ-1180", "2028-01-15", "60"],
        ["Normal Saline", "NS-6612", "2027-11-30", "24"],
      ];

      for (let index = 0; index < delivery.length; index += 1) {
        if (index > 0) {
          await page.getByRole("button", { name: /^Add line$/ }).click();
          await page.waitForTimeout(400);
        }
        const [term, lot, expiry, quantity] = delivery[index];
        // Always the first: once a line has an item the picker replaces its
        // input with a static row and an Unlink button, so the only search box
        // left on screen belongs to the line just added.
        const picker = page.getByPlaceholder("Search inventory…").first();
        await picker.fill(term);
        // The picker debounces, then renders its results as buttons.
        await page.waitForTimeout(1_200);
        await page
          .getByRole("button", { name: new RegExp(term) })
          .first()
          .click({ timeout: 10_000 });
        await page.waitForTimeout(300);
        // Addressed by position, not by id: each line's field ids carry a key
        // minted at render time, so there is nothing stable to name.
        await page.locator('input[id^="lot-"]').nth(index).fill(lot);
        await page.locator('input[id^="exp-"]').nth(index).fill(expiry);
        await page.locator('input[id^="qty-"]').nth(index).fill(quantity);
      }
      // Back to the top of the modal body. Filling the last line leaves it
      // scrolled to that field, which pushes the received-date field — the
      // "one date for the whole delivery" half of the claim — off the top.
      await page.getByLabel("Received").scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
    },
    // A frame tall enough for the whole dialog: four lines plus the date above
    // them do not fit the default 900px, and a shorter frame clips whichever
    // end the body happens to be scrolled to.
    viewport: { width: 1440, height: 1250 },
    selector: '[role="dialog"]',
    fullPage: false,
  },
  {
    id: "05-07-item-stock-deployed",
    doc: "05-inventory.md",
    line: 730,
    anchor:
      "Screenshot of an inventory item's Stock tab showing the ready-lots table",
    alt: "An item's Stock Lots tab: the shelf lots above, and the checklist positions carrying it below",
    route: "/inventory/items",
    prepare: async (page) => {
      // Naloxone by name: it is the item `seed_supply_tracking` deploys on M-3
      // in two lots with two dates, which is the whole point of the panel —
      // shelf stock above, and what is actually on a truck below it.
      await openFirstFromApi(
        "/inventory/items?limit=200",
        (id) => `/inventory/items/${id}?tab=stock`,
        "items",
        (item) => item.name === "Naloxone 4mg Nasal",
      )(page);
      await page.waitForTimeout(2_500);
    },
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
    id: "05-68-equipment-request-states",
    doc: "05-inventory.md",
    line: 340,
    anchor:
      "Screenshot of the Equipment Requests page showing an approved request with its Fulfill",
    alt: "Equipment Requests — a pending request, an approved one carrying Fulfill, and a fulfilled one with its terminal badge",
    route: "/inventory/admin/requests",
    prepare: async (page) => {
      // The page opens on Pending, which is right for a review queue and wrong
      // for a picture of the states a request moves through.
      await page.selectOption("#status-filter", "");
      await page.waitForTimeout(800);
    },
    fullPage: true,
  },
  {
    id: "05-67-empty-asset-tag",
    doc: "05-inventory.md",
    line: 1597,
    anchor:
      "Screenshot of an item detail page showing the barcode field with a generated barcode value",
    alt: "An item with a barcode but no asset tag — the empty field showing its -- placeholder rather than being hidden",
    route: "/inventory/items",
    // The section is about what an *empty* field looks like, so the item has
    // to be one that has a barcode and no asset tag. `05-56` and `05-61`
    // deliberately pick the opposite.
    prepare: openFirstFromApi(
      "/inventory/items?limit=200",
      (id) => `/inventory/items/${id}`,
      "items",
      (item) =>
        Boolean(item.barcode ?? item.barcode_value) &&
        !(item.asset_tag ?? item.assetTag),
    ),
    selector: 'div:has(> h3:text("Basic Info"))',
    // "--" is the subject, and the harness's empty-state check reads a page
    // full of dashes as a page that failed to load.
    allowEmptyState: true,
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
    // Pins the end-of-shift-check rule off. 03-81 turns it on to photograph
    // the override it gates, and either may run first -- this shot's committed
    // image shows the department's default, so it sets that rather than
    // inheriting the other shot's leftovers.
    prepare: async (page) => {
      await setRequireEndOfShiftChecks(false)(page);
      await page.reload({ waitUntil: "domcontentloaded" });
    },
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
    doc: "03-scheduling.md",
    line: 668,
    anchor:
      "Screenshot of the Equipment Check Template Builder showing the template header (name,",
    alt: "Equipment check template builder with the template header and sections",
    route: "/scheduling/equipment-check-templates",
    // The seeded Medic 3 Supply Check, not the blank create form. The guide
    // text under this image is about compartments, item check types and the
    // catalog quick-add — none of which render on a template with no items,
    // so the /new route produced a page saying "No compartments yet" under a
    // caption describing a populated builder. The 2026-08-11 pass made this
    // same change and it was lost in a later reconciliation; the currency
    // log's account of that fix is the authority here.
    prepare: async (page) => {
      const id = await page.evaluate(async () => {
        const response = await fetch("/api/v1/equipment-checks/templates", {
          credentials: "include",
        });
        if (!response.ok) return null;
        const body = await response.json();
        const list = Array.isArray(body) ? body : (body.templates ?? []);
        return list.find((t) => t.name === "Medic 3 Supply Check")?.id ?? null;
      });
      if (!id) {
        throw new Error(
          "03-22: seeded 'Medic 3 Supply Check' template not found",
        );
      }
      await page.goto(
        new URL(
          `/scheduling/equipment-check-templates/${id}`,
          page.url(),
        ).toString(),
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForTimeout(2500);
    },
    // fullPage off: the toolbar and the summary bar are both sticky, and a
    // stitched full-page capture paints each of them twice.
    fullPage: false,
  },
  {
    id: "04-04-event-qr-code",
    doc: "04-events-meetings.md",
    line: 86,
    anchor: "Screenshot of the QR code display page showing a large QR code",
    alt: "Event QR code display page for member self check-in, its check-in window open",
    route: "/events",
    // The in-progress event, not merely an upcoming one: the page gates the
    // code behind its check-in window, so an event days away pictures a
    // "Check-in Not Available" badge under a caption about members scanning
    // to check in. This is the screen an officer actually puts on the wall.
    prepare: openFirstFromApi(
      "/events?limit=100",
      (id) => `/events/${id}/qr-code`,
      "events",
      isInProgress,
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
    // Same blank-create-form false positive as 04-05; the guest sign-in
    // toggles this pictures render set.
    allowEmptyState: true,
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
    // "No reminders" is the reminder-audience select's own option, in the
    // DOM on every render; the guest sign-in settings this shot is about
    // are both ticked.
    allowEmptyState: true,
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
    // "No documents yet" is the drawer's Documents section for a guest who
    // has uploaded nothing — correct for a sign-in made at a kiosk minutes
    // ago. The Linked Events panel this pictures is populated.
    allowEmptyState: true,
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
    // "No documents yet" is the drawer's documents panel — a walk-in guest
    // has uploaded nothing, and the Linked Events panel this shot is about is
    // populated.
    allowEmptyState: true,
  },
  {
    id: "04-20-event-requests",
    doc: "04-events-meetings.md",
    line: 633,
    anchor:
      "Screenshot of the Event Requests tab showing a list of requests with",
    alt: "Event requests tab listing incoming requests with status badges",
    // /events/admin defaults to the Create Event tab, so this was
    // byte-identical to 04-05-create-event under a different caption — the
    // same defect as 02-21/02-41.
    route: "/events/admin?tab=requests",
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
    // See 02-41's twin above: bare /training/admin is the Dashboard overview.
    // Reports lives under the Enhancements page.
    route: "/training/admin?tab=reports",
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
      // This photographs the single finalize checklist, which only exists for
      // a department NOT recording a call count — count-only replaces it
      // wholesale with the three-step wizard. The 03-5x shots set count-only to
      // photograph that wizard, so this one sets the mode back rather than
      // trusting manifest order. Either shot may run first; both are correct.
      await setCallTracking("detailed")(page);
      await page.reload({ waitUntil: "domcontentloaded" });
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
      // "Close out shift" since 2026-08-11 — it was "Finalize", which named the
      // database flag rather than the thing an officer does at the end of a
      // shift. The panel button and the checklist's confirm carry the same
      // name, and the panel one is hidden once the checklist opens, so the
      // first visible match is the right one either way.
      await clickByName(/^Close out shift$/i)(page);
    },
    fullPage: true,
  },
  // -- count-only call tracking and the close-out wizard (2026-08-19) -------
  //
  // These four share one dedicated fixture — the seeder's 24-hour, four-crew
  // "Close-out wizard fixture" shift — and each one forces both the
  // organization's call-tracking mode and its own wizard step rather than
  // inheriting either. See openCloseoutWizard for why: the mode decides which
  // of two entirely different screens renders, and the server remembers how far
  // the last capture run advanced. A shot that inherited either would still
  // succeed; it would just write the wrong picture under the right filename.
  //
  // None of them clicks "Close out shift". That finalizes, and a finalized
  // shift will not reopen the wizard — one run would spend the fixture for
  // every run after it.
  {
    id: "03-74-settings-call-count-toggle",
    doc: "03-scheduling.md",
    line: 272,
    anchor: "Scheduling → Settings → General, scrolled to the",
    alt: "Scheduling Settings, General section — the Shift close-out rules block with 'Record a call count at close-out' switched on",
    route: "/scheduling/settings?tab=general",
    prepare: async (page) => {
      // Set through the API rather than by clicking the toggle: the shot is of
      // the settled on-state, and a click leaves the control mid-transition and
      // the section's save state ambiguous.
      await setCallTracking("count_only")(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page
        .getByText(/Record a call count at close-out/i)
        .first()
        .scrollIntoViewIfNeeded();
    },
    fullPage: false,
  },
  {
    id: "03-75-closeout-step1-attendance",
    doc: "03-scheduling.md",
    line: 1376,
    anchor: "close-out wizard step 1: the crew list with editable",
    alt: "Close-out wizard step 1 — each member's on and off times, the combined-hours figure for the crew, one member flagged for a missing check-out and one assigned member with empty times",
    route: "/scheduling",
    prepare: openCloseoutWizard({ step: 1 }),
    viewport: CLOSEOUT_VIEWPORT,
    selector: CLOSEOUT_WIZARD_CARD,
    // "no check-out recorded" is the flag this shot exists to photograph, so
    // the empty-state guard reads the subject of the capture as its absence.
    // The fixture deliberately carries one member who never checked out and
    // one who never checked in at all.
    allowEmptyState: "the missing-check-out flag is what the shot is of",
    fullPage: false,
  },
  {
    id: "03-76-closeout-step2-calls",
    doc: "03-scheduling.md",
    line: 1390,
    anchor: "close-out wizard step 2: the per-type rows with a",
    alt: "Close-out wizard step 2 — per-call-type rows with three EMS and one fire entered, and the total derived from them shown read-only above",
    // Three EMS and one fire: the total has to be arithmetic a reader can do at
    // a glance to see that the rows are its only source, and two distinct types
    // show it is a sum rather than a single field echoed.
    prepare: openCloseoutWizard({ step: 2, calls: { EMS: 3, Fire: 1 } }),
    route: "/scheduling",
    viewport: CLOSEOUT_VIEWPORT,
    selector: CLOSEOUT_WIZARD_CARD,
    fullPage: false,
  },
  {
    id: "03-77-closeout-step3-confirm",
    doc: "03-scheduling.md",
    line: 1417,
    anchor: "close-out wizard step 3: per-member credit seeded from",
    alt: "Close-out wizard step 3 — every member credited with the apparatus's four calls except the first, lowered to two for a late arrival, with the pass-down notes field below",
    route: "/scheduling",
    // credit: 2 against a total of 4 — below the total, so the "nobody is
    // credited with all of them" advisory renders too, which is part of what
    // the guide explains on this screen.
    prepare: openCloseoutWizard({
      step: 3,
      calls: { EMS: 3, Fire: 1 },
      credit: 2,
    }),
    viewport: CLOSEOUT_VIEWPORT,
    selector: CLOSEOUT_WIZARD_CARD,
    fullPage: false,
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
      // "Close out shift" since 2026-08-11 — it was "Finalize", which named the
      // database flag rather than the thing an officer does at the end of a
      // shift. The panel button and the checklist's confirm carry the same
      // name, and the panel one is hidden once the checklist opens, so the
      // first visible match is the right one either way.
      await clickByName(/^Close out shift$/i)(page);
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
    // Not the finalized shift: this is the guide's introduction to the panel,
    // and the closed-out state (banner, Reopen link, locked actions) has its
    // own shot in 03-46.
    prepare: openStaffedShift((shift) => !shift.is_finalized),
    fullPage: true,
  },
  {
    id: "03-08-calls-runs-section",
    doc: "03-scheduling.md",
    line: 174,
    anchor: "Screenshot of the Calls / Runs section on the shift detail panel",
    alt: "Calls and runs logged against a shift",
    route: "/scheduling",
    prepare: async (page) => {
      // Non-finalized, so the section carries its Log Call control. Clipped to
      // the Calls block: the drawer scrolls internally now, so a full-page
      // frame stops at the crew board and never reaches the calls at all.
      await openStaffedShift(
        (shift) => (shift.call_count ?? 0) > 0 && !shift.is_finalized,
      )(page);
      const section = page
        .locator("div.space-y-3:has(h3:has-text('Calls'))")
        .first();
      await section.scrollIntoViewIfNeeded({ timeout: 10_000 });
      await page.waitForTimeout(600);
    },
    selector: "div.space-y-3:has(h3:has-text('Calls'))",
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
      // Not the finalized shift: a closed-out shift locks its actions, so the
      // Log Call button never renders there — and the oldest called shift,
      // which this filter reaches first, is exactly the one the seeder
      // finalizes.
      await openStaffedShift(
        (shift) => (shift.call_count ?? 0) > 0 && !shift.is_finalized,
      )(page);
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
      // The open seat's button reads "Assign someone" since the crew-board
      // redesign; "Assign" alone is its phone-width label, hidden on desktop.
      await clickByName(/^assign someone$/i)(page);
    },
    fullPage: true,
    // "No calls logged for this shift." is the Calls sub-panel on a shift
    // that is deliberately in the future; the assign form is the subject.
    allowEmptyState: true,
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
      // The panel header's button is labelled just "Edit" now; anchored so the
      // aria-labelled "Edit call" / "Edit notes" buttons cannot match.
      await clickByName(/^edit$/i)(page);
    },
    fullPage: true,
  },
  {
    id: "08-22-screening-record-form",
    doc: "08-admin-reports.md",
    line: 865,
    anchor:
      "Screenshot of the ScreeningRecordForm showing fields for linked requirement, screening type, scheduled",
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
    id: "09-21-my-skill-test-results",
    doc: "09-skills-testing.md",
    line: 693,
    anchor:
      "Screenshot of the My Training page's \"Skills Tests\" section showing the member's own results",
    alt: "The member's own skill test results on My Training — official attempts badged PASS or FAIL with their dates, and a practice attempt badged Practice",
    auth: "member",
    route: "/training/my-training",
    prepare: async (page) => {
      // The section is collapsed by default, so it has to be opened before
      // there is anything to photograph.
      await page
        .getByRole("button", { name: /Skills Tests/ })
        .first()
        .click({ timeout: 15_000 });
      // Wait for the *validated* result rather than a fixed pause: it is the
      // oldest row and so the last to render, and it is the half of the
      // caption — an official attempt showing its score — that the practice
      // and under-review rows above it cannot make.
      //
      // This step used to clamp the section to 320px because the demo member
      // had accumulated fifty-odd identical practice passes, each capture run
      // filing another. The seeder now prunes those (PRACTICE_TESTS_KEPT), so
      // the section is five rows and the clamp only cut the row the caption is
      // about — a workaround that outlived its cause.
      await page
        .getByText(/Passed/)
        .last()
        .waitFor({ timeout: 15_000 });
      await page.waitForTimeout(500);
    },
    selector: "div:has(> button:has-text('Skills Tests'))",
  },
  {
    id: "02-105-program-enrollment-progress",
    doc: "02-training.md",
    line: 2139,
    anchor:
      "Screenshot of a member's program enrollment showing overall progress and the requirements grouped by phase",
    alt: "A member's program enrollment — overall progress, and every requirement grouped by phase with the locked ones marked",
    auth: "member",
    route: "/training/my-training",
    prepare: async (page) => {
      await openFirstFromApi(
        "/training/programs/enrollments/me",
        (id) => `/training/my-progress/${id}`,
        "enrollments",
      )(page);
      await page.waitForTimeout(1800);
    },
    fullPage: true,
  },
  {
    id: "03-99-checklists-resume",
    doc: "03-scheduling.md",
    line: 2233,
    anchor:
      "Screenshot of My Equipment Checklists with a part-answered check beside a finished one",
    alt: "My Equipment Checklists — one check part-answered with its progress and a Resume control, one finished, and the untouched ones offering Start Check",
    route: "/scheduling?tab=equipment-checks",
    auth: "member",
    prepare: async (page) => {
      await page.waitForSelector("text=Engine Daily Check", {
        timeout: 20_000,
      });
      await page.waitForTimeout(600);
    },
    fullPage: true,
  },
  {
    id: "03-98-incomplete-check-warning",
    doc: "03-scheduling.md",
    line: 2222,
    anchor:
      "Screenshot of the confirmation shown when submitting an equipment check with unanswered items",
    alt: "The confirmation before filing an incomplete equipment check — how many of the items are unanswered, and the choice between going back and submitting anyway",
    route: "/scheduling?tab=equipment-checks",
    auth: "member",
    prepare: async (page) => {
      await clickByName("Unscheduled checklist")(page);
      await clickByName("Engine Daily Check")(page);
      await page.waitForSelector("text=Hose Bed", { timeout: 20_000 });
      // Answer the required compartments and leave the optional one alone.
      // Submit stays disabled until every *required* item is answered, so the
      // dialog is only ever about optional kit — nothing-answered can't reach
      // it. "Pass All" marks a whole compartment, which is why the optional
      // items are seeded in a compartment of their own.
      for (const compartment of [
        "Cab",
        "Compartment 1 — Driver Front",
        "Hose Bed",
      ]) {
        await page
          .getByRole("button", {
            name: `Mark all items in ${compartment} as passed`,
          })
          .click({ timeout: 15_000 });
        await page.waitForTimeout(200);
      }
      await page
        .getByRole("button", { name: /Submit Report|Save Offline/ })
        .click({ timeout: 15_000 });
      await page.waitForSelector("text=Submit an incomplete check?", {
        timeout: 15_000,
      });
      // The compartments collapse as they are answered, so the page behind is
      // still animating when the dialog opens — long enough for the transitions
      // to finish, or the crop catches half-drawn text under the panel.
      await page.waitForTimeout(1500);
    },
    // The panel, not the full-screen overlay that carries role="dialog".
    selector: "div[role='dialog'] div.bg-theme-surface-modal.relative",
  },
  {
    id: "05-72-setup-prompt",
    doc: "05-inventory.md",
    line: 71,
    anchor:
      'Screenshot of the inventory admin hub with the "Finish inventory setup" prompt',
    alt: 'The inventory admin hub with the "Finish inventory setup" prompt naming what is still missing',
    route: "/inventory/admin",
    // Verified against the seeded department: it captures a hub with no prompt
    // at all, because the prompt is gone the moment rooms, storage areas,
    // categories and items exist — which seeding guarantees. Capturing it here
    // would overwrite a correct picture with a wrong one on every run.
    capturedElsewhere: "scripts/screenshots/inventory-setup.mjs",
    fullPage: false,
  },
  {
    id: "05-73-setup-rooms",
    doc: "05-inventory.md",
    line: 100,
    anchor: "Screenshot of step 1 of the inventory setup workflow",
    alt: "Step 1 of the inventory setup workflow, with no rooms declared yet",
    route: "/inventory/admin/setup?step=0",
    // Same reason as 05-72: the caption describes a department with no rooms,
    // and the seeder creates several.
    capturedElsewhere: "scripts/screenshots/inventory-setup.mjs",
    fullPage: false,
  },
  {
    id: "05-74-setup-categories",
    doc: "05-inventory.md",
    line: 124,
    anchor:
      "Screenshot of step 3 offering the standard fire-service starter categories",
    alt: "Step 3 offering the standard fire-service starter categories, one of them already added",
    route: "/inventory/admin/setup?step=2",
    fullPage: true,
  },
  {
    id: "05-77-setup-storage",
    doc: "05-inventory.md",
    line: 112,
    anchor: "Screenshot of step 2 of the setup workflow, adding storage areas",
    alt: "Step 2 of the setup workflow, adding storage areas to the selected room",
    route: "/inventory/admin/setup?step=1",
    fullPage: false,
  },
  {
    id: "05-78-setup-first-items",
    doc: "05-inventory.md",
    line: 138,
    anchor:
      "Screenshot of step 4 of the setup workflow, with the room, storage area",
    alt: "Step 4 of the setup workflow, with the room, storage area and category pickers",
    route: "/inventory/admin/setup?step=3",
    fullPage: false,
  },
  {
    id: "05-81-setup-categories-mobile",
    doc: "05-inventory.md",
    line: 160,
    anchor: "Screenshot of the category step of the setup workflow on a phone",
    alt: "The category step of the setup workflow on a phone",
    route: "/inventory/admin/setup?step=2",
    viewport: "mobile",
    fullPage: true,
  },
  {
    id: "05-75-setup-item-prefilled",
    doc: "05-inventory.md",
    line: 134,
    anchor:
      "Screenshot of the Add Item form opened from the setup workflow with room",
    alt: "The Add Item form opened from the setup workflow with room, storage area and category pre-filled",
    route: "/inventory/admin/setup?step=3",
    prepare: async (page) => {
      // Pick a storage area first — the point of the shot is that all three
      // pickers carry into the form, and the area defaults to none.
      const area = page.getByLabel("Storage area");
      await area.waitFor({ timeout: 15_000 });
      const value = await area.evaluate(
        (el) => [...el.options].find((o) => o.value)?.value ?? "",
      );
      if (value) await area.selectOption(value);
      await page
        .getByRole("button", { name: /Add an item/i })
        .click({ timeout: 15_000 });
      await page.getByRole("dialog").waitFor({ timeout: 15_000 });
      await page.waitForTimeout(600);
    },
    // Taller window: the item form is a max-height dialog with its own
    // scrollbar, so a viewport shot at 900px cuts it off mid-Location.
    viewport: { width: 1440, height: 1300 },
    fullPage: false,
  },
  {
    id: "05-76-setup-done",
    doc: "05-inventory.md",
    line: 143,
    anchor: "Screenshot of the closing step of the setup workflow",
    alt: "The closing step of the setup workflow recapping what was created",
    route: "/inventory/admin/setup?step=4",
    fullPage: false,
  },
  {
    id: "05-71-impact-planner-replacement",
    doc: "05-inventory.md",
    line: 1968,
    anchor:
      "Screenshot of the Impacted Members table with replacement-aware analysis on",
    alt: "The Impact Planner's Impacted Members table with replacement-aware analysis on — each member badged Has item, Replace or Needs item against the chosen category",
    route: "/inventory/admin/impact-planner",
    prepare: async (page) => {
      // The badge column only renders once a related category is chosen, and
      // "Replace" only appears when worn/expired items are counted too.
      const category = page.getByLabel("Related category");
      await category.waitFor({ timeout: 15_000 });
      // Structural PPE specifically: it is the category the seeder puts a worn
      // bunker coat in, and without an unserviceable holding the "Replace"
      // badge — the whole point of this shot — never appears.
      const value = await category.evaluate((el) => {
        const option = [...el.options].find((o) =>
          o.label.includes("Structural PPE"),
        );
        return option?.value ?? "";
      });
      if (!value)
        throw new Error("no Structural PPE category to analyse against");
      await category.selectOption(value);
      await page
        .getByText("Count worn or expired items as needing replacement")
        .click({ timeout: 15_000 });
      await page
        .getByRole("button", { name: "Analyze Impact" })
        .click({ timeout: 15_000 });
      await page.waitForTimeout(2500);
    },
    fullPage: true,
  },
  {
    id: "05-70-inventory-table-mobile",
    doc: "05-inventory.md",
    line: 1830,
    anchor:
      "Screenshot of the inventory table on a phone, each row stacked into a card",
    alt: "The inventory items table on a phone — each row stacked into a card with the field name on the left and its value on the right",
    route: "/inventory/items",
    viewport: "mobile",
    // Cropped to the first few stacked rows. Not fullPage: the cards are one
    // per item, so a full-page phone capture of the whole inventory came out
    // 18,000px tall and illegible. Not a plain viewport shot either — eight
    // filter selects sit above the table on a phone and push every card below
    // the fold, so the screenful that fits contains no card at all.
    prepare: async (page) => {
      // Two responsive tables render on this page; the items table is first.
      const table = page.locator("table.rwd-table").first();
      await table.waitFor({ timeout: 15_000 });
      // Clip to roughly three rows; the whole table is far taller than a phone.
      await page.evaluate(() => {
        const el = document.querySelector("table.rwd-table");
        if (el instanceof HTMLElement) {
          el.style.maxHeight = "760px";
          el.style.overflow = "hidden";
          el.style.display = "block";
        }
      });
      await page.waitForTimeout(300);
    },
    selector: "table.rwd-table >> nth=0",
  },
  {
    id: "05-69-label-print-page",
    doc: "05-inventory.md",
    line: 1761,
    anchor:
      "Screenshot of the label print page (any module) showing the label size choices",
    alt: "The inventory label print page — the nine label size choices with Rollo/Thermal 2x1 selected, copies per item, extra-detail toggles, and a preview of the three barcode labels",
    route: "/inventory/items",
    prepare: async (page) => {
      // The page renders from ?ids= and shows "No items specified" without it,
      // so the ids have to be picked up before navigating.
      const ids = await page.evaluate(async () => {
        const response = await fetch("/api/v1/inventory/items?limit=3", {
          credentials: "include",
        });
        if (!response.ok) return [];
        const body = await response.json();
        const rows = Array.isArray(body) ? body : (body.items ?? []);
        return rows.map((item) => item.id).filter(Boolean);
      });
      if (!ids.length) {
        throw new Error("no inventory items to print labels for");
      }
      await page.goto(
        new URL(
          `/inventory/print-labels?ids=${ids.join(",")}`,
          page.url(),
        ).toString(),
        { waitUntil: "domcontentloaded" },
      );
      // The format, printer and copies controls live behind Settings, which
      // starts collapsed — the page otherwise shows only the preview.
      // Exact match: a loose /settings/i also matches the sidebar's
      // "Organization Settings" nav group, which comes first in the DOM and
      // just expands the navigation instead.
      await page
        .getByRole("button", { name: "Settings", exact: true })
        .click({ timeout: 15_000 });
      await page.waitForTimeout(600);
    },
    fullPage: true,
  },
  {
    id: "14-23-membership-ballot-item",
    doc: "14-elections.md",
    line: 843,
    anchor: "Screenshot of the ballot preview showing a membership approval",
    alt: "The ballot preview's membership approval item — the applicant named in the title, the coordinator's supporting statement, and the Approve and Deny options",
    route: "/elections",
    prepare: async (page) => {
      // Matched on `election_type`, not a title. The obvious filter — an
      // election carrying a membership_approval ballot item — cannot be used
      // here: the list endpoint returns no `ballot_items` at all, only the
      // detail does. `general` is the only seeded election that is neither a
      // position race nor an issue vote, which is exactly what a membership
      // approval is.
      //
      // The preview is the one screen that renders Approve/Deny for such an
      // item; the in-app ballot draws position races only (see
      // KNOWN_LIMITATIONS).
      await openFirstFromApi(
        "/elections?limit=50",
        (id) => `/elections/${id}`,
        "elections",
        (election) => election.election_type === "general",
      )(page);
      await clickByName(/^Preview Ballot$/)(page);
      const approve = page.getByText("Approve", { exact: true }).first();
      await approve.waitFor({ timeout: 20_000 });
      await page.waitForTimeout(400);
    },
    selector: "div[role='dialog']",
  },
  {
    id: "14-21-save-ballot-template",
    doc: "14-elections.md",
    line: 144,
    anchor: "The Ballot Builder with the **Save as Template**",
    alt: "The Save as Template form open in the Ballot Builder — the Template name field, the configuration-only note, and the Save Template / Cancel buttons",
    route: "/elections",
    prepare: async (page) => {
      // A draft election, because Save as Template is hidden on a closed one
      // and the guide's steps say to build the ballot on a draft. Reset first:
      // the selector below reads "Ballot Items (1)", and `19-26` leaves this
      // draft holding the four items of an applied template.
      await openBylawDraft(page);
      const save = page.getByRole("button", { name: /^Save as Template$/ });
      await save.waitFor({ timeout: 20_000 });
      await save.click();
      const name = page.locator("#saved-ballot-template-name");
      await name.waitFor({ timeout: 10_000 });
      await name.fill("Annual officer election");
      await page.waitForTimeout(500);
    },
    selector: "div:has(> div > h3:text-is('Ballot Items (1)'))",
  },
  {
    id: "14-22-ballot-template-picker",
    doc: "14-elections.md",
    line: 159,
    anchor: 'The template picker showing the "Your saved',
    alt: 'The ballot template picker — a saved "Annual officer election" under Your saved ballots with its Replace / Cancel confirmation armed, above the built-in templates',
    route: "/elections",
    prepare: async (page) => {
      await openBylawDraft(page);
      const use = page.getByRole("button", { name: /^Use Template$/ });
      await use.waitFor({ timeout: 20_000 });
      await use.click();
      // Clicking the saved template arms the two-step confirm rather than
      // applying it — which is the state the guide is describing.
      // Scoped to the popover and taken first: the built-in "Officer
      // Election" template below also matches a loose name regex.
      const popover = page.locator(
        "div:has(> h4:text-is('Select a Template'))",
      );
      const saved = popover
        .getByRole("button", { name: /Annual officer election/ })
        .first();
      await saved.waitFor({ timeout: 10_000 });
      await saved.click();
      await page.waitForTimeout(500);
    },
    selector: "div:has(> h4:text-is('Select a Template'))",
  },
  {
    id: "14-20-runoff-chain",
    doc: "14-elections.md",
    line: 601,
    anchor:
      "Screenshot of the Runoff Chain timeline showing the original election",
    alt: "The Multi-Stage Election Chain on a Fire Chief election — Original, Runoff 1 and Runoff 2 as linked nodes with their status and vote counts, the current round ringed",
    route: "/elections",
    prepare: openFirstFromApi(
      "/elections?limit=50",
      (id) => `/elections/${id}`,
      "elections",
      // The root of the seeded chain: RunoffChain walks up to the root anyway,
      // but starting there is what puts the ring on "Original".
      (election) =>
        (election.title ?? "") === "Fire Chief Election — 2027 Term",
    ),
    selector: "div:has(> div > h3:text-is('Multi-Stage Election Chain'))",
  },
  {
    id: "04-42-cast-ballot",
    doc: "04-events-meetings.md",
    line: 609,
    anchor:
      "Screenshot of the Cast Vote tab on an open election showing the position, its candidates with their statements",
    alt: "The Cast Vote tab on an open election — the Captain race with its two candidates and their statements, and the per-position submit button beneath them",
    route: "/elections",
    // The member's own view, not an officer's: the ballot is what a voter sees.
    auth: "member",
    // Not merely the first *open* election: the elections list carries no
    // candidate count, so a list-level match cannot tell a contested race from
    // an empty one — and the first open election is the restricted-ballot seat
    // with no candidates, which rendered "No candidates for this position"
    // under a caption about choosing between two. Resolved through each open
    // election's candidates endpoint instead.
    prepare: async (page) => {
      const id = await page.evaluate(async () => {
        const listed = await fetch("/api/v1/elections?limit=20", {
          credentials: "include",
        });
        if (!listed.ok) return null;
        const body = await listed.json();
        const rows = Array.isArray(body) ? body : (body.elections ?? []);
        for (const election of rows) {
          if (String(election.status ?? "").toLowerCase() !== "open") continue;
          const detail = await fetch(
            `/api/v1/elections/${election.id}/candidates`,
            { credentials: "include" },
          );
          if (!detail.ok) continue;
          const listedCandidates = await detail.json();
          const candidates = Array.isArray(listedCandidates)
            ? listedCandidates
            : (listedCandidates.candidates ?? []);
          if (candidates.filter((c) => c.accepted).length >= 2) {
            return election.id;
          }
        }
        return null;
      });
      if (!id) {
        throw new Error("04-42: no open election has a contested position");
      }
      await page.goto(new URL(`/elections/${id}`, page.url()).toString(), {
        waitUntil: "domcontentloaded",
      });
      const tab = page.locator("#tab-voting");
      await tab.waitFor({ timeout: 10_000 });
      await tab.click({ timeout: 10_000 });
      await page.waitForTimeout(800);
    },
    fullPage: true,
  },
  {
    id: "01-36-membership-number-field",
    doc: "01-membership.md",
    line: 1043,
    anchor:
      "Screenshot of the Department Information section on a member's admin edit page showing the auto-generated Membership Number",
    alt: "The Department Information block on the admin member edit page — the auto-generated Membership Number alongside Rank and Station, all editable",
    route: "/members",
    prepare: openFirstFromApi(
      "/users?limit=1",
      (id) => `/members/admin/edit/${id}`,
      "users",
    ),
    // Cropped to the block rather than the whole form: 01-07 already shows the
    // full page, and the point here is the one field.
    selector: "div:has(> h2:text-is('Department Information'))",
  },
  {
    id: "01-37-elected-package-badge",
    doc: "01-membership.md",
    line: 1156,
    anchor: "its status badge reading Elected after the recorded vote closed",
    alt: "The applicant drawer's Election Package section, its status badge reading Elected",
    route: "/prospective-members",
    // The badge reads `elected` only after `seed_membership_vote_outcome` has
    // walked the August membership vote to a close — package assigned to the
    // ballot, paper tally recorded and attested, election closed, statuses
    // synced back. Matched on the stage rather than a name, like 15-08, so a
    // different seeding spread cannot point this at somebody else.
    //
    // The tally is NOT in this frame and the caption no longer promises it:
    // vote counts live on the election results screen guide 14 pictures, and
    // nothing joins the two on one screen.
    prepare: openApplicantAtStage("Membership Vote"),
    fullPage: true,
    // Sibling sections of the same drawer legitimately read "No documents
    // yet" / "No checklist data recorded yet" for an applicant with no
    // uploads; the section this pictures is populated.
    allowEmptyState: true,
  },
  {
    id: "01-38-program-phase-progress",
    doc: "01-membership.md",
    line: 1287,
    anchor:
      "every phase group with its requirements and their statuses, the current phase marked",
    alt: "A recruit's program progress — every phase group with its requirements and statuses, the current phase marked, the overall bar above them",
    // The member-facing page rather than the admin Progress modal, which
    // shows the same grouping but is height-capped and scrolls — a capture of
    // it holds one phase group, and the caption is about seeing all of them.
    // The program detail (`GET .../programs/{id}`) returns phases with no
    // requirements in them at all, so no phase grouping can render there.
    auth: "member",
    route: "/dashboard",
    prepare: async (page) => {
      // The enrollment id is the member's own; resolve it the way the
      // dashboard's My Training panel does rather than hardcoding a seed id.
      const enrollments = await page.evaluate(async () => {
        const response = await fetch(
          "/api/v1/training/programs/enrollments/me?status=active",
          { credentials: "include" },
        );
        return response.ok ? response.json() : [];
      });
      const list = Array.isArray(enrollments) ? enrollments : [];
      // Prefer the phased probationary pipeline — 13 requirements across
      // three phases with prerequisite locks, which is the structure the
      // guide's worked example walks through. The member's other enrollment
      // (Recruit School) is a five-requirement program that shows the same
      // grouping with far less in it.
      const first =
        list.find(
          (enrollment) =>
            enrollment.program?.name === "Probationary Firefighter Pipeline",
        ) ?? list[0];
      if (!first?.id) {
        throw new Error("01-38: the demo member has no active enrollment");
      }
      await page.goto(
        new URL(`/training/my-progress/${first.id}`, page.url()).toString(),
        { waitUntil: "domcontentloaded" },
      );
      await page.getByText(/Current phase:/).waitFor({ timeout: 20_000 });
      await page.waitForTimeout(800);
    },
    fullPage: true,
  },
  {
    id: "01-39-scan-member-id-nav",
    doc: "01-membership.md",
    line: 1409,
    anchor:
      "The Administration section's Members group expanded, Scan Member ID among its links",
    alt: "The Administration section's Members group expanded, Scan Member ID among its links",
    route: "/dashboard",
    // The elevated half of a two-sign-in contrast. The placeholder asked for
    // both roles side by side, which no single capture can be: the harness
    // authenticates as the administrator, the demo member, or nobody, and a
    // `members.view`-only role is none of those. The member half is
    // cross-referenced to 00-15 instead, whose sidebar has no Administration
    // section at all — which is *why* the scanner cannot appear there.
    prepare: async (page) => {
      // Wait for the ADMINISTRATION heading before touching anything. The
      // admin half of the nav is built from permissions that resolve after
      // first paint, so for a moment the only button named "Members" is the
      // member-facing roster item — and clicking that one expands nothing.
      // This shot timed out three times on that race before it was named.
      // Matched case-insensitively: the heading is uppercased by CSS, so the
      // DOM text is "Administration" and an exact "ADMINISTRATION" match —
      // which is what `innerText` shows you — never fires.
      await page
        .getByText(/^Administration$/i)
        .first()
        .waitFor({ timeout: 20_000 });
      // Matched by text, not by `link` role: the Administration sub-items are
      // not anchors, so a role-based locator finds nothing even with the group
      // open and the words on screen.
      const link = page.getByText(/^Scan Member ID$/).first();
      // Expand only if it is not already open. The sidebar persists which
      // groups are expanded, so an unconditional click is as likely to
      // collapse the group as to open it.
      if ((await link.count()) === 0) {
        const group = page.getByRole("button", { name: /^Members$/ }).last();
        await group.waitFor({ timeout: 20_000 });
        await group.click({ timeout: 10_000 });
      }
      await link.waitFor({ timeout: 15_000 });
      await link.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(400);
    },
    // The taller viewport for the same reason 00-15 needs one: with the
    // Administration group open the nav is well past 900px, and at the default
    // height the group would not expand into view at all.
    viewport: { width: 1440, height: 1500 },
    selector: "nav",
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
    // The board spreads seven applicants across six stages, so some columns
    // read "No applicants", and a drawer for an applicant who has uploaded
    // nothing reads "No documents yet". Both are honest; the populated
    // check is Total Active.
    allowEmptyState: true,
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
    // "No EVOC requirement" is the select's placeholder option, in the DOM on
    // every render including this one, where a real level is selected — the
    // same false positive recorded for 03-52 and 06-23.
    allowEmptyState: true,
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
  {
    id: "06-22-apparatus-operators-tab",
    doc: "06-apparatus-facilities.md",
    line: 672,
    anchor:
      "Screenshot of an engine's Operators tab listing its certified operators by name",
    alt: "The Operators tab: certified operators by name, with EVOC level and certification dates",
    route: "/apparatus",
    prepare: async (page) => {
      // `?tab=operators` is read on mount, so no click is needed — but the
      // apparatus id has to be resolved first, and E-1 is the rig the seeder
      // gives three operators with spread EVOC levels.
      await openFirstFromApi(
        "/apparatus",
        (id) => `/apparatus/${id}?tab=operators`,
        "apparatus",
        (a) => (a.unit_number ?? a.unitNumber) === "E-1",
      )(page);
      await page
        .getByRole("button", { name: /Add Operator/i })
        .first()
        .waitFor({ timeout: 20_000 });
      await page.waitForTimeout(800);
    },
    fullPage: false,
  },
  {
    id: "06-23-add-operator-member-picker",
    doc: "06-apparatus-facilities.md",
    line: 687,
    anchor:
      "Screenshot of the Add Operator form with a member chosen from the picker",
    alt: "The Add Operator form: a member picker, not the free-text UUID box it replaced",
    route: "/apparatus",
    // Both selects are native, and an open native popup is drawn by the OS
    // rather than the page — Playwright cannot photograph it. Showing the two
    // fields *set* makes the same point the caption does, and better: a real
    // member name proves the box is a picker over the roster, and an EVOC level
    // is the combination that used to return a server error.
    allowEmptyState: true, // "No EVOC level" is the placeholder option, not an empty page
    prepare: async (page) => {
      await openFirstFromApi(
        "/apparatus",
        (id) => `/apparatus/${id}?tab=operators`,
        "apparatus",
        (a) => (a.unit_number ?? a.unitNumber) === "E-1",
      )(page);
      const add = page.getByRole("button", { name: /Add Operator/i }).first();
      await add.waitFor({ timeout: 20_000 });
      await add.click();

      // Pick by position rather than by name: the roster is seeded and the
      // first real option is a member either way, whereas naming one couples
      // this shot to the seeder's name list.
      const member = page.locator("#operator-member");
      await member.waitFor({ timeout: 10_000 });
      // The roster is fetched after the modal mounts, so the select exists for
      // a moment holding nothing but its placeholder. Waiting on the element
      // is not waiting on the list.
      await member
        .locator("option")
        .nth(1)
        .waitFor({ state: "attached", timeout: 20_000 });
      const memberValue = await member.evaluate(
        (el) =>
          Array.from(el.options).find((option) => option.value !== "")?.value ??
          "",
      );
      if (!memberValue) throw new Error("member picker has no members in it");
      await member.selectOption(memberValue);

      const evoc = page.locator("select").nth(1);
      const evocValue = await evoc.evaluate(
        (el) =>
          Array.from(el.options).find((option) =>
            /intermediate/i.test(option.text),
          )?.value ?? "",
      );
      if (!evocValue) throw new Error("no Intermediate EVOC level defined");
      await evoc.selectOption(evocValue);

      await page
        .getByLabel(/Certified to operate/i)
        .first()
        .check();
      await page.waitForTimeout(800);
    },
    fullPage: false,
  },
  {
    id: "06-24-rooms-nested-tree",
    doc: "06-apparatus-facilities.md",
    line: 216,
    anchor:
      "SCREENSHOT NEEDED — Rooms section showing a two- or three-level tree",
    alt: "The Rooms section as a containment tree: sub-rooms indented under the room holding them, each container reporting how many it holds",
    route: "/facilities",
    // The per-row actions are `sm:opacity-0 sm:group-hover:opacity-100`, so a
    // plain capture of this section can never show the add-a-room-inside
    // button — it is only painted while a row is hovered. Hovering the
    // top-level row is therefore part of the shot, not a nicety.
    prepare: async (page) => {
      await openFacilityRooms(page);
      await page.getByText("Volunteer Office", { exact: true }).first().hover();
      await page.waitForTimeout(600);
    },
    fullPage: true,
  },
  {
    id: "06-25-room-located-inside",
    doc: "06-apparatus-facilities.md",
    line: 224,
    anchor: 'SCREENSHOT NEEDED — room form open showing the "Located Inside"',
    alt: 'The room form\'s "Located Inside" field, holding the room that contains the one being edited',
    route: "/facilities",
    // Same native-select limit as 06-23: an open `<select>` popup is drawn by
    // the OS, not the page, so the exclusion cannot be photographed in the
    // list. Editing a room that HAS a subtree makes the point better anyway —
    // its only remaining option is "Facility (top level)", because itself and
    // all three of its descendants are excluded. Verified by
    // `roomTree.test.ts` (collectSubtreeIds) and the nesting service tests.
    prepare: async (page) => {
      await openFacilityRooms(page);
      await page
        .getByText("Quartermaster's Storage", { exact: true })
        .first()
        .hover();
      await page.waitForTimeout(400);
      const edits = page.locator('button[aria-label*="Edit"]');
      await edits.first().waitFor({ timeout: 20_000 });
      await edits.nth(1).click();
      await page
        .getByText(/Located Inside/i)
        .first()
        .waitFor({ timeout: 10_000 });
      await page.waitForTimeout(600);
    },
    fullPage: true,
  },
  {
    id: "06-26-room-delete-subrooms",
    doc: "06-apparatus-facilities.md",
    line: 240,
    anchor: "SCREENSHOT NEEDED — delete-room confirmation dialog for a room",
    alt: "The delete-room confirmation, stating that the room's sub-rooms move up a level rather than being deleted",
    route: "/facilities",
    prepare: async (page) => {
      await openFacilityRooms(page);
      await page.getByText("Volunteer Office", { exact: true }).first().hover();
      await page.waitForTimeout(400);
      const deletes = page.locator(
        'button[aria-label*="Delete"], button[title*="Delete"]',
      );
      await deletes.first().waitFor({ timeout: 20_000 });
      await deletes.first().click();
      await page
        .getByRole("button", { name: /Keep it/i })
        .waitFor({ timeout: 10_000 });
      await page.waitForTimeout(400);
    },
    // Viewport, not fullPage: the dialog is the subject and a full-page shot
    // pushes it into a large dimmed backdrop.
    fullPage: false,
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
    id: "14-19-forensics-report",
    doc: "14-elections.md",
    line: 639,
    anchor:
      "Screenshot of the Forensics & Integrity panel showing the integrity check verdict",
    alt: "The Forensics & Integrity panel — the signature check verdict over the ballot box, with the deleted-vote and anomaly sections beneath",
    route: "/elections",
    prepare: async (page) => {
      await openFirstFromApi(
        "/elections?limit=20",
        (id) => `/elections/${id}`,
        "elections",
        isClosedElection,
      )(page);
      // The panel is a collapsed accordion and fetches its report on first
      // open, so it has to be expanded before there is anything to shoot.
      await clickByName("Forensics & Integrity")(page);
      // The integrity check is a separate, deliberate action — the section
      // renders its verdict only once somebody has asked for one.
      await clickByName("Run Check")(page);
      await page.waitForSelector("text=valid signatures", { timeout: 20_000 });
      await page.waitForTimeout(500);
    },
    selector: 'div.mt-6:has(> button span:text-is("Forensics & Integrity"))',
    viewport: { width: 1440, height: 1400 },
    // "No votes have been voided." is the *point* — a clean election is what
    // this panel should say, and the placeholder asks for the soft-deleted
    // section empty. Nothing here is waiting on seed data.
    allowEmptyState: true,
  },
  {
    id: "14-17-election-results",
    doc: "14-elections.md",
    line: 524,
    anchor:
      "Screenshot of the election results page showing a position with candidate vote counts",
    alt: "A closed election's results — vote counts per candidate, the winner, and turnout against the eligible roster",
    route: "/elections",
    prepare: openElectionTab("results", isClosedElection),
    fullPage: true,
  },
  {
    id: "14-18-paper-batches",
    doc: "14-elections.md",
    line: 449,
    anchor: "Screenshot of the Paper Batches panel showing a",
    alt: "The Paper Batches panel — a recorded in-room tally, who recorded it, and the officer attestations that confirmed it",
    route: "/elections",
    // Not a tab: the panel sits in the detail page's body, above the tab
    // strip, and appears whenever the election has at least one batch.
    prepare: async (page) => {
      await openFirstFromApi(
        "/elections?limit=20",
        (id) => `/elections/${id}`,
        "elections",
        isClosedElection,
      )(page);
      await page.getByText("Paper-Ballot Batches").waitFor({ timeout: 15_000 });
      await page.waitForTimeout(400);
    },
    selector: 'div:has(> h3:text-is("Paper-Ballot Batches"))',
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
  {
    // A manager's candidate list on an election past nominations. Both halves
    // open the SAME election, which is seeded specifically for this: every
    // other seeded election either sits in the nomination phase (where pending
    // nominations are visible to everyone, so there is nothing to compare) or
    // has nobody pending.
    id: "14-25-candidates-as-manager",
    doc: "14-elections.md",
    line: 212,
    anchor: "the candidate list for the same election seen from a",
    alt: "The candidate list on an election past nominations, as an elections manager: the accepted candidate and the nominee who has not yet accepted",
    route: "/elections",
    prepare: openElectionTab("candidates", isPostNominationElection),
    fullPage: true,
    allowEmptyState:
      'Matches "No votes cast yet" from the results panel, which is true and ' +
      "expected on an election still open. The candidate list this shot is " +
      "about carries both nominees.",
  },
  {
    id: "14-26-candidates-as-member",
    doc: "14-elections.md",
    line: 212,
    anchor: "__paired-with-14-25__",
    alt: "The same election as an ordinary member: the ballot offers only the candidate who accepted, the pending nomination withheld once nominations have closed",
    route: "/elections",
    auth: "member",
    // No candidates tab is clicked, because a member does not get one: their
    // view of who is standing is the ballot itself. Opening the election is
    // the whole prepare -- reaching for #tab-candidates timed out against a
    // tab strip that only offers Cast Vote.
    prepare: openFirstFromApi(
      "/elections?limit=20",
      (id) => `/elections/${id}`,
      "elections",
      isPostNominationElection,
    ),
    fullPage: true,
    allowEmptyState:
      "A member is meant to see a shorter list here -- the withheld pending " +
      "nomination is the subject of the shot, so one name on the ballot is " +
      "the result rather than missing demo data.",
  },
  {
    id: "14-24-ballot-send-skipped",
    doc: "14-elections.md",
    line: 352,
    anchor: "The result of a ballot send",
    alt: "The banner after a ballot send, naming each member who was skipped and why",
    route: "/elections",
    // Sends real ballots, so it changes the election's `email_sent` state and
    // mints voting tokens. Last in guide 14 by the manifest's own invariant.
    mutatesSeedData: true,
    prepare: async (page) => {
      // The one election whose ballot item restricts eligible_voter_types, so
      // the send skips the two administrative members rather than nobody.
      await openFirstFromApi(
        "/elections?limit=50",
        (id) => `/elections/${id}`,
        "elections",
        (election) => election.title?.startsWith("Operations Committee Seat"),
      )(page);
      await clickByName(/^(Send|Resend) Ballot Emails$/)(page);
      await clickByName(/^Send Ballots$/)(page);
      // The banner, not the toast: the toast is transient and says "see banner
      // below", and the banner is the part that names who was skipped.
      const banner = page.getByText(/member\(s\) skipped when sending ballots/);
      await banner.waitFor({ timeout: 30_000 });
      await banner.evaluate((el) => el.scrollIntoView({ block: "center" }));
      // Wait the toast out. It reports "N sent, M failed, M skipped", and in a
      // demo with no SMTP configured every send fails — "0 voter(s), 20
      // failed" over a caption about *skipped* members reads as a broken
      // feature rather than an eligibility rule. The banner is persistent and
      // is the part the guide is about, so the shot is taken once the toast
      // has gone. react-hot-toast dismisses an error after 4s.
      await page
        .getByText(/Ballots sent to \d+ voter/)
        .waitFor({ state: "hidden", timeout: 15_000 })
        .catch(() => {});
      await page.waitForTimeout(600);
    },
    // Viewport rather than a selector: the banner is a plain div with no
    // stable hook, and the surrounding page is the useful context anyway —
    // the election it was sent for is named directly above it.
    fullPage: false,
    // "No votes cast yet" further down the page. An election whose ballots
    // went out seconds ago has had no time to collect one, so that is the
    // correct state rather than a seed gap — and it is not what this pictures.
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
    // Both stage-movement buttons only render for an applicant who has
    // somewhere to go in each direction, so this needs a mid-pipeline stage —
    // matched by stage rather than by name so a re-spread cannot land it on
    // somebody at either end with half the action bar missing.
    prepare: openApplicantAtStage("Background & Medical"),
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
    // "Membership Vote" in the seeded pipeline. Matched on the stage rather
    // than a name, so a different seeding spread cannot silently point this at
    // somebody who is not at the vote.
    prepare: openApplicantAtStage("Membership Vote"),
    fullPage: true,
    allowEmptyState: true,
  },
  {
    id: "15-09-convert-modal",
    doc: "15-prospective-members.md",
    line: 389,
    anchor:
      "Screenshot of the Convert to Member modal showing membership type selector",
    alt: "Step 2 of the Convert to Member modal — membership type, rank, station and hire date",
    route: "/prospective-members",
    prepare: async (page) => {
      // Conversion is not its own button: Advance on the *last* stage opens
      // the modal, so this shot needs whoever is sitting on Onboarding —
      // match on that stage rather than on a name, since the seeder spreads
      // applicants across stages and who lands on the last one moves.
      await openApplicantAtStage("Onboarding")(page);
      await clickByName(/convert/i)(page);
      // The modal opens on step 1 of 2 (Review Applicant); the membership
      // type, ID, rank and start date the placeholder names are on step 2.
      await clickByName(/^continue$/i)(page);
    },
    fullPage: false,
    allowEmptyState: true,
  },
  {
    id: "15-09-bulk-action-result",
    doc: "15-prospective-members.md",
    line: 495,
    anchor: "The pair of notifications after a bulk advance that",
    alt: "Bulk advance reporting how many moved and naming the applicants it skipped",
    route: "/prospective-members",
    // Runs a real bulk advance, so it *changes the seeded data* — every
    // applicant on page one moves a stage on. It must therefore stay the LAST
    // 15-* entry: the shots above it match applicants by the stage they sit on
    // (`openApplicantAtStage`), and a run of this one empties whichever stages
    // those shots were waiting for. It had drifted up to fourth, and
    // 15-05-applicant-actions timed out looking for a Background & Medical
    // applicant this had already advanced past. Re-running the seeder puts the
    // spread back, so the shot is repeatable; it is just not idempotent, and
    // nothing that depends on the spread may run after it.
    //
    // The partial failure is the point: the applicant on the final stage has
    // nowhere to advance to, so selecting the page produces both toasts — the
    // count that moved, and the named applicants that could not.
    mutatesSeedData: true,
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
  // 15-13-application-status has no entry, on purpose.
  //
  // The public application-status page is addressed by a per-applicant
  // `status_token`. This shot used to read that token from the prospect detail
  // response; a security fix then removed the field from every response,
  // because it is the credential behind that page and was leaking into the
  // kanban board as well. The tokens still exist — every applicant has one —
  // but no supported interface hands one out: it reaches the applicant only in
  // the email the system sends them, and this environment runs no mail catcher.
  //
  // The committed `15-13-application-status.png` predates that fix and remains
  // a true picture of the page, so the guide keeps it. It simply cannot be
  // refreshed from here, and an entry that fails on every run is noise rather
  // than a finding. Restoring it means giving the seeder a way to surface a
  // status URL, or reading it out of a mail catcher the way an applicant would.
  {
    id: "09-04-template-builder",
    doc: "09-skills-testing.md",
    line: 111,
    anchor: "Screenshot of the template builder showing its sections",
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
    id: "03-95-apparatus-inventory",
    doc: "03-scheduling.md",
    line: 837,
    anchor: "the Apparatus Inventory page on a phone",
    alt: "Apparatus Inventory on a phone — counted positions with what is aboard against par, the short ones called out",
    // Shot from a crew member's session, not the chief's. The page opens on
    // `equipment_check.submit` — the default member position — and that is the
    // whole claim the feature makes about who records what they used.
    auth: "member",
    route: "/scheduling/apparatus-inventory",
    // A tall phone rather than `viewport: "mobile"` + `fullPage`. The bottom
    // tab bar is `position: fixed`, and a full-page shot paints it once at its
    // viewport offset — across the middle of the list, over the one row whose
    // count ("18 of 24") the surrounding prose quotes. A frame tall enough to
    // hold the three compartments leaves the bar where a phone puts it.
    viewport: { width: 390, height: 1500 },
    prepare: async (page) => {
      // The page opens on "Select an apparatus…", which is an empty state
      // rather than the screen. M-3 is the rig `seed_supply_tracking` stocks.
      const select = page.locator("#apparatus-select");
      await select.waitFor({ timeout: 20_000 });
      // By the option's own value rather than its label: the label is
      // "M-3 — Medic 3", built from two fields, and matching it as a string
      // breaks the moment either changes.
      const value = await page
        .locator("#apparatus-select option")
        .filter({ hasText: "M-3" })
        .first()
        .getAttribute("value");
      if (value) {
        await select.selectOption(value);
        await page.waitForTimeout(1_200);
      }
    },
    fullPage: false,
  },
  {
    id: "03-96-lots-aboard-sheet",
    doc: "03-scheduling.md",
    line: 866,
    anchor:
      "Screenshot of the lots sheet open over the Apparatus Inventory page",
    alt: "The lots-aboard sheet on a phone — two lots on one position, each with its own count and expiry",
    auth: "member",
    route: "/scheduling/apparatus-inventory",
    viewport: "mobile",
    prepare: async (page) => {
      const select = page.locator("#apparatus-select");
      await select.waitFor({ timeout: 20_000 });
      const value = await page
        .locator("#apparatus-select option")
        .filter({ hasText: "M-3" })
        .first()
        .getAttribute("value");
      if (!value) throw new Error("03-96: M-3 not in the apparatus picker");
      await select.selectOption(value);
      // The sheet only exists for a position carrying more than one lot, and
      // Naloxone is the one `seed_supply_tracking` stocks that way — the whole
      // reason the sheet exists is a bracket holding two expiration dates.
      await page
        .getByRole("button", { name: /^2 lots$/ })
        .first()
        .click({ timeout: 20_000 });
      await page.waitForTimeout(1_200);
    },
    fullPage: false,
  },
  {
    id: "09-20-result-disclosure-settings",
    doc: "09-skills-testing.md",
    line: 1051,
    anchor: "The Training Configuration editor showing the",
    alt: "The Skills-Test Results settings — what a member sees of a result, and when they see it",
    route: "/training/my-training",
    prepare: async (page) => {
      await page.waitForTimeout(2500);
      await page
        .getByRole("button", { name: /Member Visibility Settings/ })
        .first()
        .click({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      const group = page
        .locator("div:has(> h3:text-is('Skills-Test Results'))")
        .last();
      await group.waitFor({ timeout: 20_000 });
      await group.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(600);
    },
    selector: "div:has(> h3:text-is('Skills-Test Results'))",
  },
  {
    id: "09-19-failed-test-result",
    doc: "09-skills-testing.md",
    line: 537,
    anchor: "The test completion/results screen",
    alt: "A failed scorecard — the result, the percentage against the passing mark, and the critical step that failed on its own",
    route: "/training/skills-testing",
    prepare: openFirstFromApi(
      "/training/skills-testing/tests?limit=100",
      (id) => `/training/skills-testing/test/${id}`,
      "tests",
      (test) => test.result === "fail",
    ),
    fullPage: false,
    viewport: { width: 1440, height: 1100 },
  },
  {
    id: "09-18-finish-with-unscored-steps",
    doc: "09-skills-testing.md",
    line: 510,
    anchor: 'The "finish with unscored steps" dialog',
    alt: "The warning raised on finishing — how many steps have no score, what an unscored critical step costs, and the choice between going back and reviewing anyway",
    route: "/training/skills-testing",
    prepare: async (page) => {
      const testId = await page.evaluate(async () => {
        const response = await fetch(
          "/api/v1/training/skills-testing/tests?limit=50",
          { credentials: "include" },
        );
        if (!response.ok) return null;
        const body = await response.json();
        const rows = Array.isArray(body) ? body : (body.tests ?? []);
        const wanted = rows.find((row) => row.status === "in_progress");
        return wanted ? wanted.id : null;
      });
      if (!testId) throw new Error("09-18: no test is part-scored");
      await page.goto(
        new URL(
          `/training/skills-testing/test/${testId}/active`,
          page.url(),
        ).toString(),
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForTimeout(3000);
      // Raised *before* review is entered and before anything is written, so
      // this stops at the question rather than answering it.
      await page
        .getByRole("button", { name: /^Finish( & Review)?$/ })
        .first()
        .click({ timeout: 20_000 });
      await page.waitForTimeout(1200);
      await page
        .getByText(/Some steps have no score/)
        .first()
        .waitFor({ timeout: 20_000 });
    },
    selector: "div[role='dialog'], div.fixed.inset-0 > div",
  },
  {
    id: "09-18-statement-starts-clock",
    doc: "09-skills-testing.md",
    line: 457,
    anchor: "A statement criterion on the scoring screen with",
    alt: "A read-aloud statement inside the time limit, with the START CLOCK & READ button beneath it",
    route: "/training/skills-testing",
    prepare: async (page) => {
      await openFirstFromApi(
        "/training/skills-testing/tests?limit=50",
        (id) => `/training/skills-testing/test/${id}/active`,
        "tests",
        (test) => test.status === "in_progress",
      )(page);
      // The timed statement lives in Hose Advance, not the opening section —
      // the briefing there is read *off* the clock and so has no button, which
      // is the distinction this shot exists to draw.
      // The section chips are numbered, so their visible text is "2" — the
      // section name is only in the accessible name, which is what this matches.
      await page
        .getByRole("button", { name: /Hose Advance:/i })
        .first()
        .click({ timeout: 15_000 });
      // The button only exists while the clock is stopped — once it is running
      // the criterion shows the note instead, which is the state *after* the
      // tap this shot is about. Opening an in-progress test resumes the timer,
      // so pause it first.
      const pause = page.getByRole("button", { name: "Pause timer" });
      if (await pause.isVisible().catch(() => false)) {
        await pause.click({ timeout: 10_000 });
      }
      const button = page.getByRole("button", { name: /START CLOCK/i }).first();
      await button.waitFor({ timeout: 20_000 });
      await button.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(400);
    },
    fullPage: false,
  },
  {
    id: "09-17-scoring-criteria-mix",
    doc: "09-skills-testing.md",
    line: 480,
    anchor: "The active scoring screen's criteria area",
    alt: "A section of the scoring screen — a critical step marked Critical, the count of steps scored, and the mix of scored and blank steps beneath",
    route: "/training/skills-testing",
    prepare: openFirstFromApi(
      "/training/skills-testing/tests?limit=50",
      (id) => `/training/skills-testing/test/${id}/active`,
      "tests",
      (test) => test.status === "in_progress",
    ),
    // The section body rather than the whole page: the header and the timer are
    // in 09-16, and this placeholder is about the steps themselves.
    selector: "div.space-y-6:has(h2)",
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
      // A passing one that is *not* full marks: the failed scorecard is 09-19,
      // and a flat 100% demonstrates nothing about how the percentage is made
      // up — no section differs from another and no step carries a note.
      //
      // Pinned to the 78% fixture (39 of 50, which `seed_scored_test` fixes and
      // comments) rather than "any pass under 100". Three seeded results now
      // satisfy the looser test — one awaiting validation at 80%, and the
      // deduction fixture at 74% that `19-30` is about — so which one this
      // opened would otherwise be decided by the order the API listed them in.
      (test) =>
        test.status === "completed" &&
        test.result === "pass" &&
        (test.overallScore ?? test.overall_score) === 78,
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
    id: "04-03-election-eligibility",
    doc: "04-events-meetings.md",
    line: 1288,
    anchor:
      "Screenshot of the election detail page showing voter eligibility breakdown",
    alt: "An election's voter-eligibility panel: which membership types may vote, and how many members each holds",
    route: "/elections",
    prepare: async (page) => {
      // `?tab=eligibility` only started working on 2026-08-11 — plain state
      // before that, so this shot would have silently captured the Ballot tab.
      await openFirstFromApi(
        "/elections",
        (id) => `/elections/${id}?tab=eligibility`,
        "elections",
        (election) => election.title === "Annual Officer Elections",
      )(page);
      await page.waitForTimeout(2_500);
      // The roster is collapsed on arrival — it is a member-by-member list and
      // the tab does not assume you want it open. The breakdown the caption
      // names lives inside it.
      await page
        .getByRole("button", { name: /Voter Eligibility Roster/ })
        .first()
        .click({ timeout: 15_000 });
      await page.waitForTimeout(2_000);
      // Two artifacts of driving the page rather than reading it: the click
      // leaves focus on the roster header, which reveals the "Skip to main
      // content" link, and a full-page shot paints the fixed sidebar once at
      // whatever offset the page is scrolled to. Blur, then frame the roster
      // itself.
      // Plain JS: this file is `.mjs`, so a TypeScript cast will not parse.
      await page.evaluate(() => document.activeElement?.blur?.());
      // `scrollIntoViewIfNeeded` is a no-op when the element is already within
      // the (tall) frame, which leaves the roster pinned to the bottom edge
      // with its summary cards cut off. Scroll it to the top of the frame.
      await page
        .getByText("Voter Eligibility Roster")
        .first()
        .evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(800);
    },
    // The detector fires on the roster's zeroes — nobody ineligible, nobody
    // overridden, nobody voted yet in an election still taking nominations.
    // Those are the honest counts, and three of the four are what a
    // secretary hopes to see.
    allowEmptyState: true,
    viewport: { width: 1440, height: 1250 },
    fullPage: false,
  },
  {
    id: "04-35-minutes-linked-elections",
    doc: "04-events-meetings.md",
    line: 1357,
    anchor:
      "Screenshot of a meeting minutes detail page showing a Linked Elections section",
    alt: "The Linked Elections card on a minutes record — the election held at that meeting, with its type, position and status",
    route: "/minutes",
    prepare: async (page) => {
      await openFirstFromApi(
        "/minutes-records",
        (id) => `/minutes/${id}`,
        "minutes",
      )(page);
      await page.getByText("Linked Elections").waitFor({ timeout: 20_000 });
      await page.waitForTimeout(400);
    },
    selector: 'div:has(> h3:text-is("Linked Elections"))',
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
    // "No holder" is a deliberately vacant office on the officers list — the
    // seeder fills the elected offices and leaves the rest open, which is
    // what a real department's list looks like.
    allowEmptyState: true,
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
      "Screenshot of the Module Management section showing the module categories",
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
      "Screenshot of the Email Templates sidebar showing its collapsible category",
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
    // Documents the 2026-08-17 permission change: /scheduling/platoons moved
    // from scheduling.view (implicit for every member) to scheduling.manage,
    // so this is the one change in that release that takes away access someone
    // already had. Shot as the member precisely because the refusal is the
    // subject -- an admin capture would show the working page and teach the
    // opposite of the caption.
    id: "19-01-platoons-permission-error",
    doc: "19-august-2026-release-changes.md",
    line: 446,
    anchor: "the permission error a member without",
    alt: "Platoon Management refusing a member who does not hold scheduling.manage",
    route: "/scheduling/platoons",
    auth: "member",
    fullPage: false,
  },
  {
    // The cards read "0 attendees - 0 action items" over meetings that had
    // both until the 2026-08-17 fix. The existing guide-04 capture pictures the
    // defect, so this replaces rather than supplements it.
    id: "19-02-minutes-card-counts",
    doc: "19-august-2026-release-changes.md",
    line: 559,
    anchor: "the Minutes page card grid with populated",
    alt: "Meeting cards showing real attendee and action-item counts",
    // /minutes is the page; /meetings is the API it was rebuilt onto. Visiting
    // /meetings silently lands on the dashboard, which is a screenshot of the
    // wrong screen rather than an error.
    route: "/minutes",
    fullPage: true,
  },
  {
    // The rewrite's whole claim is in the first screen: the department, not the
    // platform, controls the data. Shot signed out because /privacy is reachable
    // from the sign-in page and that is where a member being onboarded meets it.
    id: "19-03-privacy-header",
    doc: "19-august-2026-release-changes.md",
    line: 493,
    anchor: "the rewritten `/privacy` page header showing the",
    alt: "The rewritten Privacy Policy above the fold, opening with who controls the system and the department's ownership of every account on it",
    route: "/privacy",
    auth: "anonymous",
    fullPage: false,
  },
  {
    // The directory is the page the release added; the search is what makes it
    // a directory rather than a list. "Station" matches the seeded stations
    // without naming a room, so nothing sensitive is on screen -- which the
    // marker asks for explicitly.
    id: "19-04-qr-directory-search",
    doc: "19-august-2026-release-changes.md",
    line: 80,
    anchor: "Check-In QR Codes directory search results with Download PNG",
    alt: "The Check-In QR Codes directory filtered to the stations, each card offering Copy URL, Download PNG and Regenerate above the Print All and Room signs controls",
    route: "/locations/qr-codes",
    prepare: async (page) => {
      const search = page
        .getByPlaceholder(/search/i)
        .or(page.getByRole("searchbox"))
        .first();
      await search.waitFor({ state: "visible", timeout: 20_000 });
      await search.fill("Station");
      // The list filters as you type; give React a frame to settle before the
      // shutter, or the capture catches the unfiltered list.
      await page.waitForTimeout(800);
    },
    fullPage: true,
  },
  {
    // The warning is the subject: a regenerated code silently invalidates a
    // sign already printed and hung on a wall, and that consequence only exists
    // in this dialog.
    id: "19-05-qr-regenerate-warning",
    doc: "19-august-2026-release-changes.md",
    line: 82,
    anchor: "regenerate-code confirmation explicitly warning that the",
    alt: "The regenerate-code confirmation, warning that the code already printed stops working once a new one is issued",
    route: "/locations/qr-codes",
    prepare: async (page) => {
      await clickByName(/^Regenerate$/)(page);
      await page
        .getByRole("dialog")
        .first()
        .waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(400);
    },
    fullPage: false,
  },
  {
    // The release added the activity cards and made the list filter on the same
    // states they count. Shot on the Orders tab with a status filter applied so
    // the cards and the list the reader is being told they match are both in
    // frame; the seeder now leaves orders in four distinct states so the
    // workflow breakdown is not a column of zeroes with one number in it.
    id: "19-06-store-admin-orders",
    doc: "19-august-2026-release-changes.md",
    line: 64,
    anchor: "Store Admin with activity/status cards and a matching filtered",
    alt: "Store Admin's Orders tab narrowed to paid orders, the list showing only the two the status filter matches",
    route: "/store/admin",
    prepare: async (page) => {
      // Scoped to the tab strip. A bare name match also hits the Overview's
      // recent-order rows, and clicking one of those opens the order modal over
      // the list -- which is what the first capture of this shot contained.
      await page
        .locator(".tab-scroll button")
        .filter({ hasText: "Orders" })
        .first()
        .click({ timeout: 10_000 });
      const status = page.locator("#order-status-filter");
      await status.waitFor({ state: "visible", timeout: 20_000 });
      // Wait for the filtered fetch itself, not for a row count. The list is
      // still the unfiltered one until that response lands, and the count
      // depends on how many orders the seeder has advanced to paid -- which
      // moves between runs, so waiting for a specific "N of N" made the shot
      // pass or time out depending on the demo data rather than on the page.
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes("/store/orders?") &&
            response.url().includes("status=paid"),
          { timeout: 20_000 },
        ),
        status.selectOption({ label: "Paid" }),
      ]);
    },
    fullPage: true,
  },
  {
    // The other half of the same release note. The activity cards and the
    // order-workflow breakdown are on Overview; the list they describe is on
    // Orders. One tab cannot show both, so the guide carries both images and
    // says which is which rather than a caption claiming a screen that is not
    // in the frame.
    id: "19-08-store-admin-activity",
    doc: "19-august-2026-release-changes.md",
    line: 64,
    anchor: "__paired-with-19-06__",
    alt: "Store Admin's Overview: the activity counts across the top and the order-workflow breakdown counting each fulfilment state the Orders list can be filtered by",
    route: "/store/admin",
    fullPage: true,
  },
  {
    // Shot as the member, not the administrator: this is the member's own
    // order, and an admin looking at the same order gets the reconciliation
    // controls instead of the "tell us how you paid" editor the guide means.
    id: "19-07-member-payment-method",
    doc: "19-august-2026-release-changes.md",
    line: 66,
    anchor: "member order payment-method editor plus the explanatory text",
    alt: "A member changing the payment method on their own order: a method picker over the department's payment handles and the \"I've sent payment\" report",
    route: "/store/orders",
    auth: "member",
    prepare: async (page) => {
      await clickByName(/Change payment method/i)(page);
      await page.waitForTimeout(800);
    },
    fullPage: true,
  },
  {
    // The blank sheet, printed from a published template. The route reads the
    // template from ?id, so it is discovered at capture time like every other
    // detail shot -- the seeder mints template ids afresh on each run.
    id: "09-22-template-print-sheet",
    doc: "09-skills-testing.md",
    line: 1242,
    anchor: "the Templates tab row actions with **Print** visible",
    alt: "A blank skill sheet as it prints: the sections, the criteria, and a marking box beside each step for the examiner to fill in by hand",
    route: "/training/skills-testing",
    prepare: openFirstFromApi(
      "/training/skills-testing/templates?limit=50",
      (id) => `/training/skills-testing/print/template?id=${id}`,
      "templates",
      // The weighted sheet: it is the one carrying more than one section and a
      // mix of scored and pass/fail criteria, which is what the marker asks to
      // be visible in a single frame. A pass/fail-throughout template prints
      // one kind of box and teaches nothing about the difference.
      (template) =>
        (template.status ?? "") === "published" &&
        /Handline Advance/.test(template.name ?? ""),
    ),
    fullPage: true,
  },
  {
    // The officer's view of a validated result. Shot as the administrator
    // because the examiner's written notes are the half that disappears under
    // a restricted disclosure -- the candidate's view of this same record is
    // the shot below, and the pair is the teaching point.
    id: "09-23-scorecard-print-officer",
    doc: "09-skills-testing.md",
    line: 1244,
    anchor: "a completed scorecard print preview showing the per-step marks",
    alt: "A validated scorecard as it prints: per-step marks, the section arithmetic behind the 78% total, a step marked 5 of 10 with the examiner's note explaining the deduction, and the validating officer's sign-off",
    route: "/training/skills-testing",
    prepare: openFirstFromApi(
      "/training/skills-testing/tests?limit=200",
      (id) => `/training/skills-testing/print/scorecard?id=${id}`,
      "tests",
      // Validated, not merely completed: the print page refuses a result that
      // is still awaiting an officer, which is the guide's own edge case. Not
      // voided, because a rebuilt fixture leaves its predecessor behind -- a
      // validated result cannot be deleted -- and the withdrawn copy carries
      // the same scores as the live one.
      // Pinned to the 78% fixture. This shot and 09-24 are a pair -- the same
      // record under two accounts -- and both matched "any validated pass"
      // until the deduction fixture gave them a second one to choose from,
      // with nothing making the two halves agree on which.
      (test) =>
        Boolean(test.validated_at ?? test.validatedAt) &&
        !(test.voided_at ?? test.voidedAt) &&
        test.result === "pass" &&
        (test.overallScore ?? test.overall_score) === 78,
    ),
    fullPage: true,
  },
  {
    // The same record as 09-23, printed by the candidate it belongs to. The
    // weighted template's result_disclosure is seeded as `scores` -- an
    // override that changes nothing about the officer's own view above, only
    // what the candidate is shown: marks and the arithmetic, no examiner
    // notes. Officers always see the full sheet regardless of this setting.
    id: "09-24-scorecard-print-candidate",
    doc: "09-skills-testing.md",
    line: 1246,
    anchor:
      "the same scorecard as seen by a candidate under `scores` disclosure",
    alt: "The same validated scorecard printed by the candidate under scores disclosure: per-step marks and the section arithmetic, with the examiner's note absent",
    route: "/training/skills-testing",
    auth: "member",
    prepare: openFirstFromApi(
      "/training/skills-testing/tests?limit=200",
      (id) => `/training/skills-testing/print/scorecard?id=${id}`,
      "tests",
      // Pinned to the 78% fixture. This shot and 09-24 are a pair -- the same
      // record under two accounts -- and both matched "any validated pass"
      // until the deduction fixture gave them a second one to choose from,
      // with nothing making the two halves agree on which.
      (test) =>
        Boolean(test.validated_at ?? test.validatedAt) &&
        !(test.voided_at ?? test.voidedAt) &&
        test.result === "pass" &&
        (test.overallScore ?? test.overall_score) === 78,
    ),
    fullPage: true,
  },
  {
    // New screen in this release. Seeded with one published notice and one
    // draft so the two states sit side by side -- with nothing adopted both
    // cards show the platform default, which pictures the feature unused.
    id: "19-09-legal-documents",
    doc: "19-august-2026-release-changes.md",
    line: 545,
    anchor: "Governance → Legal Documents landing view, showing",
    alt: "Governance → Legal Documents: the Privacy Notice card published with its last-updated line, beside a Terms of Service card still carrying an unpublished draft",
    route: "/governance/legal",
    fullPage: true,
    allowEmptyState:
      'Matches "No proposals yet" -- the Proposed revisions panel on the ' +
      "Privacy tab, empty on purpose. The seeded draft sits on Terms of " +
      "Service so the published and draft states can be told apart. The " +
      "published text and both history entries are on screen.",
  },
  {
    // Recruitment is create-only for the automatic switches, so this has to be
    // the new-event form rather than an edit of a seeded event -- changing an
    // existing event's type deliberately does not flip them, and a capture
    // taken that way would show the banner absent and teach the opposite.
    id: "19-10-event-recruitment-type",
    doc: "19-august-2026-release-changes.md",
    line: 703,
    anchor: "the event form with Recruitment selected, showing",
    alt: "A new event with Recruitment chosen: guest sign-in and create-a-prospect both switched on, under the banner explaining that guests reach the prospective-members pipeline",
    route: "/events/new",
    allowEmptyState:
      'Matches "No reminders", one of the three options inside the ' +
      "reminder-audience select rather than an empty state. The form is fully " +
      "rendered with Recruitment chosen and both guest switches on.",
    prepare: async (page) => {
      const type = page
        .locator("select")
        .filter({ has: page.locator('option[value="recruitment"]') })
        .first();
      await type.waitFor({ state: "visible", timeout: 20_000 });
      await type.selectOption("recruitment");
      // The switches and the banner are painted from the type change, not with
      // the form, so shooting immediately catches the pre-selection state.
      await page.waitForTimeout(900);
    },
    fullPage: true,
  },
  {
    // Half of a pair. The dashboard's Organization tab is addressable by
    // ?tab=organization, so neither of these needs a click that could land on
    // the wrong control.
    id: "08-75-org-dashboard-with-finance",
    doc: "08-admin-reports.md",
    line: 2141,
    anchor: "the organization dashboard under two accounts side by",
    alt: "The dashboard's Department pulse as an administrator holding finance.manage: dues, cash flow, budget and grant cards among the operational ones",
    // The default tab, not ?tab=organization. Department pulse is where the
    // money cards live -- the Organization tab carries readiness, exceptions
    // and asset counts and has no finance section on it for either account, so
    // a pair shot there compares two screens that are identical in the one
    // respect the marker is about.
    route: "/dashboard",
    fullPage: true,
  },
  {
    // The same tab as an ordinary member. The point is that the finance
    // sections are *absent* rather than empty -- an empty card would tell a
    // member the department has finance data and they are not trusted with it,
    // which is the inference the omission is designed to prevent. Shot as the
    // member for that reason; an admin capture cannot show an absence.
    id: "08-76-org-dashboard-without-finance",
    doc: "08-admin-reports.md",
    line: 2141,
    anchor: "__paired-with-08-75__",
    alt: "The same dashboard as a member without finance.manage: Department pulse is not rendered at all, rather than shown with empty money cards",
    route: "/dashboard",
    auth: "member",
    fullPage: true,
    allowEmptyState:
      "A member without the finance, fundraising or outreach permissions is " +
      "meant to see fewer sections here -- the omission is the subject of the " +
      "shot, so an empty-state match on the remaining page is expected rather " +
      "than a sign the demo data is missing.",
  },
  {
    // Viewport-sized rather than fullPage, because a stitched full-page capture
    // contains no scrollbar at all.
    //
    // This comment used to say the gutter could not be photographed, because
    // `window.innerWidth - documentElement.clientWidth` measures 0 here. That
    // was the wrong instrument: the captured PNG carried a 15px pure-white
    // strip down its right edge against dark content, which audit_images.py
    // found by comparing edge pixels with the content beside them, and which
    // the DOM measurement never saw. Read the file, not the geometry.
    //
    // The cause was a root element carrying the themed gradient as a background
    // *image* with no background *colour* (the `background:` shorthand resets
    // it), so the reserved strip fell back to white. Fixed in styles/index.css;
    // this shot is the evidence and is re-captured against it.
    id: "19-11-dark-scrollbar-gutter",
    doc: "19-august-2026-release-changes.md",
    line: 222,
    anchor: "a public page (`/f/{slug}` or an application-status link) in dark",
    alt: "A public form in dark mode at full window width, the themed gradient reaching the window edges",
    route: "/login",
    auth: "anonymous",
    theme: "dark",
    fullPage: false,
    prepare: openPublicForm,
  },
  {
    // Clipped to the Notifications panel. The three choices cannot be shown
    // "visible" as the marker asks: this is a native <select>, and an open
    // select popup is drawn by the OS rather than the page, so it never appears
    // in a screenshot. The guide already tables all three above the image; what
    // the capture can honestly show is which one a new optional event starts
    // on, which is the other half of that marker.
    id: "04-44-reminder-audience",
    doc: "04-events-meetings.md",
    line: 1539,
    anchor: "Create Event → Notifications with all three",
    alt: "The Notifications panel on a new optional event, its reminder audience defaulting to Members who sign up",
    route: "/events/new",
    selector: "section:has(> h2:has-text('Notifications'))",
    allowEmptyState:
      'Same "No reminders" select option as 19-10. The panel is populated: the ' +
      "audience reads Members who sign up and the schedule carries a " +
      "1 day before reminder.",
    prepare: async (page) => {
      await page
        .locator("#reminder-target")
        .waitFor({ state: "visible", timeout: 20_000 });
    },
  },
  {
    // The panel beside it, clipped the same way. Flexible and 60 minutes are
    // what a new event starts on, so no interaction is needed -- and shooting
    // the default is the point, since the guide's caution is that 60 does not
    // apply to every mode.
    id: "04-45-checkin-flexible-default",
    doc: "04-events-meetings.md",
    line: 1573,
    anchor: "Check-In Settings showing Flexible and 60 minutes before",
    alt: "Check-In Settings on a new event: the Flexible window with self check-in opening 60 minutes before the start",
    route: "/events/new",
    selector: "section:has(> h2:has-text('Check-In Settings'))",
    prepare: async (page) => {
      await page
        .locator("#checkin-window")
        .waitFor({ state: "visible", timeout: 20_000 });
    },
  },
  {
    // The mandatory counterpart to 04-44: checking Mandatory attendance with
    // the audience never touched flips the default to All active members, per
    // the edge case above the marker. Nothing is submitted, so this writes
    // nothing and needs no `mutatesSeedData` flag.
    id: "04-46-mandatory-reminder-audience",
    doc: "04-events-meetings.md",
    line: 1572,
    anchor:
      "mandatory-event form after the Mandatory switch is enabled, showing",
    alt: "The Notifications panel after checking Mandatory attendance on a new event: the reminder audience switching to All active members",
    route: "/events/new",
    selector: "section:has(> h2:has-text('Notifications'))",
    prepare: async (page) => {
      await page.locator("#is-mandatory").check();
      await page
        .locator("#reminder-target")
        .waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(300);
    },
    // Same false trigger as 04-44/19-10: "No reminders" is one of the three
    // <option>s on #reminder-target, present in the DOM whatever is
    // selected. The control itself reads All active members.
    allowEmptyState:
      '"No reminders" is an unselected <option> of the reminder-target ' +
      "select, not a state this form is in -- the control reads All active " +
      "members. Unselected options sit in the DOM whatever is chosen.",
  },
  {
    // The other half of the marker: a template's own audience, saved
    // independently of any event's mandatory flag. "Weekly Company Drill" is
    // seeded non-mandatory but with reminder_target overridden to `all` --
    // the value a mandatory event defaults to, on a template that is not one
    // -- which is what "independently saved" means in a single frame.
    //
    // Applied by hand alongside 04-46, not by apply_placeholders: the marker
    // is one blockquote for both images, and once 04-46 fills it there is no
    // placeholder left for a second anchor to find -- the same reason 17-04
    // is a manual pair with 17-03. This entry exists so a future UI change
    // still gets the image re-captured.
    id: "04-47-template-reminder-audience",
    doc: "04-events-meetings.md",
    line: 1572,
    anchor: "__paired-with-04-46__",
    alt: "The Weekly Company Drill event template, not mandatory, with its own reminder audience saved as All active members",
    route: "/events/templates",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "Edit Weekly Company Drill" })
        .click({ timeout: 15_000 });
      // Not #reminder-target: the template form's own control, distinct from
      // the event form's id of the same name.
      const control = page.locator("#template-reminder-target");
      await control.waitFor({ state: "visible", timeout: 20_000 });
      // The reminders section sits below the fold in the modal's own
      // scrolling panel -- a full-page shot of the outer document does not
      // reach it, so this scrolls the panel itself rather than the page.
      await control.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    },
    fullPage: false,
  },
  {
    // The Prospective Members card on the event detail page, populated. The
    // event is Recruitment-typed with guest sign-in and create-a-prospect
    // both on, and three named guests actually signed in through the public
    // kiosk path -- an attendee added by an officer creates no pipeline card
    // at all, so only that path produces this state.
    id: "04-48-event-linked-prospects",
    doc: "04-events-meetings.md",
    line: 1627,
    anchor: "an event detail page showing its linked prospects",
    alt: "An event's detail page with the Prospective Members card populated: three named applicants who came from this open house, each linked into the pipeline",
    route: "/events",
    prepare: openFirstFromApi(
      "/events?limit=100",
      (id) => `/events/${id}`,
      "events",
      (event) => event.title === "Fall Recruitment Open House",
    ),
    fullPage: true,
    // The event does not collect RSVPs -- guests sign in at the kiosk, not
    // through the app -- so that section's own empty state is correct and
    // unrelated to the Prospective Members card the shot is about, which is
    // populated with three named applicants.
    allowEmptyState:
      "The event has requires_rsvp off, so its RSVP section correctly " +
      "reads no RSVPs yet -- guests sign in at the kiosk. The Prospective " +
      "Members card lower on the page carries the three named applicants.",
  },
  {
    // Signed-in member, not the guest kiosk -- the marker is explicit that a
    // guest account must not be used for this capture, since an anonymous
    // early arrival is blocked outright rather than admitted with a notice.
    // The event is seeded 90 minutes out on every run, the midpoint of the
    // one-to-two-hour early-arrival band `_validate_check_in_window` allows,
    // so a capture some minutes after seeding still lands inside it.
    //
    // Real mutation (self_check_in auto-creates the RSVP and marks it
    // checked in), and this is the last 04-* shot in the manifest, so it is
    // flagged rather than relying on nothing later existing by accident.
    id: "04-49-early-checkin-notice",
    doc: "04-events-meetings.md",
    line: 1606,
    anchor: "early Flexible member notice with the localized official",
    alt: "A member checking in about 30 minutes before a Flexible event's official window opens: a success screen with an informational notice naming the localized time the window actually starts",
    route: "/events",
    auth: "member",
    prepare: async (page) => {
      await openFirstFromApi(
        "/events?limit=100",
        (id) => `/events/${id}/check-in`,
        "events",
        (event) => event.title === "Thursday Skills Review",
      )(page);
      await page
        .getByRole("button", { name: /^Check In to This Event$/ })
        .click({ timeout: 15_000 });
      await page.getByRole("status").waitFor({ timeout: 20_000 });
      await page.waitForTimeout(300);
    },
    fullPage: true,
    mutatesSeedData: true,
  },
  {
    // Half of a permission pair, both opening the SAME colleague's profile.
    // The member chosen is the one enrolled in TOTP, per the marker, though
    // see the caption: no account-security block renders on a colleague's
    // profile for anybody -- enrolment is shown on your own settings page.
    // What actually differs is the compliance summary, the training and
    // certification history, and the emergency contacts.
    id: "17-03-profile-as-officer",
    doc: "17-privacy-data-rights.md",
    line: 137,
    anchor: "the same member profile viewed with `members.view`",
    alt: "A colleague's profile as an officer: compliance summary, training and certification history and emergency contacts all present",
    route: "/members",
    prepare: openMemberProfile,
    fullPage: true,
  },
  {
    id: "17-04-profile-as-member",
    doc: "17-privacy-data-rights.md",
    line: 137,
    anchor: "__paired-with-17-03__",
    alt: "The same profile as an ordinary member: contact details and assigned gear remain, while the compliance summary, training history and emergency contacts are not rendered",
    route: "/members",
    auth: "member",
    prepare: openMemberProfile,
    fullPage: true,
    allowEmptyState:
      "A member is meant to see fewer panels on a colleague's profile -- the " +
      "missing ones are the subject of the shot, so a thinner page is the " +
      "result rather than a sign of missing demo data.",
  },
  {
    // The deepest seeded room, chosen so the whole containment chain is in the
    // closed control: Locker Cage inside Quartermaster's Storage inside the
    // Volunteer Office inside Station 1.
    //
    // The marker also asked for indented sub-rooms in the open list. That half
    // is not capturable and is not what the product does: the picker is a
    // native <select>, whose popup is drawn by the OS rather than the page, and
    // its options are flat -- each carries its full path as text instead of
    // being indented under a parent. The guide says so beside the image.
    id: "06-27-event-room-picker-path",
    doc: "06-apparatus-facilities.md",
    line: 283,
    anchor: "an event form's room picker with indented sub-rooms",
    alt: "The event form's location picker with a nested room chosen, the control showing the full containment path from the room up to its station",
    route: "/events/new",
    selector: "section:has(> h2:has-text('Location'))",
    prepare: async (page) => {
      const picker = page.locator("#location-select");
      await picker.waitFor({ state: "visible", timeout: 20_000 });
      const value = await page
        .locator("#location-select option")
        .filter({ hasText: "Locker Cage" })
        .first()
        .getAttribute("value");
      if (!value) throw new Error("no nested room in the location picker");
      await picker.selectOption(value);
      await page.waitForTimeout(600);
    },
  },
  {
    // The overdue loan, on the item that carries it. The Gas Meter is out to a
    // member past its return date while the Thermal Imaging Camera is out and
    // not yet due, which is the pair the marker asks to be seeded -- the
    // caption points at both, and this is the one whose deadline has passed.
    id: "05-82-item-overdue-loan",
    doc: "05-inventory.md",
    line: 2258,
    anchor: "item issue/detail view with a temporary return deadline",
    alt: "An item on temporary issue past its return date: the history entry naming the borrower, the reason, the return deadline in the department's timezone, and that it is overdue and not yet returned",
    route: "/inventory/items",
    prepare: openOverdueItem,
    fullPage: true,
  },
  {
    // Separation of duties is about people, not permissions: the chief holds
    // `scheduling.manage` and still cannot review the swap they raised. Shot as
    // the administrator for exactly that reason -- the refusal only exists for
    // the requester, so a capture under any other account shows the control
    // working and teaches the opposite of the caption. The seeder puts one
    // swap in the administrator's name beside the demo member's, which is what
    // makes the two rows differ on screen.
    id: "03-78-swap-review-blocked",
    doc: "03-scheduling.md",
    line: 2777,
    anchor: "Scheduling → Requests viewed by the member who raised",
    alt: "The Requests tab refusing the administrator's press of Approve on the swap they raised themselves; their own row carries an extra cancel control the member's row below it does not",
    route: "/scheduling?tab=requests",
    fullPage: false,
    prepare: reviewOwnSwapBlocked,
  },
  {
    // The tab opens filtered to Pending, and a department's long history is by
    // definition resolved -- so the control the marker asks for is invisible
    // until the filter is widened. That is the shot: All Statuses, the
    // twenty-row first page, and the fetch-the-next-page control under it.
    id: "03-79-requests-load-more",
    doc: "03-scheduling.md",
    line: 2793,
    anchor: "Scheduling → Requests with the pagination control",
    alt: "The bottom of the Requests tab's first page of time-off requests, with the Load more time-off requests control beneath the twentieth row",
    route: "/scheduling?tab=requests",
    fullPage: false,
    prepare: openRequestsHistoryPage,
  },
  {
    id: "19-12-swap-review-blocked",
    doc: "19-august-2026-release-changes.md",
    line: 625,
    anchor: "the Requests tab under an account that raised one of",
    alt: "The release's separation-of-duties rule in force: Approve refused on the administrator's own swap request, with another member's row still reviewable",
    route: "/scheduling?tab=requests",
    fullPage: false,
    prepare: reviewOwnSwapBlocked,
  },
  {
    id: "19-13-requests-load-more",
    doc: "19-august-2026-release-changes.md",
    line: 654,
    anchor: "Scheduling → Requests with pagination controls",
    alt: "The paged Requests tab: twenty time-off rows and the control that fetches the next page",
    route: "/scheduling?tab=requests",
    fullPage: false,
    prepare: openRequestsHistoryPage,
  },
  {
    // The submitted state, not the form. Shot as the member because this is
    // the member's own record of what they inspected, and the guide's claim --
    // that a replayed queue resolves to one record -- is about the crew's copy.
    //
    // The offline/queued half of the marker is deliberately not staged: the
    // harness sets no browser-context state in a prepare step, so an "offline"
    // banner here would be a screenshot of a lie. The caption says so.
    id: "03-80-submitted-check-phone",
    doc: "03-scheduling.md",
    line: 2819,
    anchor: "a submitted shift equipment check on a 390x844",
    alt: "One submitted engine check read back on a phone: passed overall, who signed it, when, and every item in the order the checklist walks the truck",
    route: "/scheduling?tab=equipment-checks",
    auth: "member",
    viewport: { width: 390, height: 844 },
    prepare: openSubmittedCheck,
    fullPage: true,
  },
  {
    id: "19-14-submitted-check-phone",
    doc: "19-august-2026-release-changes.md",
    line: 672,
    anchor: "a completed shift equipment check on a phone viewport",
    alt: "A completed check as one record on a phone — the state a replayed queue or a double-tapped Submit resolves to",
    route: "/scheduling?tab=equipment-checks",
    auth: "member",
    viewport: { width: 390, height: 844 },
    prepare: openSubmittedCheck,
    fullPage: true,
  },
  {
    id: "10-17-tall-dialog-action-row",
    doc: "10-mobile-pwa.md",
    line: 797,
    anchor: "a tall dialog on a 390x844 viewport, scrolled to its",
    alt: "A dialog taller than the phone screen, scrolled to its Cancel and Save row — the bottom navigation bar is gone while it is open, so both buttons are reachable",
    route: "/training/courses",
    viewport: { width: 390, height: 844 },
    fullPage: false,
    prepare: openTallDialogAtActionRow,
  },
  {
    id: "19-15-tall-dialog-action-row",
    doc: "19-august-2026-release-changes.md",
    line: 728,
    anchor: "a tall dialog on a 390x844 viewport scrolled to its",
    alt: "The fix in force: a dialog scrolled to its action row on a phone, with no navigation bar painting over the buttons",
    route: "/training/courses",
    viewport: { width: 390, height: 844 },
    fullPage: false,
    prepare: openTallDialogAtActionRow,
  },
  {
    // Half of a pair, and only meaningful as one: the marker says so, and it
    // is right -- a stacked list nobody has seen wide reads as an ordinary
    // card layout rather than as a table that reflowed.
    //
    // The training history rather than the documents table the marker
    // suggests: /documents lists folders until one is opened, and the largest
    // seeded folder holds two files, so the wide half would be a two-row table
    // -- too thin to read as a table at all. The guide's own list of what
    // reflowed names the training table alongside documents.
    id: "10-18-training-table-phone",
    doc: "10-mobile-pwa.md",
    line: 814,
    anchor: "one of the reflowed tables (documents or check-in) at",
    alt: "One member's training history on a 390px phone: each row has become a stacked card, every value carrying its own column label, with nothing to scroll sideways",
    route: "/members",
    viewport: { width: 390, height: 844 },
    prepare: openTrainingHistoryTable,
  },
  {
    id: "10-19-training-table-desktop",
    doc: "10-mobile-pwa.md",
    line: 814,
    anchor: "__paired-with-10-18__",
    alt: "The same three records at desktop width — one row each across Course, Type, Date, Hours, Expires, Status and Files",
    route: "/members",
    prepare: openTrainingHistoryTable,
  },
  {
    // Shot as the secretary, because the *absence* is the subject and an
    // administrator's capture of the same card shows Publish and teaches the
    // opposite. Their own draft, not the administrator's: the page allows
    // editing to the author or to anyone who can publish, so a draft somebody
    // else wrote offers the secretary nothing at all and pictures no rule.
    id: "08-77-legal-proposal-as-proposer",
    doc: "08-admin-reports.md",
    line: 2121,
    anchor: "the revision editor captured under an account holding",
    alt: "The secretary's own proposed revision to the Terms: Edit and Discard, and no Publish to members — beside the administrator's draft, which offers them nothing",
    route: "/governance/legal",
    auth: "secretary",
    prepare: openOwnLegalProposal,
    fullPage: true,
  },
  {
    id: "08-78-legal-revision-history",
    doc: "08-admin-reports.md",
    line: 2149,
    anchor: "the revision history for one document showing a",
    alt: "The privacy notice's published history: the live revision above two replaced ones, each with its change note, its publisher and the moment it went out",
    route: "/governance/legal",
    // Clipped to the history section. The whole page also carries the privacy
    // notice's "No proposals yet" -- true, and nothing to do with this shot,
    // but enough for the empty-state guard to hold the capture back.
    selector: "section:has(> h2:has-text('Published history'))",
    prepare: openLegalHistory,
  },
  {
    id: "19-16-legal-revision-editor",
    doc: "19-august-2026-release-changes.md",
    line: 563,
    anchor: "the revision editor with the body text area, the",
    alt: "The revision editor under a propose-only account: the document text, the filled-in change note, and the free-text Effective date printed to members as Last updated",
    route: "/governance/legal",
    auth: "secretary",
    prepare: openLegalRevisionEditor,
    fullPage: true,
  },
  {
    id: "19-17-legal-revision-history",
    doc: "19-august-2026-release-changes.md",
    line: 602,
    anchor: "the revision history for one document showing a",
    alt: "Three revisions of the privacy notice — one live, two replaced — each keeping the reason it was changed and who published it",
    route: "/governance/legal",
    // Clipped to the history section. The whole page also carries the privacy
    // notice's "No proposals yet" -- true, and nothing to do with this shot,
    // but enough for the empty-state guard to hold the capture back.
    selector: "section:has(> h2:has-text('Published history'))",
    prepare: openLegalHistory,
  },
  {
    // The guide-17 pair, re-shot for this release note. See 17-03: there is no
    // account-security block on a colleague's profile for anybody, so the
    // marker's "use a demo member with MFA enabled so the redaction is
    // visible" cannot be honoured -- MFA enrolment is shown on your own
    // settings page. What the permission actually changes is large and
    // visible, and is what the pair shows.
    id: "19-18-profile-as-officer",
    doc: "19-august-2026-release-changes.md",
    line: 308,
    anchor: "the same colleague profile side by side as seen with",
    alt: "A colleague's profile with the officer's grant: the compliance summary, the training and certification history and the emergency contacts are all rendered",
    route: "/members",
    prepare: openMemberProfile,
    fullPage: true,
  },
  {
    id: "19-19-profile-as-member",
    doc: "19-august-2026-release-changes.md",
    line: 308,
    anchor: "__paired-with-19-18__",
    alt: "The same profile as an ordinary member: contact details and assigned gear remain, while the compliance summary, training history and emergency contacts are not rendered at all",
    route: "/members",
    auth: "member",
    prepare: openMemberProfile,
    fullPage: true,
    allowEmptyState:
      "A member is meant to see fewer panels on a colleague's profile -- the " +
      "missing ones are the subject of the shot, so a thinner page is the " +
      'result rather than a sign of missing demo data. ("No address on file." ' +
      "is separate and true of both halves: this member has none recorded, " +
      "verified against /users -- it is not what the permission withholds.)",
  },
  {
    id: "19-20-candidates-as-manager",
    doc: "19-august-2026-release-changes.md",
    line: 312,
    anchor: "member candidate list on an election in nominations phase",
    alt: "The candidate list as an elections manager: both the accepted candidate and the nominee who has not yet accepted",
    route: "/elections",
    prepare: openElectionTab("candidates", isPostNominationElection),
    fullPage: true,
    allowEmptyState:
      'Matches "No votes cast yet" from the results panel, which is true and ' +
      "expected on an election still open. The candidate list this shot is " +
      "about carries both nominees.",
  },
  {
    id: "19-21-candidates-as-member",
    doc: "19-august-2026-release-changes.md",
    line: 312,
    anchor: "__paired-with-19-20__",
    alt: "The same election as an ordinary member: the ballot offers only the candidate who accepted, the pending nomination withheld now that nominations have closed",
    route: "/elections",
    auth: "member",
    prepare: openFirstFromApi(
      "/elections?limit=20",
      (id) => `/elections/${id}`,
      "elections",
      isPostNominationElection,
    ),
    fullPage: true,
    allowEmptyState:
      "A member is meant to see a shorter list here -- the withheld pending " +
      "nomination is the subject of the shot, so one name on the ballot is " +
      "the result rather than missing demo data.",
  },
  {
    // Step 3 again, but under the rule that makes outstanding checks blocking.
    // The Medic the fixture hangs on now carries its own end-of-shift template
    // (see _ensure_closeout_check_template), so there is a check nobody has
    // completed for the warning to name.
    //
    // The override box is ticked, because the reason field it demands does not
    // exist until it is -- and the marker asks for both. Ticking is client
    // state only: nothing is written until "Close out shift", which these
    // shots never press.
    id: "03-81-closeout-override",
    doc: "03-scheduling.md",
    line: 1594,
    anchor: "close-out wizard with outstanding end-of-shift checks",
    alt: "Close-out wizard step 3 with the rule in force: the outstanding equipment check named in red, the override ticked, and the reason field it requires before the shift can be closed",
    route: "/scheduling",
    prepare: async (page) => {
      await setRequireEndOfShiftChecks(true)(page);
      await openCloseoutWizard({
        step: 3,
        calls: { EMS: 3, Fire: 1 },
        credit: 2,
      })(page);
      await page
        .getByRole("checkbox", { name: /Close out anyway/i })
        .check({ timeout: 20_000 });
      await page
        .getByLabel(/Reason for closing out with checks outstanding/i)
        .waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(400);
    },
    viewport: CLOSEOUT_VIEWPORT,
    selector: CLOSEOUT_WIZARD_CARD,
    fullPage: false,
  },
  {
    id: "19-22-admin-hours-summary-year",
    doc: "19-august-2026-release-changes.md",
    line: 51,
    anchor: "Admin Hours Summary on Calendar Year with at least two",
    alt: "The Admin Hours Summary on This calendar year: counted, approved and needs-review totals over a year of logged time, ranked by the category it was logged against",
    route: "/admin-hours/manage",
    prepare: openAdminHoursSummary,
    fullPage: true,
  },
  {
    // Half of a pair. The dashboard's two tabs are the data boundary the guide
    // is about, and no single frame holds both -- the whole point is that a
    // department total and your own gear are never on screen together.
    //
    // Full page rather than framed on the gear panel. The marker asks for the
    // tab strip *and* the personal panel, and they are a screen apart -- a
    // viewport shot scrolled to one loses the other, and the caption then
    // claims a tab strip that is not in the frame.
    id: "00-24-dashboard-my-department",
    doc: "00-getting-started.md",
    line: 437,
    anchor: "leader dashboard with Personal and Organization tabs",
    alt: "The dashboard's My Department tab: the member's own attention items, shifts, hours and issued gear, under a tab strip whose other tab is Organization",
    route: "/dashboard",
    prepare: async (page) => {
      await page
        .getByRole("heading", { name: /My Issued Gear/i })
        .first()
        .waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(500);
    },
    fullPage: true,
  },
  {
    id: "00-25-dashboard-organization",
    doc: "00-getting-started.md",
    line: 437,
    anchor: "__paired-with-00-24__",
    alt: "The same dashboard on its Organization tab: department-wide scheduling and asset cards, with none of the member's own equipment on screen",
    route: "/dashboard?tab=organization",
    prepare: async (page) => {
      await page
        .getByRole("heading", { name: /Scheduling Operations/i })
        .first()
        .waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(500);
    },
    fullPage: true,
    allowEmptyState:
      '"No critical exceptions" is the answer, not the absence of one: it sits ' +
      "under the rows reading 0 on a card whose Failed equipment checks row " +
      "reads 2, so the card is populated and reporting a department with " +
      "nothing wrong in four of its five checks.",
  },
  {
    // The closed selects, not an open one: these are native <select>s, whose
    // popups the OS draws rather than the page, so the option list -- with its
    // "Officer -- Fire Chief, Deputy Chief, ..." rank annotations -- cannot be
    // photographed. What the frame does carry is the fourth seat reading
    // "rescue specialist (legacy position)", which is the half of the marker
    // that matters: a value typed before the picker existed stays readable.
    id: "19-23-apparatus-crew-seats",
    doc: "19-august-2026-release-changes.md",
    line: 111,
    anchor: "apparatus form crew-position rank picker, including one legacy",
    alt: "The rescue's crew seats: three chosen from the department's configured positions and a fourth still holding a free-text value, marked (legacy position)",
    route: "/apparatus",
    prepare: openApparatusCrewSeats,
    fullPage: false,
    allowEmptyState:
      '"No EVOC requirement" is the unselected first <option> of the EVOC ' +
      "select, not a state this rescue is in -- the control beside the seats " +
      "reads Level 2. Unselected options are in the DOM whatever is chosen.",
  },
  {
    // The section lists forms whose integration type is `event_request` and
    // nothing else: `/event-requests/forms` filters on that server-side, so
    // the department's three ordinary forms -- near-miss, gear sizing,
    // community request -- are absent from a screen an event administrator
    // reaches without holding `forms.manage` at all. That absence is the
    // marker's subject, and it is the one thing an image cannot show, so the
    // caption names the three forms that are not here.
    id: "19-24-outreach-form-section",
    doc: "19-august-2026-release-changes.md",
    line: 143,
    anchor: "Event Settings outreach-form picker under an event-admin account",
    alt: "Events Settings > Public Form: the generated outreach form listed as published and accepting submissions, with its public URL",
    route: "/events/admin?tab=settings",
    prepare: clickByName(/^Public Form/),
    fullPage: true,
  },
  {
    // Step 2 of the create wizard, which is where all three links the marker
    // names sit together: the course above, and the category / requirement /
    // program pickers below it. The event-detail card corrects these links
    // afterwards but never shows the course, so it cannot carry the caption.
    //
    // Nothing is submitted -- the wizard creates on step 4 -- so this writes
    // nothing and needs no `mutatesSeedData` flag.
    id: "19-29-training-session-linkage",
    doc: "19-august-2026-release-changes.md",
    line: 237,
    anchor: "training-session edit flow with requirement, course, and program",
    alt: "Step 2 of the training-session wizard: an existing course selected, and the category, requirement and program links under a plain-language line saying what attendance will advance",
    route: "/training/sessions/new",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^Next$/ })
        .click({ timeout: 20_000 });
      await page.getByText(/Use existing course template/).click();
      // Located by its own placeholder option, not by label: the "Select
      // Course" label on this wizard carries no `htmlFor` and the select no
      // `id`, so it has no accessible name to match on.
      const course = page.locator(
        'select:has(option:text-is("Select a course..."))',
      );
      await course.waitFor({ timeout: 10_000 });
      // Option labels carry the record's code -- "PUMP - Pump Operations",
      // "Driver / Operator Pipeline (DRV-OP)" -- and `selectOption({ label })`
      // matches exactly, so each pick is resolved to a value by substring.
      const pickByText = async (select, text) => {
        const value = await select.evaluate(
          (el, wanted) =>
            Array.from(el.options).find((option) =>
              option.text.includes(wanted),
            )?.value ?? "",
          text,
        );
        if (!value) throw new Error(`no option matching "${text}"`);
        await select.selectOption(value);
      };
      await pickByText(course, "Pump Operations");
      // Selecting a course pre-fills whatever it declares, so the picks below
      // are set afterwards rather than before -- the reverse order loses them.
      await pickByText(
        page.getByLabel(/^Training Program$/),
        "Driver / Operator Pipeline",
      );
      await pickByText(
        page.getByLabel(/^Requirement$/),
        "Pump Panel Evolutions",
      );
      await pickByText(
        page.getByLabel(/^Training Category$/),
        "Driver/Operator",
      );
      await page.waitForTimeout(500);
    },
    // Framed on the wizard, not the page. The wizard renders inside the
    // training admin frame, whose headline cards would put "COMPLIANCE --
    // could not be calculated" above a caption about linking a session: true
    // of this database (the seeded members hold three records against 26
    // requirements) and nothing to do with the marker.
    // Matched on the h1's inner <span>: the heading also holds an icon, and a
    // `text-is` on the h1 itself does not match through it.
    selector: "main:has(h1 > span:text-is('Create Training Session'))",
    allowEmptyState:
      '"No category" is the unselected first <option> of the category select, ' +
      "not a state this form is in -- the control reads Driver/Operator " +
      "(DRIVER). Unselected options sit in the DOM whatever is chosen.",
  },
  {
    // The score-breakdown panel is what carries a deduction as a line item
    // distinct from the point totals -- the officer's own scoring view, not
    // the print page, which is why this is a fresh template rather than an
    // addition to the weighted sheet 09-22/09-23 already depend on.
    id: "19-30-skill-point-deduction",
    doc: "19-august-2026-release-changes.md",
    line: 295,
    anchor: "skill result illustrating point deduction without automatic whole",
    alt: "A validated skill result's score breakdown: 47 of 50 points earned, a 10-point deduction on one failed step, netting 74% against the department's 70% pass mark -- PASS, with no critical failure",
    route: "/training/skills-testing",
    prepare: openFirstFromApi(
      "/training/skills-testing/tests?limit=200",
      (id) => `/training/skills-testing/test/${id}/active`,
      "tests",
      (test) =>
        (test.template_name ?? "").includes("Ladder Raise") &&
        test.result === "pass",
    ),
    // Not fullPage: a fixed "Back to Tests" bar sits mid-page below the
    // fold, and stitching a full-page shot over it duplicates the bar across
    // the Raise section it is meant to be beneath. Everything the caption
    // needs -- the calculation line and the deduction row -- is in the first
    // viewport.
    fullPage: false,
  },
  {
    // The seeder runs `post_event_validation` against a freshly-ended,
    // unfinalized event on every seed, so the prompt is already in the inbox
    // -- this shot only has to read it.
    id: "19-31-notification-before-action",
    doc: "19-august-2026-release-changes.md",
    line: 311,
    anchor: "same notification before and after completing its related",
    alt: "The notification inbox with an unread 'Validate attendance' prompt for a just-ended event, beside an unrelated shift-assignment notification",
    route: "/notifications?tab=inbox",
    prepare: async (page) => {
      await page
        .getByText(/Action Required: Validate attendance/)
        .waitFor({ state: "visible", timeout: 20_000 });
    },
    fullPage: true,
  },
  {
    // Completes the notification's related action directly against the API
    // (finalize-attendance), the same call `EventDetailPage`'s End Event
    // flow makes -- `archive_related_notifications` runs inside that
    // endpoint, so this is the same code path a chief clicking through would
    // take, not a shortcut around it.
    //
    // Real mutation, deliberately unflagged: `mutatesSeedData` would force
    // this to be the last shot of guide 19, and `19-26` already holds that
    // position for unrelated (election) data with its own ordering
    // dependencies. Placed before `19-25`/`19-26` instead, which is what the
    // guard actually requires -- nothing later in guide 19 reads event or
    // notification state, so no later shot can be broken by this one.
    id: "19-32-notification-after-action",
    doc: "19-august-2026-release-changes.md",
    line: 311,
    anchor: "__paired-with-19-31__",
    alt: "The same inbox after finalizing the event's attendance: the validation prompt gone, the unrelated shift-assignment notification still there",
    route: "/notifications?tab=inbox",
    prepare: async (page) => {
      const eventId = await page.evaluate(async () => {
        const res = await fetch("/api/v1/notifications/my?limit=100", {
          credentials: "include",
        });
        const body = await res.json();
        const notif = (body.logs ?? []).find(
          (log) => log.category === "event_validation",
        );
        if (!notif) throw new Error("no event_validation notification found");
        return notif.metadata?.event_id;
      });
      await page.evaluate(async (id) => {
        const csrf =
          document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] ?? "";
        const res = await fetch(`/api/v1/events/${id}/finalize-attendance`, {
          method: "POST",
          credentials: "include",
          headers: { "X-CSRF-Token": decodeURIComponent(csrf) },
        });
        if (!res.ok) throw new Error(`finalize-attendance: ${res.status}`);
      }, eventId);
      await page.reload({ waitUntil: "networkidle" });
      await page
        .getByText(/New Shift Assignment/)
        .waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(300);
    },
    fullPage: true,
  },
  {
    // The station board's message rail, framed rather than the whole board.
    // The board itself is already pictured twice -- `00-24` for the member's
    // tab and `08-75`/`08-76` for the conditional cards, which is what the
    // marker's "identified in the caption" is about -- and a third full-page
    // dashboard would be the same screen under a different caption. What is
    // not pictured anywhere is a feed carrying both kinds of item at once.
    id: "19-28-station-board-messages",
    doc: "19-august-2026-release-changes.md",
    line: 118,
    anchor: "populated station board with one pending message, one persistent",
    alt: "My Updates on the station board: unread notifications and announcements above a standing order badged Persistent, with the clear control only a manager sees",
    route: "/dashboard",
    prepare: async (page) => {
      await page
        .getByText(/^Spotter Required$/)
        .first()
        .waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(400);
    },
    selector: "section[aria-labelledby='my-updates-heading']",
  },
  {
    // The roster bound, refused. Not on the results page -- results carry no
    // trace of which votes arrived on paper, because each paper ballot is
    // written as an ordinary vote row -- so the only screen that states the
    // rule is the one that enforces it. 14 + 10 is a plausible tally for a
    // room of 22, and two over the roster is exactly the miscount this guard
    // is for.
    //
    // Refused, so it writes nothing: the batch is rejected before any vote row
    // is created, which is why this needs no `mutatesSeedData` flag.
    id: "19-27-paper-ballot-over-roster",
    doc: "19-august-2026-release-changes.md",
    line: 74,
    anchor: "closed election results showing manual paper-ballot count and its",
    alt: "Record Paper Ballots refusing a 24-ballot tally against a 22-member roster, with the override checkbox it offers instead",
    route: "/elections",
    prepare: async (page) => {
      await openFirstFromApi(
        "/elections?limit=50",
        (id) => `/elections/${id}`,
        "elections",
        (election) =>
          (election.title ?? "") === "Line Officer Election — 2027 Term",
      )(page);
      await clickByName(/^Record Paper Ballots$/)(page);
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ timeout: 20_000 });
      await dialog.getByLabel(/Dana Ruiz/).fill("14");
      await dialog.getByLabel(/Emeka Adeyemi/).fill("10");
      await dialog
        .getByRole("button", { name: /^Record 24 Ballots$/ })
        .click({ timeout: 10_000 });
      // The override checkbox renders only once the server has answered with a
      // message containing "over-count", so waiting for the alert is waiting
      // for the whole state this shot is about.
      await dialog
        .getByRole("alert")
        .getByText(/only 22 member\(s\) are eligible/)
        .waitFor({ timeout: 20_000 });
      await page.waitForTimeout(400);
    },
    selector: "div[role='dialog']",
  },
  {
    // The first half of the pair the marker asks for. Framed on the whole page
    // rather than the ballot alone, because the two facts that change sit in
    // different places: the item count inside the builder, and the voting
    // method in the details card above it. "Simple Majority" here is the
    // create form's "Supermajority Required (2/3)" -- one control that sets
    // the method and the victory condition, and only the method is on display.
    id: "19-25-ballot-template-settings-before",
    doc: "19-august-2026-release-changes.md",
    line: 33,
    anchor: "Ballot Builder → Your saved ballots, showing the visible template",
    alt: "The bylaw draft before a template is applied: one ballot item, and a details card reading Voting Method — Simple Majority",
    route: "/elections",
    prepare: async (page) => {
      await openBylawDraft(page);
      const tab = page.locator("#tab-ballot");
      await tab.waitFor({ timeout: 20_000 });
      await tab.click({ timeout: 10_000 });
      await page.waitForTimeout(500);
    },
    fullPage: true,
  },
  {
    // Applied through the picker rather than the API: the point of the pair is
    // that nothing in the confirmation says the voting method is about to
    // change, so the change has to arrive by the route a secretary takes.
    //
    // Must stay the last shot of guide 19 -- it leaves the draft holding the
    // template's four officer seats under ranked choice. `openBylawDraft` puts
    // it back for the shots that need it seeded, including the one above.
    id: "19-26-ballot-template-settings-after",
    doc: "19-august-2026-release-changes.md",
    line: 33,
    anchor: "__paired-with-19-25__",
    alt: "The same draft immediately after applying the saved officer ballot: four items replacing the one, and the details card now reading Ranked Choice",
    route: "/elections",
    prepare: async (page) => {
      await openBylawDraft(page);
      const tab = page.locator("#tab-ballot");
      await tab.waitFor({ timeout: 20_000 });
      await tab.click({ timeout: 10_000 });
      const use = page.getByRole("button", { name: /^Use Template$/ });
      await use.waitFor({ timeout: 20_000 });
      await use.click();
      const popover = page.locator(
        "div:has(> h4:text-is('Select a Template'))",
      );
      const saved = popover
        .getByRole("button", { name: /Annual officer election/ })
        .first();
      await saved.waitFor({ timeout: 10_000 });
      await saved.click();
      await popover.getByRole("button", { name: /^Replace$/ }).click();
      // Two toasts fire on a successful apply ("Ballot items saved", then
      // "Applied ..."), and a toast cannot be removed from the DOM. Waited out
      // instead: react-hot-toast's default is four seconds.
      await page
        .getByText(/^Applied "Annual officer election"$/)
        .waitFor({ timeout: 20_000 });
      await page
        .getByText(/^Applied "Annual officer election"$/)
        .waitFor({ state: "detached", timeout: 20_000 });
      await page.waitForTimeout(500);
    },
    fullPage: true,
    mutatesSeedData: true,
  },
  {
    // 375 wide, not the 390 the rest of the mobile shots use: the marker names
    // 375, and it is the narrower of the two common phone widths -- if the
    // targets hold here they hold at 390.
    //
    // Not annotated, and it does not need to be. The claim is measurable, and
    // the measurements are in the guide beside this image: 50 of the 52
    // controls on this screen are already 44px or taller, and the two that are
    // not are a painted checkbox indicator and a hidden file input, each
    // sitting inside a 44px+ label that takes the tap.
    id: "10-20-submit-training-touch-targets",
    doc: "10-mobile-pwa.md",
    line: 164,
    anchor: "manual annotation",
    alt: "The Submit Training form at 375px — full-width text fields, a certification checkbox whose whole row is the tap target, and the edit and delete icon buttons on the submission below it, all sized for a fingertip",
    route: "/training/submit",
    auth: "member",
    viewport: { width: 375, height: 812 },
    // Viewport, not full page: this form carries a sticky submit bar, and
    // full-page stitching paints a `position: fixed` element at its document
    // offset -- the bar landed across the middle of the form, over the card it
    // is meant to sit below. Framed on the Details card instead, which is
    // where the certification checkbox is, with the bar in its real place.
    prepare: async (page) => {
      const row = page
        .getByText(/This training earned a certification/i)
        .first();
      await row.waitFor({ state: "visible", timeout: 20_000 });
      // `center`, not `end`: the sticky submit bar occupies the bottom of the
      // frame, so an element scrolled to the end of the viewport lands behind
      // it.
      await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(500);
    },
    fullPage: false,
  },
  {
    // Half of a pair, and the marker asks for the pair explicitly: the labels
    // are the lesson, and one frame cannot show that they differ.
    id: "03-82-call-volume-count-only",
    doc: "03-scheduling.md",
    line: 423,
    anchor: "Reports → Call Volume for a count-only department",
    alt: "Call Volume for a count-only department: Unit Responses, Avg Responses/Day and Peak Responses, over the footnote saying an incident two units attended is counted once for each",
    route: "/reports",
    prepare: openCallVolumeReport("count_only"),
    fullPage: false,
  },
  {
    id: "03-83-call-volume-detailed",
    doc: "03-scheduling.md",
    line: 423,
    anchor: "__paired-with-03-82__",
    alt: "The same department and period in detailed mode: the identical cards read Total Calls, Avg Calls/Day and Peak Calls, and the per-unit footnote is gone",
    route: "/reports",
    prepare: openCallVolumeReport("detailed"),
    fullPage: false,
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

/**
 * A shot flagged `mutatesSeedData` leaves the database changed for everything
 * captured after it, so it has to be the last shot of its guide.
 *
 * Enforced here rather than trusted to a comment because the failure is silent
 * in the worst way: 15-09-bulk-action-result drifted to fourth among the 15-*
 * entries during an unrelated edit, advanced every applicant a stage on, and
 * the shots below it — which find their applicant by the stage they sit on —
 * either timed out or would have pictured the wrong person under a caption
 * about the right one. Import time is the right place to catch it; by capture
 * time the evidence is a 15-second locator timeout with no hint of the cause.
 */
for (const [index, shot] of SHOTS.entries()) {
  if (!shot.mutatesSeedData) continue;
  const laterInSameDoc = SHOTS.slice(index + 1).filter(
    (later) => later.doc === shot.doc,
  );
  if (laterInSameDoc.length > 0) {
    throw new Error(
      `${shot.id} mutates the seeded data, so it must be the last shot of ` +
        `${shot.doc}; these still follow it: ` +
        laterInSameDoc.map((later) => later.id).join(", "),
    );
  }
}

/**
 * Ids double as output filenames, so two entries with one id capture twice and
 * the later one silently overwrites the earlier. A merge produced exactly this
 * — 03-60-report-used-sheet appeared verbatim in two places — and identical
 * copies are the lucky case: the day they diverge, manifest order decides which
 * screen the guide shows, with nothing reporting it.
 */
{
  const seen = new Map();
  for (const shot of SHOTS) {
    const first = seen.get(shot.id);
    if (first) {
      throw new Error(
        `duplicate shot id ${shot.id}: one entry must be removed, or the ` +
          `newer shot renamed to a free number`,
      );
    }
    seen.set(shot.id, shot);
  }
}
