/**
 * Scheduling Administration's areas, and the agreement between the routes that
 * draw the hub's header and the list that says which ones do.
 *
 * A destination is marked "outside" when its route is not in
 * `SCHEDULING_ADMIN_SHELL_PATHS`, and the strip tells the officer so. If the
 * list and the routes drift, a page in the strip either claims to stay in the
 * hub and then drops the header, or wears the header while the strip says it
 * opens its own page.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { SCHEDULING_HUB_CARDS, SCHEDULING_HUB_SECTIONS } from './schedulingHubCards';
import {
  CREATE_SHIFT_PATH,
  SCHEDULING_ADMIN_AREAS,
  SCHEDULING_ADMIN_SHELL_PATHS,
  SCHEDULING_HEADLINE_METRICS_PATH,
  resolveSchedulingAdminLocation,
  schedulingAdminAreasFor,
} from './schedulingAdminAreas';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const routesSource = fs.readFileSync(path.join(HERE, '..', '..', '..', 'modules', 'scheduling', 'routes.tsx'), 'utf8');

/** Every path in the scheduling routes whose element is drawn inside the layout. */
const wrappedRoutes = (): string[] => {
  const matches = [...routesSource.matchAll(/path="([^"]+)"/g)];
  return matches.flatMap((match, index) => {
    const next = matches[index + 1]?.index ?? routesSource.length;
    const block = routesSource.slice(match.index, next);
    return block.includes('<SchedulingAdminLayout>') ? [match[1] ?? ''] : [];
  });
};

const everyArea = () => schedulingAdminAreasFor(SCHEDULING_HUB_CARDS, true);

describe('scheduling admin areas', () => {
  it('gives every card section exactly one area', () => {
    const sections = SCHEDULING_ADMIN_AREAS.flatMap((area) => (area.section ? [area.section] : []));
    expect([...sections].sort()).toEqual([...SCHEDULING_HUB_SECTIONS].sort());
  });

  it('files every card under an area', () => {
    const filed = new Set(everyArea().flatMap((area) => area.destinations.map((destination) => destination.id)));
    expect(SCHEDULING_HUB_CARDS.filter((card) => !filed.has(card.id)).map((card) => card.id)).toEqual([]);
  });

  it('draws the seven areas in order for a viewer who can open them all', () => {
    expect(everyArea().map((area) => area.label)).toEqual([
      'Overview',
      'Planning',
      'On the Shift',
      'Close-Out & History',
      'People & Eligibility',
      'Reports',
      'Settings',
    ]);
  });

  it('drops an area left with no page, but never Overview', () => {
    const areas = schedulingAdminAreasFor([], false);
    expect(areas.map((area) => area.id)).toEqual(['overview']);
    expect(areas[0]?.destinations.map((destination) => destination.id)).toEqual(['dashboard']);
  });

  it('offers Headline Metrics only to the grant that can read and save it', () => {
    const overview = (canManage: boolean) =>
      schedulingAdminAreasFor(SCHEDULING_HUB_CARDS, canManage)
        .find((area) => area.id === 'overview')
        ?.destinations.map((destination) => destination.id);

    expect(overview(true)).toEqual(['dashboard', 'metrics']);
    expect(overview(false)).toEqual(['dashboard']);
  });

  it('marks the Inventory checklist pages as opening their own page, and nothing else', () => {
    const outside = everyArea()
      .flatMap((area) => area.destinations)
      .filter((destination) => destination.outside)
      .map((destination) => destination.id);
    expect(outside.sort()).toEqual(['checklist-settings', 'equipment-checklists']);
  });

  it('sends Create Shift to the schedule, where its dialog lives', () => {
    expect(CREATE_SHIFT_PATH).toBe('/scheduling?create=shift');
  });
});

describe('header routes', () => {
  it('finds the wrapped routes', () => {
    // Guards the parser: matching nothing would make the comparison below
    // vacuously agree with an empty list.
    expect(wrappedRoutes().length).toBeGreaterThan(10);
  });

  it('wraps exactly the routes the list names', () => {
    // The hub page draws its own layout rather than being wrapped by its route.
    const listed = [...SCHEDULING_ADMIN_SHELL_PATHS].filter((route) => route !== '/scheduling/admin').sort();
    expect(wrappedRoutes().sort()).toEqual(listed);
  });

  it('wraps inside each gate rather than around it', () => {
    for (const route of wrappedRoutes()) {
      const start = routesSource.indexOf(`path="${route}"`);
      const block = routesSource.slice(start, routesSource.indexOf('<SchedulingAdminLayout>', start));
      expect(block, `${route} draws the header before its ProtectedRoute`).toContain('<ProtectedRoute');
    }
  });
});

describe('resolveSchedulingAdminLocation', () => {
  const resolve = (pathname: string, search = '', canManage = true) =>
    resolveSchedulingAdminLocation(pathname, search, schedulingAdminAreasFor(SCHEDULING_HUB_CARDS, canManage));

  it('reads the hub as Overview’s dashboard', () => {
    expect(resolve('/scheduling/admin')).toEqual({ areaId: 'overview', destinationId: 'dashboard' });
  });

  it('reads ?tab=settings as Headline Metrics, the address it had before the areas', () => {
    expect(SCHEDULING_HEADLINE_METRICS_PATH).toBe('/scheduling/admin?tab=settings');
    expect(resolve('/scheduling/admin', '?tab=settings')).toEqual({ areaId: 'overview', destinationId: 'metrics' });
  });

  it('reads ?tab=settings as the dashboard for a viewer the metrics page refuses', () => {
    expect(resolve('/scheduling/admin', '?tab=settings', false)).toEqual({
      areaId: 'overview',
      destinationId: 'dashboard',
    });
  });

  it('finds a page in its own area', () => {
    expect(resolve('/scheduling/admin/planning/patterns')).toEqual({ areaId: 'planning', destinationId: 'patterns' });
    expect(resolve('/scheduling/admin/closeout')).toEqual({ areaId: 'after-shift', destinationId: 'closeout' });
    expect(resolve('/scheduling/admin/positions')).toEqual({ areaId: 'people', destinationId: 'positions' });
    // A settings section whose card is filed under another area resolves there.
    expect(resolve('/scheduling/admin/settings/eligibility')).toEqual({
      areaId: 'people',
      destinationId: 'settings-eligibility',
    });
    expect(resolve('/scheduling/admin/settings/apparatus')).toEqual({
      areaId: 'settings',
      destinationId: 'settings-apparatus',
    });
  });

  it('finds Platoon Rosters under Settings when the department offers it', () => {
    expect(resolve('/scheduling/admin/settings/platoons')).toEqual({
      areaId: 'settings',
      destinationId: 'settings-platoons',
    });
  });

  // With platoon scheduling off, the layout filters the card away while the
  // route still answers (it falls back to General): the header must still say
  // the officer is in Settings rather than on the Overview.
  it('keeps a settings section with no card of its own under Settings', () => {
    const withoutPlatoons = SCHEDULING_HUB_CARDS.filter((card) => !card.requiresPlatoons);
    expect(
      resolveSchedulingAdminLocation(
        '/scheduling/admin/settings/platoons',
        '',
        schedulingAdminAreasFor(withoutPlatoons, true)
      )
    ).toEqual({ areaId: 'settings', destinationId: null });
  });

  it('falls back to Overview, with no page, for a path no destination names', () => {
    expect(resolve('/scheduling/admin/nowhere')).toEqual({ areaId: 'overview', destinationId: null });
  });
});
