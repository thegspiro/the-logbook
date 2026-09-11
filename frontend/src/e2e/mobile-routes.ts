/**
 * The route inventory the mobile passes share.
 *
 * Extracted from mobile-presentation.spec.ts so the presentation ratchet, the
 * accessibility pass and the coverage-integrity check all measure the same
 * list. Three copies of it would drift, and a route missing from one of them
 * is exactly the silent gap this whole area exists to prevent.
 */

import type { Page } from '@playwright/test';
import { signIn } from './helpers';
import type { MockOptions } from './helpers';

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
  /**
   * Fixture state this route needs before its real body will render.
   *
   * The sibling of `permissions`, and it exists for the same failure: a
   * permission the fixture lacks redirects to the dashboard, and a *setting*
   * the fixture lacks can silently substitute one page for another. Platoons is
   * the worked example — see `expectText` below.
   */
  fixture?: Omit<MockOptions, 'permissions'>;
  /**
   * Text that must be on the page for the visit to count as having reached it.
   *
   * A budget of 0 on a route that rendered something else is worse than no
   * entry at all: it reads as coverage. Two routes in this list have already
   * been that — /analytics and /profile matched no <Route>, fell through the
   * catch-all and reported the dashboard's numbers under their own names for as
   * long as the file existed.
   *
   * `phantom` in mobile-route-integrity.spec.ts catches only the version of
   * that where the path matches no route. It cannot catch a real route whose
   * page decides, at render time, to show a different section — which is
   * exactly what /scheduling/admin/settings/platoons does when the department
   * has platoons off: the section is filtered out of the list and
   * `visibleSection` falls back to General. Both this file's passes then
   * measured General twice and called one of them Platoons.
   */
  expectText?: string;
  /**
   * Controls that switch the route into another state, driven and measured
   * after the arrival render.
   *
   * The budgets above describe whatever a route puts on screen when you land on
   * it, and for most routes that is the whole page. For some it is a fraction:
   * /scheduling/admin/settings/shift-reports keeps seven subsections behind an
   * in-page tab strip held in `useState`, so six sevenths of it had never been
   * looked at, and the apparatus cards' edit forms are one click from a list
   * that measured clean. A budget of 0 over the visible seventh is not wrong,
   * but it is not what a reader takes it to mean either.
   *
   * `selector` must be scoped tightly enough to match only the intended
   * controls. `[data-mobile-scroll-region] button` is the cautionary example: it
   * also matches SettingsLayout's own section nav, so driving it navigates away
   * and the pass measures a different route under this one's name.
   *
   * Only the presentation pass drives these. The accessibility pass runs three
   * themes and an axe pass per route and already takes fifteen minutes; it
   * measures arrival only.
   */
  states?: {
    /** Scoped selector for the controls that switch state. */
    selector: string;
    /** Names the group in failure output: "/route [Rating Scale]". */
    label: string;
    /** Cap, so a data-driven strip cannot inflate the pass without warning. */
    max?: number;
    /**
     * Set only where a control in this group legitimately renders the screen the
     * route arrived on. A tab strip opens on its first subsection, so pressing
     * that tab reproduces arrival exactly and is not a failure.
     *
     * Everywhere else the first control *must* change the page — an Edit button
     * opens a form — so a state measuring the same as arrival means the click
     * did nothing and the coverage is being claimed without being taken. That is
     * the default, which is why this is opt-in rather than the other way round.
     */
    mayRepeatArrival?: boolean;
  }[];
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

/**
 * Sign in for a route, re-signing only when what it needs actually changed.
 *
 * Shared because all three passes need the identical decision and this file
 * exists so they cannot drift: a route that needs fixture state to render its
 * real body needs it in the accessibility and dialogs passes too, not only in
 * whichever one it was added for.
 *
 * Returns the state to pass to the next call.
 */
export interface SignInState {
  permissions: string[];
  fixture: string;
}

