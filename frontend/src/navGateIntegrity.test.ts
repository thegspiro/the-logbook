/**
 * Navigation gate integrity
 *
 * A navigation surface that offers a page the viewer's permissions will not
 * open is worse than one that hides it: the member gets Access Denied with no
 * explanation, from a control the app itself put in front of them. Nothing in
 * the type system connects a nav entry's gate to the gate on the route it
 * targets, so the two drift silently.
 *
 * Three of these shipped together in one change and were caught in review — a
 * nav row advertising `manage` grants the route did not accept, a command
 * palette entry with no gate at all, and a bare `i` keyboard shortcut. They
 * were one mistake made three times, on three surfaces nobody thinks of as
 * "navigation" at once. Hence a test rather than a fourth careful review.
 *
 * Quick Add (`components/layout/quickAddActions.ts`) is the fourth such
 * surface. It gets the strongest form of the check below, because unlike the
 * others its entries are a typed export rather than literals inside a
 * component: every row is resolved against the real route definition rather
 * than against a hand-listed expectation.
 *
 * Two invariants:
 *
 *  1. A nav gate must be a SUBSET of its route's gate. `checkPermission` does
 *     exact match plus module wildcard only — `inventory.manage` does not
 *     imply `inventory.view` — so a superset gate is a promise the route
 *     refuses to keep.
 *  2. Every surface offering the manager-only gear catalogue must gate on
 *     `inventory.manage`.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEDICAL_VIEW_PERMISSIONS } from './modules/medical-supplies/routes';
import { FACILITY_ENTRY_PERMISSIONS } from './modules/facilities/routes';
import { QUICK_ADD_ACTIONS } from './components/layout/quickAddActions';
import { barePath, routeGate, routeSources } from './test/routeGates';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** Nav entries are object literals; pull the gate that sits with a given path. */
const gatesForPath = (source: string, navPath: string): string[][] => {
  const found: string[][] = [];
  const pathRe = new RegExp(`path: '${navPath.replace(/\//g, '\\/')}',`, 'g');
  for (const match of source.matchAll(pathRe)) {
    // The gate may sit on either side of the path within the same literal.
    const window = source.slice(Math.max(0, match.index - 300), match.index + 300);
    const any = window.match(/anyPermission: \[([^\]]*)\]/);
    const single = window.match(/permission: '([^']+)'/);
    if (any?.[1]) {
      found.push([...any[1].matchAll(/'([^']+)'/g)].map((m) => m[1] as string));
    } else if (single?.[1]) {
      found.push([single[1]]);
    } else {
      found.push([]);
    }
  }
  return found;
};

const NAV_SURFACES = ['components/layout/SideNavigation.tsx', 'components/layout/TopNavigation.tsx'] as const;

/**
 * Slice exactly one nav entry, by its label.
 *
 * `gatesForPath` reads a fixed window either side of the path, which bleeds
 * into the neighbouring literal — the Store Admin row sits directly after Gear
 * Admin, so its window picks up `inventory.manage`. Anchoring on the label and
 * stopping at the first closing brace keeps the assertion about one row.
 */
const navEntry = (source: string, label: string): string => {
  const start = source.indexOf(`label: '${label}',`);
  expect(start, `no '${label}' entry`).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('}', start));
};

/** Pull the `permission`/`requiresModule`/`module` keys off one palette command. */
const paletteCommand = (source: string, id: string): string => {
  const start = source.indexOf(`id: '${id}',`);
  expect(start, `CommandPalette has no '${id}' command`).toBeGreaterThan(-1);
  // Commands are object literals in one array; stop at the first closing brace
  // that ends this literal rather than a nested one.
  return source.slice(start, source.indexOf('\n  },', start));
};

