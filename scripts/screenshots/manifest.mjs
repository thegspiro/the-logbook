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
 *   auth     'anonymous' to shoot a signed-out page in a separate context
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
    const control = target.first();
    // Settings renders its section tabs below the fold on a 900px viewport, and
    // Playwright's actionability check times out on a control it cannot reach.
    await control.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
    await control.click({ timeout: 10_000 });
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

export const SHOTS = [
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
    route: "/training/skills-testing",
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
    route: "/training/skills-testing",
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
    id: "09-06-new-test",
    doc: "09-skills-testing.md",
    line: 179,
    anchor:
      "Screenshot of the New Test form showing a template dropdown (with 'Patient",
    alt: "New skills test form with template and candidate selection",
    route: "/training/skills-testing/test/new",
    fullPage: true,
  },

  // ── 10 Mobile & PWA ─────────────────────────────────────────────────
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
    id: "15-10-pipeline-settings",
    doc: "15-prospective-members.md",
    line: 371,
    anchor:
      "Screenshot of the Inactivity Configuration panel showing the timeout preset dropdown, warning",
    alt: "Prospective members settings showing the inactivity configuration panel",
    route: "/prospective-members/settings",
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
  {
    id: "02-30-shift-reports",
    doc: "02-training.md",
    line: 742,
    anchor:
      "Screenshot of the Pending Review view showing report cards with checkboxes, the",
    alt: "Shift reports pending review with selection controls",
    route: "/training/shift-reports",
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
      "Screenshot of the Member Audit History page showing a timeline of changes",
    alt: "Member audit history showing recorded changes over time",
    // The guide's example is "Rank changed from X to Y", but the timeline is
    // dominated by "Member profile viewed" — which the capture tooling itself
    // generates on every run, and which always outranks the seeded promotions
    // by recency. Filling the placeholder with this would illustrate the wrong
    // thing. Needs the page's event filter driven to a field-change type.
    holdBack:
      "timeline shows only 'profile viewed' events generated by the capture runs, not the field changes the guide describes",
    // Viewport only: the history is paginated at 50 entries and a full-page
    // capture runs past 5000px, which is unreadable in a guide. The newest
    // entries are at the top, which is what the section describes.
    route: "/members",
    prepare: openFirstFromApi(
      "/users?limit=1",
      (id) => `/members/admin/history/${id}`,
      "users",
    ),
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
      await page
        .locator("[class*='cursor-pointer']")
        .filter({ hasText: /Rivera|Fields|Okafor/ })
        .first()
        .click({ timeout: 10_000 });
    },
    fullPage: true,
  },
];