export const signInForRoute = async (
  page: Page,
  route: RouteCheck,
  state: SignInState | null
): Promise<SignInState> => {
  const permissions = route.permissions ? [...BASE_PERMISSIONS, ...route.permissions] : BASE_PERMISSIONS;
  const fixture = JSON.stringify(route.fixture ?? {});
  if (state && state.permissions.join() === permissions.join() && state.fixture === fixture) {
    return state;
  }
  await signIn(page, { ...route.fixture, permissions });
  return { permissions, fixture };
};

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
  // The six /scheduling/admin/settings sections below are the fourth, and they
  // are the screen this note used to describe as unlistable. Every number it
  // carried was a guess and the guess was low: "17 controls under 44px, mostly
  // toggle-track". Measuring it once the two ErrorBoundary crashes and the one
  // overflow were fixed — earlier categories mask the tap budget — gave 80,
  // spread 11, 16, 11, 17, 22 and 3, and none of them was a toggle. They were
  // bare checkboxes whose wrapping label was 20px tall, 21x16 "Edit" links,
  // 26-36px chips and a few 20px text buttons: a sweep of nine patterns rather
  // than one utility, which is what the entries below now stand on.
  //
  {
    path: '/scheduling/admin/settings/general',
    maxSmallTargets: 0,
    maxTinyText: 0,
    permissions: SCHEDULING_ADMIN,
    expectText: 'Overtime advisory',
  },
  {
    path: '/scheduling/admin/settings/apparatus',
    maxSmallTargets: 0,
    maxTinyText: 0,
    permissions: SCHEDULING_ADMIN,
    expectText: 'Apparatus Type Defaults',
    // Edit opens an inline form on the card, and the form is where this screen
    // keeps most of its controls; the card list measures clean without it.
    //
    // One group per card, rather than one `button:text-is("Edit")` group capped
    // at two. Both cards render the same form from opposite arms of
    // PositionListEditor, so one of each is the coverage worth having and the
    // other thirteen apparatus rows are repetition — but an unscoped selector
    // cannot express that. It also cannot survive being driven: opening a row
    // replaces its own Edit button, so the second click lands on whatever moved
    // into that index and the resource card is never reached at all.
    states: [
      {
        selector: '.card-secondary:has(h3:text-is("Apparatus Type Defaults")) button:text-is("Edit")',
        label: 'Edit apparatus type',
        max: 1,
      },
      {
        selector: '.card-secondary:has(h3:text-is("Event Resource Defaults")) button:text-is("Edit")',
        label: 'Edit resource type',
        max: 1,
      },
    ],
  },
  // The first version of this entry carried neither `fixture` nor `expectText`
  // and a comment saying general and platoons "render the same panel today".
  // They did, and not for the reason given: the fixture serves
  // `platoons_enabled: false`, so the page filtered Platoons out of its section
  // list and fell back to General. Both passes measured the General body twice
  // and reported one of them under this URL — tap 0, AA 0, and about the wrong
  // page. `PlatoonRosterPanel` could have carried any amount of debt.
  {
    path: '/scheduling/admin/settings/platoons',
    maxSmallTargets: 0,
    maxTinyText: 0,
    permissions: SCHEDULING_ADMIN,
    fixture: { platoonsEnabled: true },
    // The roster panel's own heading, not the section head's title: it proves
    // the body rendered, which is the thing that was not happening.
    expectText: 'Platoon Roster',
  },
  {
    path: '/scheduling/admin/settings/eligibility',
    maxSmallTargets: 0,
    maxTinyText: 0,
    permissions: SCHEDULING_ADMIN,
    expectText: 'Save Eligibility Settings',
  },
  {
    path: '/scheduling/admin/settings/notifications',
    maxSmallTargets: 0,
    maxTinyText: 0,
    permissions: SCHEDULING_ADMIN,
    expectText: 'Scheduling Notifications',
  },
  // Seven subsections behind an in-page tab strip, all seven now driven and
  // measured. Six of them had never been looked at, and the debt they held was
  // 143 controls under 44px: 99 in Feedback Defaults, 38 in Apparatus Skills, 6
  // in Form Sections, 9 in Rating Scale, 0 in Post-Shift Validation and Review
  // Workflow. Almost all of the 99 were the three or four 12x12 icon buttons a
  // tag chip carries; the rest were apparatus-type chips at 32px, checkbox rows
  // at 40px, an "Add level" link at 16px and four Saves at 34-36px.
  //
  // An earlier hand count put those at 38/6/6/9/9 and it was wrong for the same
  // reason the strip needed a mechanism: clicks aimed at a coordinate on a
  // smooth-scrolling strip land on the neighbouring tab, so the count was taken
  // against the wrong screens. `unchangedStates` in the presentation pass exists
  // because of that, and fails a driven state that renders content already
  // measured.
  {
    path: '/scheduling/admin/settings/shift-reports',
    maxSmallTargets: 0,
    maxTinyText: 0,
    permissions: SCHEDULING_ADMIN,
    expectText: 'Control whether shift reports are available for your department and which features are included.',
    // The strip, scoped by its own label. The panel's <nav> and SettingsLayout's
    // are both `data-mobile-scroll-region`, and the outer one navigates.
    states: [
      {
        selector: '[aria-label="Shift report settings sections"] button',
        label: 'subsection',
        // The panel opens on "What's turned on", so the first tab in this strip
        // renders exactly what arrival rendered. Measured, not assumed: both
        // come out at tap 0/22 and 1291 characters.
        mayRepeatArrival: true,
      },
    ],
  },
  // Two remain unlisted, each measured rather than assumed:
  //
  // /communications/email-templates is two-thirds done: its four list filters
  // are 44px now and its breadcrumb no longer overflows 320px, both fixed here.
  // What is left is a heading-order jump — the shell's <h1>, then <h3> group
  // headers with an <h4> beneath them — which is a heading hierarchy to
  // re-level across the page and its list, not a control to resize. The six
  // sections above had the near side of the same defect (h1 straight to a card's
  // <h3>) and it was fixed the way every other settings screen does it, with a
  // SettingsPanelHead <h2> opening the panel; email-templates needs more than
  // that, because its <h4>s have to move too.
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