describe('navigation gates match the routes they target', () => {
  it('shares the Facilities route gate with every discovery surface', () => {
    const constantName = 'FACILITY_ENTRY_PERMISSIONS';
    for (const surface of [...NAV_SURFACES, 'components/ux/CommandPalette.tsx']) {
      const source = read(surface);
      const entry = surface.includes('CommandPalette')
        ? paletteCommand(source, 'facilities')
        : navEntry(source, 'Facilities');
      expect(entry, `${surface}: Facilities does not use the shared route gate`).toContain(constantName);
      expect(source, `${surface}: Facilities gate is not imported`).toContain(
        "import { FACILITY_ENTRY_PERMISSIONS } from '../../modules/facilities/routes'"
      );
    }

    expect(FACILITY_ENTRY_PERMISSIONS).toEqual(['facilities.view', 'facilities.manage']);
  });

  it('offers /medical-supplies only on permissions its route accepts', () => {
    for (const surface of NAV_SURFACES) {
      const gates = gatesForPath(read(surface), '/medical-supplies');
      expect(gates.length, `${surface} should carry one /medical-supplies entry`).toBe(1);
      const gate = gates[0] ?? [];
      expect(gate.length, `${surface}: /medical-supplies entry has no gate`).toBeGreaterThan(0);

      // Subset, not overlap: any grant that opens the nav row must also open
      // the route, or that row is a link to Access Denied for whoever holds
      // only the grant the route omits.
      const notAccepted = gate.filter((p) => !MEDICAL_VIEW_PERMISSIONS.includes(p));
      expect(notAccepted, `${surface}: gate exceeds MEDICAL_VIEW_PERMISSIONS`).toEqual([]);
    }
  });

  it('does not advertise the stock room on the everyone-grant', () => {
    // `inventory.view` is held by the seeded member and firefighter roles, so
    // including it would put the supply room back in every member's nav.
    for (const surface of NAV_SURFACES) {
      const gate = gatesForPath(read(surface), '/medical-supplies')[0] ?? [];
      expect(gate, `${surface}: /medical-supplies is gated on the everyone-grant`).not.toContain('inventory.view');
    }
  });

  it('offers the store only where the route would open it', () => {
    // /store and /store/orders both carry requiredPermission="storefront.view"
    // AND requiredModule="storefront" (modules/storefront/routes.tsx).
    for (const surface of NAV_SURFACES) {
      const gates = gatesForPath(read(surface), '/store');
      expect(gates.length, `${surface} should carry a /store entry`).toBeGreaterThan(0);
      expect(
        gates.some((g) => g.includes('storefront.view')),
        `${surface}: no /store entry gated on storefront.view`
      ).toBe(true);
    }

    // Bottom bar — a tab landing on Access Denied is worse than no tab, since
    // the slot fallback would otherwise hand the space to a usable page.
    const bottom = read('components/layout/BottomNavigation.tsx');
    const storeTab = bottom.slice(bottom.indexOf("path: '/store',"));
    expect(storeTab.slice(0, storeTab.indexOf('},')), 'BottomNavigation /store tab is ungated').toContain(
      "permission: 'storefront.view'"
    );

    // Command palette — both entries, permission and module. 'my-store-orders'
    // shipped with neither even though its route carries both.
    const palette = read('components/ux/CommandPalette.tsx');
    for (const id of ['store', 'my-store-orders']) {
      const block = paletteCommand(palette, id);
      expect(block, `CommandPalette '${id}' offers the store with no permission`).toContain(
        "permission: 'storefront.view'"
      );
      expect(block, `CommandPalette '${id}' ignores the storefront module gate`).toContain(
        "requiresModule: 'storefront'"
      );
    }
  });

  it('keeps the store admin console on storefront.manage', () => {
    // The console requires storefront.manage. `checkPermission` does exact
    // match plus module wildcard, so storefront.view does NOT imply it — a
    // view-gated row here would be a link to Access Denied for every member.
    //
    // It moved to /inventory/admin/store when the store came inside Inventory
    // Administration; /store/admin still redirects there, but a nav row should
    // point at the page rather than at a hop.
    for (const surface of NAV_SURFACES) {
      const entry = navEntry(read(surface), 'Store Admin');
      expect(entry, `${surface}: Store Admin targets the wrong path`).toContain("path: '/inventory/admin/store'");
      expect(entry, `${surface}: Store Admin is not gated on storefront.manage`).toContain(
        "permission: 'storefront.manage'"
      );
      expect(entry, `${surface}: Store Admin is offered on the browse grant`).not.toContain('storefront.view');
    }

    // The bottom bar is member-facing and must not offer the console at all.
    expect(
      read('components/layout/BottomNavigation.tsx'),
      'BottomNavigation offers the store admin console'
    ).not.toContain("path: '/store/admin'");
  });

  it('gates every surface that offers the gear catalogue on inventory.manage', () => {
    // Nav rows.
    for (const surface of NAV_SURFACES) {
      const gates = gatesForPath(read(surface), '/inventory');
      expect(gates.length, `${surface} should carry a /inventory entry`).toBeGreaterThan(0);
      // TopNavigation's Operations *group* also carries path: '/inventory', for
      // active-state matching only — a group with subItems renders a dropdown
      // button, never a link — so not every occurrence is a navigable row.
      // What must hold is that the row itself is manage-gated.
      expect(
        gates.some((g) => g.includes('inventory.manage')),
        `${surface}: no /inventory entry gated on inventory.manage`
      ).toBe(true);
    }

    // Command palette.
    const palette = read('components/ux/CommandPalette.tsx');
    const inventoryCommand = palette.slice(palette.indexOf("id: 'inventory',"));
    const block = inventoryCommand.slice(0, inventoryCommand.indexOf('},'));
    expect(block, 'CommandPalette offers the catalogue with no permission').toContain("permission: 'inventory.manage'");

    // Keyboard shortcut — a bare keypress, with no label to gate.
    const shortcuts = read('hooks/useKeyboardShortcuts.ts');
    expect(shortcuts, "the 'i' shortcut navigates to the catalogue unconditionally").not.toMatch(
      /key: 'i', handler: \(\) => void navigate\('\/inventory'\)/
    );
    expect(shortcuts, "the 'i' shortcut should resolve by permission").toContain(
      "checkPermission)('inventory.manage')"
    );
  });
});

