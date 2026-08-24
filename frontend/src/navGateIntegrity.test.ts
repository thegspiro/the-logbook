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

describe('navigation gates match the routes they target', () => {
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
