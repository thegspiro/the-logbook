/**
 * The breadcrumb registry matches the router.
 *
 * `BREADCRUMB_ROUTES` mirrors two things it does not own — which paths are
 * routes, and what each one demands — so it is exactly the kind of hand-kept
 * table that drifts silently. The drift is invisible in review and in the UI:
 * an entry that outlives its route becomes a crumb that drops the user on the
 * dashboard, and a gate copied too wide becomes a crumb that leads to Access
 * Denied. Neither raises anything.
 *
 * So nothing here is asserted from the registry's own contents. The route set
 * and every gate come out of the route source, the ancestor set is DERIVED from
 * that source rather than listed, and the hub labels are read off the hubs
 * themselves. The registry only ever has to agree.
 *
 * Same parser as `navGateIntegrity.test.ts` and `schedulingHubCards.test.ts`,
 * shared via `test/routeGates`.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeGate, routeSources } from '../../test/routeGates';
import { BREADCRUMB_ROUTES } from './breadcrumbRoutes';
import { SCHEDULING_HUB_CARDS } from '../../pages/scheduling/admin/schedulingHubCards';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = routeSources();

const declaredRoutes = [
  ...new Set(
    [...sources.matchAll(/<Route\s[^>]*?path=(?:"([^"]+)"|'([^']+)')/gs)].map((match) => match[1] ?? match[2] ?? '')
  ),
].filter(Boolean);

/** A route with no `:param` or `*`, so an accumulated URL prefix can equal it. */
const staticRoutes = declaredRoutes.filter((route) => !route.includes(':') && !route.includes('*'));

/**
 * The paths a generated trail can actually produce as an ancestor: a static
 * route that some other route nests beneath. Derived, so a new route under an
 * existing one shows up here and fails the coverage test rather than quietly
 * costing that page a link.
 */
const ancestorRoutes = staticRoutes
  .filter((candidate) => declaredRoutes.some((route) => route !== candidate && route.startsWith(candidate + '/')))
  .sort();

const registered = Object.keys(BREADCRUMB_ROUTES).sort();

/** Each hub's own `title` prop — the name its crumb has to repeat. */
const HUB_TITLE_SOURCES: Record<string, string> = {
  '/scheduling/admin': 'pages/scheduling/admin/SchedulingAdminHub.tsx',
  '/inventory/admin': 'modules/inventory/pages/InventoryAdminHub.tsx',
  '/members/admin': 'pages/MembersAdminHub.tsx',
  '/training/admin': 'pages/TrainingAdminPage.tsx',
  '/events/admin': 'pages/EventsAdminHub.tsx',
};

const hubTitle = (file: string): string | null => {
  const source = fs.readFileSync(path.join(SRC, file), 'utf8');
  const frame = source.indexOf('<AdminHubFrame');
  if (frame === -1) return null;
  // The frame's opening tag spans many lines and carries `{…}` expressions, so
  // the tag cannot be delimited by its closing `>`. The first `title=` after
  // the tag opens is the frame's; a modal's title further down is not reached.
  return source.slice(frame).match(/\btitle="([^"]+)"/)?.[1] ?? null;
};

describe('breadcrumb route registry', () => {
  it('finds the routes it is meant to check', () => {
    // Every assertion below is "the registry agrees with this set", which passes
    // vacuously if the parser returns nothing.
    expect(declaredRoutes.length).toBeGreaterThan(100);
    expect(ancestorRoutes.length).toBeGreaterThan(20);
    expect(registered.length).toBeGreaterThan(20);
  });

  it.each(registered)('%s is a route the router declares', (crumbPath) => {
    expect(
      routeGate(sources, crumbPath).exists,
      `no <Route> defines ${crumbPath}, so linking a crumb to it lands on the dashboard`
    ).toBe(true);
  });

  it.each(registered)('%s repeats its route gate exactly', (crumbPath) => {
    const gate = routeGate(sources, crumbPath).permissions;
    const registeredGate = BREADCRUMB_ROUTES[crumbPath]?.permissions ?? [];

    // Equality, not subset. Too wide offers a door that will not open; too
    // narrow silently drops a link the viewer was entitled to follow, and only
    // the first of those is caught by a subset check.
    expect([...registeredGate].sort(), `${crumbPath} does not mirror its route's gate`).toEqual([...gate].sort());
  });

  it('registers every path a trail can reach as an ancestor', () => {
    const missing = ancestorRoutes.filter((route) => !(route in BREADCRUMB_ROUTES));

    expect(
      missing,
      'these routes nest other routes beneath them, so they appear mid-trail and would render as plain text'
    ).toEqual([]);
  });

  it.each(Object.entries(HUB_TITLE_SOURCES))('%s is labelled with the hub’s own title', (crumbPath, file) => {
    // A crumb naming a page something the page does not call itself is the
    // "Admin" this registry replaced, one rename later.
    expect(hubTitle(file), `could not read the AdminHubFrame title out of ${file}`).toBe(
      BREADCRUMB_ROUTES[crumbPath]?.label
    );
  });

  it('finds only the one route whose module differs from its URL prefix', () => {
    // A generated crumb carries no module check, on the reasoning that every
    // ancestor belongs to the module the viewer is already inside. That holds
    // only while a route's module matches its first URL segment. The Department
    // Store breaks it deliberately — storefront module, Inventory URL space —
    // and handles it by passing AdminHubFrame an empty trail. A second such
    // route would silently offer crumbs its module gate refuses, so it has to
    // fail here and make that choice consciously.
    const impliedModule: Record<string, string> = {
      inventory: 'inventory',
      scheduling: 'scheduling',
      training: 'training',
      facilities: 'facilities',
      apparatus: 'apparatus',
      elections: 'elections',
      minutes: 'minutes',
      grants: 'grants',
      finance: 'finance',
      store: 'storefront',
      'medical-supplies': 'medical_supplies',
      'prospective-members': 'prospective_members',
    };

    const crossModule = declaredRoutes.filter((route) => {
      const gate = routeGate(sources, route);
      if (!gate.module) return false;
      const implied = impliedModule[route.split('/').filter(Boolean)[0] ?? ''];
      return implied !== undefined && implied !== gate.module;
    });

    expect(crossModule).toEqual(['/inventory/admin/store']);
  });

  it('names a page the same way its hub card does', () => {
    // A crumb and a heading naming one screen differently is not cosmetic: the
    // roster's segment is "positions" and the page calls itself "Who Can Fill
    // What", so the fallback label invented a second name for it. The hub cards
    // are where these pages are named for the officer, so where both registries
    // describe the same path they have to agree.
    const labelled = SCHEDULING_HUB_CARDS.filter((card) => BREADCRUMB_ROUTES[card.path]?.label !== undefined);

    // Only a card whose path carries a crumb label is comparable, so pin that
    // there is one — otherwise this passes by having nothing to check.
    expect(labelled.length, 'no hub card path carries a crumb label to compare').toBeGreaterThan(0);

    const disagreements = labelled
      .filter((card) => BREADCRUMB_ROUTES[card.path]?.label !== card.label)
      .map((card) => `${card.path}: card "${card.label}" vs crumb "${BREADCRUMB_ROUTES[card.path]?.label}"`);

    expect(disagreements).toEqual([]);
  });

  it('labels every administration hub, so none falls back to “Admin”', () => {
    for (const crumbPath of Object.keys(HUB_TITLE_SOURCES)) {
      expect(BREADCRUMB_ROUTES[crumbPath]?.label, `${crumbPath} has no label`).toMatch(/\S/);
    }
  });
});
