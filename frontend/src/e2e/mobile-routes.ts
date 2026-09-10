/**
 * The route inventory the mobile passes share.
 *
 * Extracted from mobile-presentation.spec.ts so the presentation ratchet, the
 * accessibility pass and the coverage-integrity check all measure the same
 * list. Three copies of it would drift, and a route missing from one of them
 * is exactly the silent gap this whole area exists to prevent.
 */

export interface RouteCheck {
  path: string;
  /**
   * Interactive elements rendering under 44x44. Now 0 for every route — treat
   * a failure here as "this control needs a mobile size", not "raise the
   * number". Checkbox and radio inputs are measured by their wrapping <label>,
   * since a native checkbox is 16px by design and cannot be padded.
   */
  maxSmallTargets: number;
  /**
   * Text nodes rendering below 12px. Now 0 everywhere — a failure means new
   * copy needs a mobile size, not a raised number. The 12px floor is applied
   * centrally in index.css for text-[10px]/text-[11px]; genuinely dense
   * fixed-size labels (chart axes, the pattern-builder grid) use smaller
   * arbitrary values and are deliberately exempt there.
   */
  maxTinyText: number;
  /**
   * Permissions this route needs on top of the base grant, when it is gated
   * behind something the base set does not carry.
   *
   * Per-route rather than one wider grant for everyone, because widening the
   * base set changes what *other* routes render: a route that had been quietly
   * measuring the dashboard starts measuring its real body, and any debt that
   * body carries turns this pass red for reasons unrelated to the route being
   * added. Scoping the grant keeps each addition to its own page.
   *
   * The cost is a re-sign-in when the set changes, so keep routes needing the
   * same extras adjacent in the list below.
   */
  permissions?: string[];
}

/** Granted for every route; see the per-route `permissions` note above. */
export const BASE_PERMISSIONS = ['inventory.manage', 'facilities.manage'];

//: What every route under Scheduling Administration is gated on.
//:
//: `ProtectedRoute` asks for `scheduling.manage` and that alone is what decides
//: whether these pages render — the API is mocked here, so no server-side grant
//: is in play. `scheduling.view` rides along because permission matching is
//: literal (`manage` never implies `view`) and a real scheduling officer holds
//: both; a fixture that held only one would be modelling a role nobody has.
export const SCHEDULING_ADMIN = ['scheduling.manage', 'scheduling.view'];

