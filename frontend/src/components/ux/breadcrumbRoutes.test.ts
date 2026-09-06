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
import { barePath, routeGate, routeSources } from '../../test/routeGates';
import { BREADCRUMB_ROUTES } from './breadcrumbRoutes';
import { SCHEDULING_HUB_CARDS } from '../../pages/scheduling/admin/schedulingHubCards';
import { INVENTORY_HUB_CARDS } from '../../modules/inventory/pages/inventoryHubCards';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Every source file that could name a hub, in the manner of `routeIntegrity`. */
const collectSourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'e2e') found.push(...collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
};
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

  it('registers every hub a page names with underHub', () => {
    // `underHub` inserts nothing for a path the registry does not carry, so a
    // typo costs that page its hub crumb in silence. The value is a literal in
    // source, so it is checkable; this is the only thing standing between a
    // mistyped hub and a trail that quietly stops reaching Administration.
    const used = [
      ...new Set(
        collectSourceFiles(SRC)
          .flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(/underHub="([^"]+)"/g)])
          .map((match) => match[1] as string)
      ),
    ].sort();

    expect(used.length, 'no page uses underHub, so this checks nothing').toBeGreaterThan(0);

    const unregistered = used.filter((hubPath) => !(hubPath in BREADCRUMB_ROUTES));
    expect(unregistered, 'a page names a hub the registry does not carry').toEqual([]);

    // A hub is only worth splicing if it is labelled; otherwise the crumb falls
    // back to title-casing its URL segment and reads "Admin".
    const unlabelled = used.filter((hubPath) => BREADCRUMB_ROUTES[hubPath]?.label === undefined);
    expect(unlabelled, 'a hub is spliced in with no label of its own').toEqual([]);
  });

  it('gives every Inventory Administration card outside the hub’s URL space its hub crumb', () => {
    // The gap `underHub` leaves open: it is opt-in per page, so a page that
    // should name its hub and does not simply will not, in silence. The
    // registration test above proves the values that ARE used are real hubs; it
    // cannot know about a page that never opted in.
    //
    // Inventory declares its cards as data, which makes the obligation
    // derivable: a card is a page of Inventory Administration, so any card
    // route that does not already sit under /inventory/admin has to say so.
    // A card pointing outside the module altogether (EMS Supplies →
    // /medical-supplies) is excluded — `withHubCrumb` needs a shared ancestor
    // and would insert nothing there anyway.
    const HUB = '/inventory/admin';
    const routesFile = path.join(SRC, 'modules/inventory/routes.tsx');
    const routesSource = fs.readFileSync(routesFile, 'utf8');

    const componentFiles = new Map<string, string>();
    for (const match of routesSource.matchAll(/const (\w+) = \w+\(\(\) => import\('([^']+)'\)\)/g)) {
      const resolved = path.resolve(path.dirname(routesFile), match[2] as string);
      const file = ['.tsx', '.ts'].map((ext) => resolved + ext).find((candidate) => fs.existsSync(candidate));
      if (file) componentFiles.set(match[1] as string, file);
    }
    expect(componentFiles.size, 'could not read the lazy imports out of the inventory routes').toBeGreaterThan(10);

    const owed = INVENTORY_HUB_CARDS.map((card) => barePath(card.path)).filter(
      (route) => route.startsWith('/inventory/') && !route.startsWith(HUB)
    );
    expect(owed.length, 'no inventory card sits outside the hub’s URL space, so this checks nothing').toBeGreaterThan(
      0
    );

    const missing = owed.filter((route) => {
      const component = new RegExp(`path="${route}"[\\s\\S]{0,900}?<(\\w+)\\s*/>`).exec(routesSource)?.[1];
      const file = component ? componentFiles.get(component) : undefined;
      return !file || !fs.readFileSync(file, 'utf8').includes(`underHub="${HUB}"`);
    });

    expect(missing, 'these Inventory Administration pages do not name their hub').toEqual([]);
  });

  // Every hub whose cards are declared as data. A hub that builds its cards
  // inline cannot be read here, which is a reason to declare them, not a reason
  // to leave the comparison to review.
  const HUB_CARDS: { hub: string; cards: { label: string; path: string }[] }[] = [
    { hub: 'scheduling', cards: SCHEDULING_HUB_CARDS },
    { hub: 'inventory', cards: INVENTORY_HUB_CARDS },
  ];

  it.each(HUB_CARDS)('names a page the same way the $hub hub card does', ({ cards }) => {
    // A crumb and a heading naming one screen differently is not cosmetic: the
    // roster's segment is "positions" and the page calls itself "Who Can Fill
    // What", so the fallback label invented a second name for it. The hub cards
    // are where these pages are named for the officer, so where both registries
    // describe the same path they have to agree.
    //
    // A card path may carry a query string ("?item_type=ppe") selecting a view
    // of a page rather than naming a page; those are not comparable and drop
    // out by simply not matching a registry key.
    const labelled = cards.filter((card) => BREADCRUMB_ROUTES[card.path]?.label !== undefined);

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
