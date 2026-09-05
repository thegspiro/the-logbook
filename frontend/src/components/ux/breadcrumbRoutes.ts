/**
 * The paths a breadcrumb trail is allowed to link to, and the gate each one
 * enforces.
 *
 * An auto-generated trail is built by accumulating URL segments, and two things
 * go wrong if it links every prefix it produces:
 *
 * 1. **The prefix is not a route.** `/inventory/admin/checklists/templates/new`
 *    yields `/inventory/admin/checklists/templates`, which no `<Route>`
 *    declares — only `/new` and `/:templateId` beneath it. App.tsx's catch-all
 *    swallows the miss and drops the user on the dashboard, which is
 *    indistinguishable from a crumb that simply does not work. This is the same
 *    failure `routeIntegrity.test.ts` exists to catch, except a computed path
 *    has no `to="…"` literal for that scan to read.
 *
 * 2. **The prefix is a route the viewer cannot open.** Ancestry is not
 *    permission inheritance, and here it frequently inverts:
 *    `/inventory/admin/checklists` admits `inventory.check_manage`, while its
 *    parent `/inventory` demands `inventory.manage` — which `checkPermission`
 *    does not imply from it. A checklist manager offered an "Inventory" crumb
 *    gets Access Denied from a control the app itself put in front of them,
 *    the mistake `schedulingHubCards.ts` is written to avoid on the hub cards.
 *
 * So linking is opt-in: a crumb is a link only if its path appears here AND the
 * viewer holds one of the permissions listed. Anything else renders as plain
 * text, which is the safe direction — a trail that shows where you are without
 * offering a door that will not open.
 *
 * `permissions` MIRRORS the route's own gate; it is not a policy of its own.
 * Empty means the route is ungated. `breadcrumbRoutes.test.ts` resolves each
 * route's real gate out of the route source and fails on any drift, and derives
 * the ancestor set from the same source so an entry cannot go missing either.
 *
 * The module gate has no counterpart here, and that holds for every route but
 * one. An entry is a prefix of the URL the viewer is on, so it almost always
 * belongs to the module they are already inside — the route they arrived
 * through has proved that module is enabled, and re-checking would cost
 * `useEnabledModules` a request on every page that draws a trail.
 *
 * `/inventory/admin/store` is the exception: it is the Department Store hub,
 * gated on the `storefront` module, sitting in Inventory's URL space because
 * that is where an officer looks for it. A department can run the store with
 * Inventory switched off, and then both of its ancestors are refused. That page
 * passes `AdminHubFrame` an empty trail rather than a broken one — see the
 * comment there. It is the only route in the app whose module differs from its
 * URL prefix; a second one would have to make the same choice, or this file
 * would have to learn about modules.
 */

export interface BreadcrumbRoute {
  /** Overrides the segment-derived label. Only where the segment lies. */
  label?: string;
  /**
   * Any ONE of these opens the route (the router's `requiredAnyPermission`
   * semantics). Absent or empty means ungated.
   */
  permissions?: string[];
}

/**
 * Keyed by full path, because the label a segment deserves depends on where it
 * sits: `admin` is "Scheduling Administration" under `/scheduling` and
 * "Inventory Administration" under `/inventory`, and the bare word "Admin" —
 * which is what a segment-keyed table can say — names neither page.
 */
export const BREADCRUMB_ROUTES: Record<string, BreadcrumbRoute> = {
  // ── Administration hubs ────────────────────────────────────────────────
  // Labels match each hub's own `title` prop; the test asserts that against
  // the hub sources, so a renamed hub cannot leave a stale crumb behind.
  '/scheduling/admin': { label: 'Scheduling Administration', permissions: ['scheduling.manage'] },
  '/inventory/admin': {
    label: 'Inventory Administration',
    permissions: ['inventory.manage', 'inventory.check_manage', 'storefront.manage'],
  },
  '/members/admin': { label: 'Members Administration', permissions: ['members.manage'] },
  '/training/admin': { label: 'Training Administration', permissions: ['training.manage'] },
  '/events/admin': { label: 'Events Administration', permissions: ['events.manage'] },

  // ── Module landing pages ───────────────────────────────────────────────
  '/admin-hours': {},
  '/apparatus': {},
  '/elections': {},
  '/events': {},
  '/facilities': {},
  '/finance': { permissions: ['finance.view'] },
  '/grants': { permissions: ['fundraising.view'] },
  '/inventory': { permissions: ['inventory.manage'] },
  '/ip-security': { permissions: ['security.manage', 'settings.manage'] },
  '/learning': {},
  '/locations': {},
  '/medical-supplies': {},
  '/members': {},
  '/messages': {},
  '/minutes': {},
  '/onboarding': {},
  '/prospective-members': { permissions: ['prospective_members.manage'] },
  '/scheduling': {},
  '/settings': { permissions: ['settings.manage'] },
  '/store': { permissions: ['storefront.view'] },
  '/testing': {},
  '/training': {},

  // ── Sections within a module ───────────────────────────────────────────
  '/finance/budgets': { permissions: ['finance.view'] },
  '/finance/check-requests': { permissions: ['finance.view'] },
  '/finance/expenses': { permissions: ['finance.view'] },
  '/finance/purchase-requests': { permissions: ['finance.view'] },
  '/finance/settings': { permissions: ['finance.manage'] },
  '/grants/applications': { permissions: ['fundraising.view'] },
  '/inventory/admin/checklists': { permissions: ['inventory.check_manage'] },
  '/inventory/checklists': { permissions: ['inventory.check_view', 'scheduling.manage'] },
  '/inventory/items': { permissions: ['inventory.manage'] },
  '/onboarding/modules': {},
  '/scheduling/admin/settings': { permissions: ['scheduling.manage'] },
  '/scheduling/checkin': { label: 'Shift Check-In' },
  '/training/cohorts': { permissions: ['training.manage'] },
  '/training/programs': {},
  '/training/skills-testing': {},
};

/**
 * Is this path a crumb the viewer can follow?
 *
 * Fails closed on both counts: an unlisted path is not a link, and a listed one
 * is a link only for a viewer holding a permission the route accepts.
 */
export const canLinkCrumb = (path: string, checkPermission: (permission: string) => boolean): boolean => {
  const route = BREADCRUMB_ROUTES[path];
  if (!route) return false;
  const permissions = route.permissions ?? [];
  return permissions.length === 0 || permissions.some(checkPermission);
};