export const ALL_ROUTES: RouteCheck[] = [
  { path: '/dashboard', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/events', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/members', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/members/admin', maxSmallTargets: 0, maxTinyText: 0, permissions: ['members.manage'] },
  // All five sections of this settings screen, each listed rather than left to
  // a representative, because each renders a different body under one shell.
  //
  // The first two were exempt until toggle-track grew to a 44px hit box: they
  // are toggle-only, so a single 44x24 switch was the whole of their debt and
  // the entry recording that said to list them the moment it was fixed.
  //
  // `members.manage` alone on ranks and tiers on purpose — it is what those
  // routes stand on *and* what their endpoints accept, so it is the grant a real
  // roster officer arrives with, and the one fixture that would catch route gate
  // and endpoint gate drifting apart again.
  {
    path: '/members/admin/settings/visibility',
    maxSmallTargets: 0,
    maxTinyText: 0,
    permissions: ['members.manage', 'settings.manage'],
  },
  {
    path: '/members/admin/settings/ids',
    maxSmallTargets: 0,
    maxTinyText: 0,
    permissions: ['members.manage', 'settings.edit'],
  },
  { path: '/members/admin/settings/ranks', maxSmallTargets: 0, maxTinyText: 0, permissions: ['members.manage'] },
  // The membership ladder. Its rows carry controls the rank ladder has no
  // equivalent of — a reorder pair, a rights disclosure and a remove button, all
  // of which the fixture's two rungs put on screen.
  { path: '/members/admin/settings/tiers', maxSmallTargets: 0, maxTinyText: 0, permissions: ['members.manage'] },
  // EVOC needs a grant from another module entirely: the levels are served by
  // the apparatus API, so without `apparatus.manage` the page filters the
  // section out and redirects, and the pass would measure Operational Ranks
  // under EVOC's name.
  {
    path: '/members/admin/settings/evoc',
    maxSmallTargets: 0,
    maxTinyText: 0,
    permissions: ['members.manage', 'apparatus.manage'],
  },
  { path: '/members/check-in-station', maxSmallTargets: 0, maxTinyText: 0, permissions: ['members.check_in'] },
  { path: '/documents', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/members/1/training', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/admin/audit-log', maxSmallTargets: 0, maxTinyText: 0, permissions: ['audit.view'] },
  {
    path: '/training/admin?page=dashboard&tab=compliance',
    maxSmallTargets: 0,
    maxTinyText: 0,
    permissions: ['training.manage'],
  },
  { path: '/events/1/monitoring', maxSmallTargets: 0, maxTinyText: 0, permissions: ['events.manage'] },
  { path: '/training/my-training', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/training/submit', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/training/courses', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/training/programs', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/scheduling', maxSmallTargets: 0, maxTinyText: 0 },
  // Every route under /scheduling/admin is gated on `scheduling.manage`, which
  // is not in BASE_PERMISSIONS — so without these the loop measured
  // ProtectedRoute's Access Denied screen on all four. That passes every budget
  // while testing nothing about the page, which is the worst state a ratchet can
  // be in: it reports coverage it does not have.
  { path: '/scheduling/admin', maxSmallTargets: 0, maxTinyText: 0, permissions: SCHEDULING_ADMIN },
  { path: '/scheduling/admin/planning', maxSmallTargets: 0, maxTinyText: 0, permissions: SCHEDULING_ADMIN },
  { path: '/scheduling/admin/closeout', maxSmallTargets: 0, maxTinyText: 0, permissions: SCHEDULING_ADMIN },
  { path: '/scheduling/admin/reports', maxSmallTargets: 0, maxTinyText: 0, permissions: SCHEDULING_ADMIN },
  { path: '/admin-hours', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/notifications?tab=inbox', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/inventory', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/inventory/my-equipment', maxSmallTargets: 0, maxTinyText: 0 },
  // inventory.check_manage is a distinct grant from inventory.manage, and
  // checkPermission compares literally — without it this hub renders Access
  // Denied, which passes both budgets while measuring an error page.
  {
    path: '/inventory/admin/checklists',
    maxSmallTargets: 0,
    maxTinyText: 0,
    permissions: ['inventory.check_manage'],
  },
  // Also needs settings.manage: its four values are written through the
  // organization-settings endpoint, so the checklist grant is not enough.
  {
    path: '/inventory/admin/checklists/settings',
    maxSmallTargets: 0,
    maxTinyText: 0,
    permissions: ['inventory.check_manage', 'settings.manage'],
  },
  // apparatus.view is not in BASE_PERMISSIONS, so this measured Access Denied
  // — a ninth route in the same state as the eight corrected above. What
  // surfaced it was the `page-has-heading-one` rule: the refusal screen's
  // heading is an h2, so a route stuck on it has no h1 at all.
  { path: '/apparatus', maxSmallTargets: 0, maxTinyText: 0, permissions: ['apparatus.view'] },
  { path: '/apparatus-basic', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/locations', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/locations/qr-codes', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/facilities', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/facilities/settings', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/governance/org-chart', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/elections', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/minutes', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/action-items', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/forms', maxSmallTargets: 0, maxTinyText: 0, permissions: ['forms.manage'] },
  { path: '/store', maxSmallTargets: 0, maxTinyText: 0, permissions: ['storefront.view'] },
  { path: '/prospective-members', maxSmallTargets: 0, maxTinyText: 0, permissions: ['prospective_members.manage'] },
  // /analytics and /profile were listed here from the day this file was written
  // and match no <Route>: both fell through the catch-all to the dashboard,
  // which is why the three of them reported an identical 24 targets and 1249
  // characters. The real analytics dashboard is /admin/analytics behind
  // analytics.view; the real account screen is /account, below.
  { path: '/admin/analytics', maxSmallTargets: 0, maxTinyText: 0, permissions: ['analytics.view'] },
  { path: '/messages', maxSmallTargets: 0, maxTinyText: 0 },
  // Without settings.manage this route redirects and the pass measures the
  // dashboard under the name "/settings" — a green line for a page that never
  // rendered. Granting it is what makes the entry mean anything.
  { path: '/settings', maxSmallTargets: 0, maxTinyText: 0, permissions: ['settings.manage'] },
  // The second of the seven SettingsLayout screens, and the only other one that
  // needs no grant. Two screens is what keeps the shared shell honest: a fix to
  // the section strip that only suits one screen's section list fails here.
  // All five /members/admin/settings sections above are the third, reaching the
  // same shell through five different bodies.
  //
  // Those five were the toggle-track story: they carried one 44x24 switch each
  // and nothing else, so growing the switch's hit box to 44px was the whole of
  // what stood between them and a budget of 0. That is done, and they are
  // listed.
  //
  // Three remain unlisted, for three different reasons, each measured rather
  // than assumed:
  //
  // /scheduling/admin/settings/* carries worse than tap targets. Its
  // eligibility and notifications sections hit the ErrorBoundary outright under
  // this suite's API mocks, because each reads an array straight off a response
  // the catch-all answers with `{}` — which is what a gateway or proxy error
  // page does in production too. That is a fix of its own.
  //
  // /communications/email-templates is two-thirds done: its four list filters
  // are 44px now and its breadcrumb no longer overflows 320px, both fixed here.
  // What is left is a heading-order jump — the shell's <h1>, then <h3> group
  // headers with an <h4> beneath them — which is a heading hierarchy to
  // re-level across the page and its list, not a control to resize.
  //
  // The events and department-setup panels are a different problem entirely:
  // they render inside a hub route rather than at a path of their own, so there
  // is no address for this pass to visit and no amount of debt paid down
  // changes that. Covering them means giving them routes or measuring them
  // another way.
  // Held off by toggle-track and on the pass now that it is 44px: both of its
  // sub-44px controls were switches, and both its unnamed selects are named.
  { path: '/elections/settings', maxSmallTargets: 0, maxTinyText: 0, permissions: ['elections.manage'] },
  { path: '/account', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/testing', maxSmallTargets: 0, maxTinyText: 0 },

  //: The nine modules that had no route here at all.
  //:
  //: Every one of their 56 routes sat in the inventory as `exempt` under the
  //: same generated sentence — "covered by its representative module route" —
  //: naming a representative route that did not exist, because none of these
  //: modules had one. So the manifest reported full coverage for a fifth of
  //: the application that had never been measured at a phone width.
  //:
  //: What that concealed, on first measurement: /medical-supplies died through
  //: the ErrorBoundary, and the other eight carried 39 controls under 44px and
  //: 7 elements running off the side of the screen between them.
  { path: '/finance', maxSmallTargets: 0, maxTinyText: 0, permissions: ['finance.view'] },
  { path: '/grants', maxSmallTargets: 0, maxTinyText: 0, permissions: ['fundraising.view'] },
  { path: '/reports', maxSmallTargets: 0, maxTinyText: 0, permissions: ['reports.view'] },
  { path: '/medical-screening', maxSmallTargets: 0, maxTinyText: 0, permissions: ['medical_screening.view'] },
  { path: '/medical-supplies', maxSmallTargets: 0, maxTinyText: 0, permissions: ['inventory.view_medical'] },
  { path: '/ip-security', maxSmallTargets: 0, maxTinyText: 0, permissions: ['security.manage'] },
  // Both are settings.manage-gated, so they cost no extra sign-in between them.
  { path: '/integrations', maxSmallTargets: 0, maxTinyText: 0, permissions: ['settings.manage'] },
  { path: '/admin/public-portal', maxSmallTargets: 0, maxTinyText: 0, permissions: ['settings.manage'] },
  //: The onboarding wizard is 22 routes and none was measured. It is also the
  //: one flow reached before any session exists — a chief standing in the
  //: apparatus bay with a phone, setting the department up — so it is the last
  //: place a 36px control or a stepper running off the screen should survive.
  //: Step 1 is the representative: the remaining steps render the same shell,
  //: the same progress strip and the same form utilities.
  //:
  //: "Render the same shell" is an assumption, and it was wrong once: the
  //: per-module configuration step (since removed) built its own root, so it
  //: had no `#main-content` and the skip link pointed at nothing. Reaching a
  //: step here is not the fix — one redirects to step 1 unless the onboarding
  //: store is seeded, so the pass would measure step 1 twice and report it as
  //: coverage. `skipLinkTarget.test.ts` checks the assumption directly instead,
  //: on every page that owns its shell.
  { path: '/onboarding/start', maxSmallTargets: 0, maxTinyText: 0 },
];

// Useful when diagnosing one newly exposed permission-gated body locally;
// omitted in CI and normal runs, where the complete list always executes. Both
// passes read this one, so a local filter narrows them together.
const routeFilter = process.env.MOBILE_ROUTE_FILTER;
export const ROUTES = routeFilter ? ALL_ROUTES.filter(({ path }) => path.includes(routeFilter)) : ALL_ROUTES;

/** iPhone 14/15 class — the narrow end of what members actually carry. */
export const PHONE = { width: 390, height: 844 };

/** Apple's HIG and WCAG 2.5.5 both land here; the codebase already uses it. */
export const MIN_TAP = 44;
export const MIN_FONT_PX = 12;

/**
 * WCAG 2.1 SC 1.4.10 Reflow names 320 CSS px as the width content must reflow
 * to without a second scroll direction — it is what 400% zoom on a 1280px
 * desktop comes to, and it is also a real device: an iPhone SE in portrait is
 * 375px, and 320px is the narrowest phone still in service. Measuring only at
 * PHONE (390px) leaves the criterion untested at the width it actually names.
 */
export const NARROW = { width: 320, height: 640 };
