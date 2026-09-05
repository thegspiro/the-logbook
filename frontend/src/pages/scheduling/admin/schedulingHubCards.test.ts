/**
 * The scheduling hub's cards match the routes they target.
 *
 * `checkPermission` is exact match plus module wildcard: `scheduling.manage`
 * implies neither `inventory.check_manage` nor `settings.manage`. So a card's
 * gate must be a SUBSET of its route's — narrower only hides the card, wider is
 * a link to Access Denied reached from a control the app itself offered.
 *
 * The risk is concrete here rather than theoretical: two of these cards point
 * into Inventory, and the seeded Scheduling Officer holds `inventory.check_*`
 * but not `settings.manage`, so the checklist-timing card is one they see and
 * the timing page refuses unless it carries Inventory's own gate.
 *
 * Same parser as `navGateIntegrity.test.ts`, shared via `test/routeGates`.
 */

import { describe, it, expect } from 'vitest';
import { barePath, routeGate, routeSources } from '../../../test/routeGates';
import { SCHEDULING_HUB_CARDS, SCHEDULING_HUB_SECTIONS } from './schedulingHubCards';

const sources = routeSources();

const resolved = SCHEDULING_HUB_CARDS.map((card) => ({
  card,
  bare: barePath(card.path),
  gate: routeGate(sources, barePath(card.path)),
  offered: card.anyPermission ?? (card.permission ? [card.permission] : []),
}));

const permissionGated = resolved.filter((entry) => entry.gate.permissions.length > 0);
const moduleGated = resolved.filter((entry) => entry.gate.module !== null);

describe('scheduling hub cards', () => {
  // Every check below is "gate A is no wider than gate B", which passes
  // trivially if the resolver returns nothing. Pin the inputs first, so a
  // parser broken by a refactor fails here rather than quietly disarming
  // everything after it.
  it('has cards of each kind to check', () => {
    expect(SCHEDULING_HUB_CARDS.length).toBeGreaterThan(8);
    expect(permissionGated.length).toBeGreaterThan(0);
    expect(moduleGated.length).toBeGreaterThan(0);
  });

  it('gives every card a unique id', () => {
    const ids = SCHEDULING_HUB_CARDS.map((card) => card.id);
    expect(new Set(ids).size, 'two cards share an id, so one loses its React key').toBe(ids.length);
  });

  it('files every card under a declared section', () => {
    for (const card of SCHEDULING_HUB_CARDS) {
      expect(SCHEDULING_HUB_SECTIONS, `${card.id} is in an unrendered section`).toContain(card.section);
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
  // cross a module boundary, and stating them by name is what stops a future
  // edit "simplifying" them to scheduling.manage because everything else here
  // carries it.
  it('gates the Inventory cards on Inventory’s own grants', () => {
    const byId = (id: string) => SCHEDULING_HUB_CARDS.find((card) => card.id === id);

    expect(byId('equipment-checklists')?.permission).toBe('inventory.check_manage');
    expect(byId('checklist-settings')?.anyPermission).toEqual(['settings.manage', 'organization.update_settings']);
    for (const id of ['equipment-checklists', 'checklist-settings']) {
      expect(byId(id)?.requiresModule, `${id} ignores the inventory module flag`).toBe('inventory');
      expect(byId(id)?.anyPermission ?? [byId(id)?.permission]).not.toContain('scheduling.manage');
    }
  });

  // Everything but the two Inventory cards runs on the one grant, the position
  // roster included. It briefly accepted the training grants, which made every
  // gate above it widen to match and opened the Administration section for a
  // viewer with one card in it.
  it('gates every scheduling card on scheduling.manage', () => {
    const ownCards = SCHEDULING_HUB_CARDS.filter((card) => card.requiresModule === 'scheduling');
    expect(ownCards.length).toBeGreaterThan(5);

    for (const card of ownCards) {
      expect(card.permission, `${card.id} does not require scheduling.manage`).toBe('scheduling.manage');
      expect(card.anyPermission, `${card.id} still carries a wider gate`).toBeUndefined();
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