// `routeSources` / `routeGate` moved to `test/routeGates.ts` when the
// inventory hub's card registry started checking itself the same way. One
// parser, so a route-declaration shape it cannot read fails everywhere at once
// rather than quietly disarming whichever surface still had its own copy.

describe('Quick Add offers only what its routes will open', () => {
  const sources = routeSources();

  // The checks below are all "gate A is no wider than gate B", which passes
  // trivially if the resolver silently returns nothing. Pin its output against
  // routes of each shape first, so a parser broken by a refactor fails here
  // rather than quietly disarming everything after it.
  it('resolves each shape of route gate', () => {
    expect(routeGate(sources, '/events/admin')).toEqual({
      permissions: ['events.manage'],
      module: null,
      exists: true,
    });
    expect(routeGate(sources, '/members/scan')).toEqual({
      permissions: ['users.view', 'members.manage'],
      module: null,
      exists: true,
    });
    expect(routeGate(sources, '/training/submit')).toEqual({ permissions: [], module: 'training', exists: true });
    expect(routeGate(sources, '/inventory/admin/requests')).toEqual({
      permissions: ['inventory.manage'],
      module: 'inventory',
      exists: true,
    });
    expect(routeGate(sources, '/action-items')).toEqual({ permissions: [], module: null, exists: true });
    expect(routeGate(sources, '/no/such/route')).toEqual({ permissions: [], module: null, exists: false });
  });

  it.each(QUICK_ADD_ACTIONS.map((action) => [action.id, action] as const))(
    '%s targets a route that exists',
    (_id, action) => {
      // Query strings are the row's business, not the router's.
      const bare = barePath(action.path);
      expect(routeGate(sources, bare).exists, `no <Route> defines ${bare}`).toBe(true);
    }
  );

  /**
   * Resolved once, and split into the cases each check applies to. Selecting
   * outside the test body rather than returning early inside it keeps every
   * generated case an assertion — a skipped-by-`return` case reads as a pass.
   */
  const resolved = QUICK_ADD_ACTIONS.map((action) => {
    const bare = barePath(action.path);
    return {
      action,
      bare,
      gate: routeGate(sources, bare),
      offered: action.anyPermission ?? (action.permission ? [action.permission] : []),
    };
  });
  const permissionGated = resolved.filter((entry) => entry.gate.permissions.length > 0);
  const moduleGated = resolved.filter((entry) => entry.gate.module !== null);
  const adminConsoles = resolved.filter(
    (entry) => entry.bare.startsWith('/inventory/admin') || entry.bare.startsWith('/store/admin')
  );

  // Nothing below runs if these lists come back empty, and an `it.each` over
  // an empty list is silence rather than a failure.
  it('has cases of each kind to check', () => {
    expect(permissionGated.length).toBeGreaterThan(0);
    expect(moduleGated.length).toBeGreaterThan(0);
    expect(adminConsoles.length).toBeGreaterThan(0);
  });

  // An action on an ungated route is exempt: offering it ungated is right, and
  // offering it more narrowly only hides a row, never produces a refusal.
  it.each(permissionGated.map((entry) => [entry.action.id, entry] as const))(
    '%s carries a permission gate no wider than its route',
    (_id, { action, bare, gate, offered }) => {
      // Subset, not overlap: a grant that opens the row must also open the
      // route, or the row is a link to Access Denied for whoever holds only
      // the grant the route omits.
      expect(offered.length, `${action.id} offers a gated route with no gate of its own`).toBeGreaterThan(0);
      const notAccepted = offered.filter((permission) => !gate.permissions.includes(permission));
      expect(notAccepted, `${action.id} advertises grants ${bare} does not accept`).toEqual([]);
    }
  );

  it.each(moduleGated.map((entry) => [entry.action.id, entry] as const))(
    '%s repeats its route module gate',
    (_id, { action, bare, gate }) => {
      // Without this the row survives a department switching the module off
      // and lands on the "module is not enabled" refusal.
      expect(action.requiresModule, `${action.id} ignores the ${gate.module} module gate on ${bare}`).toBe(gate.module);
    }
  );

  // Same reasoning as the bottom bar's Store tab: the bar is member-facing,
  // and a manage-only console reached from it is a refusal for most people.
  it.each(adminConsoles.map((entry) => [entry.action.id, entry] as const))(
    '%s does not offer an admin console ungated',
    (_id, { action, offered }) => {
      expect(offered.length, `${action.id} offers an admin console ungated`).toBeGreaterThan(0);
    }
  );
});
