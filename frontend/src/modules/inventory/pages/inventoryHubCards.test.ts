/**
 * The inventory hub's cards match the routes they target.
 *
 * The hub's own route gates on `inventory.manage`, and for a long time every
 * card inherited that gate implicitly — they were JSX literals with no gate of
 * their own. Two of them targeted routes requiring `inventory.check_manage`
 * and `inventory.check_view`, which the seeded Quartermaster does not hold, so
 * the hub's primary audience was shown two cards that both refused them.
 *
 * `checkPermission` is exact match plus module wildcard: `inventory.manage`
 * implies neither `inventory.view` nor `inventory.check_*`. So a card's gate
 * must be a SUBSET of its route's — narrower only hides the card, wider is a
 * link to Access Denied.
 *
 * Same parser as `navGateIntegrity.test.ts`, shared via `test/routeGates`.
 */

import { describe, it, expect } from 'vitest';
import { barePath, routeGate, routeSources } from '../../../test/routeGates';
import { INVENTORY_HUB_CARDS, INVENTORY_HUB_SECTIONS } from './inventoryHubCards';

const sources = routeSources();

const resolved = INVENTORY_HUB_CARDS.map((card) => ({
  card,
  bare: barePath(card.path),
  gate: routeGate(sources, barePath(card.path)),
  offered: card.anyPermission ?? (card.permission ? [card.permission] : []),
}));

const permissionGated = resolved.filter((entry) => entry.gate.permissions.length > 0);
const moduleGated = resolved.filter((entry) => entry.gate.module !== null);

describe('inventory hub cards', () => {
  // Every check below is "gate A is no wider than gate B", which passes
  // trivially if the resolver returns nothing. Pin the inputs first, so a
  // parser broken by a refactor fails here rather than quietly disarming
  // everything after it.
  it('has cards of each kind to check', () => {
    expect(INVENTORY_HUB_CARDS.length).toBeGreaterThan(20);
    expect(permissionGated.length).toBeGreaterThan(0);
    expect(moduleGated.length).toBeGreaterThan(0);
  });

  it('gives every card a unique id', () => {
    const ids = INVENTORY_HUB_CARDS.map((card) => card.id);
    expect(new Set(ids).size, 'two cards share an id, so one loses its React key').toBe(ids.length);
  });

  it('files every card under a declared section', () => {
    for (const card of INVENTORY_HUB_CARDS) {
      expect(INVENTORY_HUB_SECTIONS, `${card.id} is in an unrendered section`).toContain(card.section);
    }
  });

  it.each(resolved.map((entry) => [entry.card.id, entry] as const))('%s targets a route that exists', (_id, entry) => {
    expect(entry.gate.exists, `no <Route> defines ${entry.bare}`).toBe(true);
  });

  it.each(permissionGated.map((entry) => [entry.card.id, entry] as const))(
    '%s carries a permission gate no wider than its route',
    (_id, { card, bare, gate, offered }) => {
      expect(offered.length, `${card.id} offers a gated route with no gate of its own`).toBeGreaterThan(0);
      const notAccepted = offered.filter((permission) => !gate.permissions.includes(permission));
      expect(notAccepted, `${card.id} advertises grants ${bare} does not accept`).toEqual([]);
    }
  );

  it.each(moduleGated.map((entry) => [entry.card.id, entry] as const))(
    '%s repeats its route module gate',
    (_id, { card, bare, gate }) => {
      // Without this the card survives a department switching the module off
      // and lands on the "module is not enabled" refusal.
      expect(card.requiresModule, `${card.id} ignores the ${gate.module} module gate on ${bare}`).toBe(gate.module);
    }
  );

  // Named rather than left to the generic subset check: these are the two that
  // were actually wrong, and stating them by name is what stops a future edit
  // "simplifying" them back to `inventory.manage`.
  it('gates the checklist cards on the check grants, not on inventory.manage', () => {
    const byId = (id: string) => INVENTORY_HUB_CARDS.find((card) => card.id === id);

    expect(byId('checklists')?.permission).toBe('inventory.check_manage');
    expect(byId('check-reports')?.permission).toBe('inventory.check_view');
  });

  it('keeps the EMS card off the everyone-grant', () => {
    // /medical-supplies also accepts `inventory.view`, which both seeded
    // rank-and-file positions hold. navGateIntegrity keeps that grant out of
    // the nav row for the same reason; the hub card follows it.
    const medical = INVENTORY_HUB_CARDS.find((card) => card.id === 'supply-medical');

    expect(medical?.permission).toBe('inventory.view_medical');
    expect(medical?.anyPermission ?? []).not.toContain('inventory.view');
    expect(medical?.requiresModule).toBe('medical_supplies');
  });

  it('gates every store card on the store’s own grant and module', () => {
    const storeCards = INVENTORY_HUB_CARDS.filter((card) => card.section === 'Department Store');
    expect(storeCards.length).toBeGreaterThan(0);

    for (const card of storeCards) {
      expect(card.permission, `${card.id} does not require storefront.manage`).toBe('storefront.manage');
      expect(card.requiresModule, `${card.id} ignores the storefront module flag`).toBe('storefront');
    }
  });

  it('offers no card ungated', () => {
    // Every destination here is an administration screen. One reached with no
    // gate at all is the mistake navGateIntegrity was written for.
    for (const { card, offered } of resolved) {
      expect(offered.length, `${card.id} is offered with no permission gate`).toBeGreaterThan(0);
    }
  });
});
