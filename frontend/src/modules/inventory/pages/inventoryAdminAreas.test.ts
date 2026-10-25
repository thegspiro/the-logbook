/**
 * Inventory Administration's areas, and the agreement between the routes that
 * draw the hub's header and the list that says which ones do.
 *
 * A destination is marked "outside" when its route is not in
 * `INVENTORY_ADMIN_SHELL_PATHS`, and the strip tells the officer so. If the
 * list and the routes drift, a page in the strip either claims to stay in the
 * hub and then drops the header, or wears the header while the strip says it
 * opens its own page.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { INVENTORY_HUB_CARDS, INVENTORY_HUB_SECTIONS } from './inventoryHubCards';
import {
  HEADLINE_METRICS_PATH,
  INVENTORY_ADMIN_AREAS,
  INVENTORY_ADMIN_SHELL_PATHS,
  inventoryAdminAreasFor,
  resolveInventoryAdminLocation,
} from './inventoryAdminAreas';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const routesSource = fs.readFileSync(path.join(HERE, '..', 'routes.tsx'), 'utf8');

/** Every path in the inventory routes whose element is drawn inside the layout. */
const wrappedRoutes = (): string[] => {
  const matches = [...routesSource.matchAll(/path="([^"]+)"/g)];
  return matches.flatMap((match, index) => {
    const next = matches[index + 1]?.index ?? routesSource.length;
    const block = routesSource.slice(match.index, next);
    return block.includes('<InventoryAdminLayout>') ? [match[1] ?? ''] : [];
  });
};

const everyArea = () => inventoryAdminAreasFor(INVENTORY_HUB_CARDS, true);

describe('inventory admin areas', () => {
  it('gives every card section but the supply lines exactly one area', () => {
    const sections = INVENTORY_ADMIN_AREAS.flatMap((area) => (area.section ? [area.section] : []));
    expect([...sections].sort()).toEqual(INVENTORY_HUB_SECTIONS.filter((s) => s !== 'Supply lines').sort());
  });

  it('files every card but the supply lines under an area', () => {
    const filed = new Set(everyArea().flatMap((area) => area.destinations.map((destination) => destination.id)));
    const unfiled = INVENTORY_HUB_CARDS.filter((card) => card.section !== 'Supply lines' && !filed.has(card.id));
    expect(unfiled.map((card) => card.id)).toEqual([]);
  });

  it('drops an area left with no page, but never Overview', () => {
    const areas = inventoryAdminAreasFor([], false);
    expect(areas.map((area) => area.id)).toEqual(['overview']);
    expect(areas[0]?.destinations.map((destination) => destination.id)).toEqual(['dashboard']);
  });

  it('offers Headline Metrics only to the grant that can read and save it', () => {
    const overview = (canManage: boolean) =>
      inventoryAdminAreasFor(INVENTORY_HUB_CARDS, canManage)
        .find((area) => area.id === 'overview')
        ?.destinations.map((destination) => destination.id);

    expect(overview(true)).toEqual(['dashboard', 'metrics']);
    expect(overview(false)).toEqual(['dashboard']);
  });

  it('marks a page outside the header by its route, not by its label', () => {
    const outside = new Map(everyArea().flatMap((area) => area.destinations.map((d) => [d.id, d.outside] as const)));
    expect(outside.get('requests')).toBe(false);
    expect(outside.get('items')).toBe(false);
    expect(outside.get('storage-areas')).toBe(true);
    expect(outside.get('nfc-kiosk')).toBe(true);
    expect(outside.get('store')).toBe(true);
  });
});

describe('header routes', () => {
  it('finds the wrapped routes', () => {
    // Guards the parser: matching nothing would make the comparison below
    // vacuously agree with an empty list.
    expect(wrappedRoutes().length).toBeGreaterThan(15);
  });

  it('wraps exactly the routes the list names', () => {
    // The hub page draws its own layout rather than being wrapped by its route.
    const listed = [...INVENTORY_ADMIN_SHELL_PATHS].filter((route) => route !== '/inventory/admin').sort();
    expect(wrappedRoutes().sort()).toEqual(listed);
  });

  it('wraps inside each gate rather than around it', () => {
    for (const route of wrappedRoutes()) {
      const start = routesSource.indexOf(`path="${route}"`);
      const block = routesSource.slice(start, routesSource.indexOf('<InventoryAdminLayout>', start));
      expect(block, `${route} draws the header before its ProtectedRoute`).toContain('<ProtectedRoute');
    }
  });
});

describe('resolveInventoryAdminLocation', () => {
  const resolve = (pathname: string, search = '', canManage = true) =>
    resolveInventoryAdminLocation(pathname, search, inventoryAdminAreasFor(INVENTORY_HUB_CARDS, canManage));

  it('reads the hub as Overview’s dashboard', () => {
    expect(resolve('/inventory/admin')).toEqual({ areaId: 'overview', destinationId: 'dashboard' });
  });

  it('reads ?tab=settings as Headline Metrics, the address it had before the areas', () => {
    expect(HEADLINE_METRICS_PATH).toBe('/inventory/admin?tab=settings');
    expect(resolve('/inventory/admin', '?tab=settings')).toEqual({ areaId: 'overview', destinationId: 'metrics' });
  });

  it('reads ?tab=settings as the dashboard for a viewer the metrics page refuses', () => {
    expect(resolve('/inventory/admin', '?tab=settings', false)).toEqual({
      areaId: 'overview',
      destinationId: 'dashboard',
    });
  });

  it('keeps a supply line’s filtered list on All Items', () => {
    expect(resolve('/inventory/admin/items', '?item_type=ppe')).toEqual({ areaId: 'catalog', destinationId: 'items' });
  });

  it('finds a page in its own area', () => {
    expect(resolve('/inventory/admin/requests')).toEqual({ areaId: 'requests', destinationId: 'requests' });
    expect(resolve('/inventory/admin/checklists/reports')).toEqual({
      areaId: 'readiness',
      destinationId: 'check-reports',
    });
    expect(resolve('/inventory/admin/nfc/tags')).toEqual({ areaId: 'tools', destinationId: 'nfc-register' });
  });

  it('falls back to Overview, with no page, for a path no destination names', () => {
    expect(resolve('/inventory/admin/nowhere')).toEqual({ areaId: 'overview', destinationId: null });
  });
});
