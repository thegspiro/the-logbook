/**
 * Inventory Administration's navigation: seven areas, each a short list of
 * destinations, drawn the way Training Administration draws its own (area
 * cards above a strip of the area's pages).
 *
 * The destinations are the hub's existing cards (`inventoryHubCards.ts`), so a
 * destination carries the gate of the route it opens and the registry's
 * route-gate test keeps covering it. Areas map one-to-one onto the card
 * sections, except that the supply lines are not destinations: they are the
 * Overview's body, and Overview's own two pages are declared here.
 *
 * Unlike Training, every destination is its own route. The header is drawn
 * around a page by `InventoryAdminLayout`, which the routes in
 * `INVENTORY_ADMIN_SHELL_PATHS` wrap their element in, so a link, a bookmark
 * or a refresh lands on the same URL it always did. A destination outside that
 * set (the kiosk, the NFC scanning tools, the store's own console) still sits
 * in the strip, but opens its own page without this header.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Box,
  ClipboardCheck,
  ClipboardList,
  Gauge,
  LayoutDashboard,
  SlidersHorizontal,
  Store,
  Users,
} from 'lucide-react';
import type { InventoryHubCard, InventoryHubSection } from './inventoryHubCards';

export type InventoryAdminAreaId = 'overview' | 'catalog' | 'issuance' | 'requests' | 'readiness' | 'store' | 'tools';

export interface InventoryAdminArea {
  id: InventoryAdminAreaId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** The card section whose cards are this area's destinations. Overview has none. */
  section?: InventoryHubSection;
}

export const INVENTORY_ADMIN_AREAS: InventoryAdminArea[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'What needs a decision today, by supply line',
    icon: LayoutDashboard,
  },
  {
    id: 'catalog',
    label: 'Catalog',
    description: 'What the department owns and where it lives',
    icon: Box,
    section: 'Catalog',
  },
  {
    id: 'issuance',
    label: 'Issuance & Members',
    description: 'Who holds what, and how it is handed out',
    icon: Users,
    section: 'Issuance & Members',
  },
  {
    id: 'requests',
    label: 'Requests & Approvals',
    description: 'Decisions members and officers are waiting on',
    icon: ClipboardList,
    section: 'Requests & Approvals',
  },
  {
    id: 'readiness',
    label: 'Readiness & Compliance',
    description: 'Inspections, checklists and expiring stock',
    icon: ClipboardCheck,
    section: 'Readiness & Compliance',
  },
  {
    id: 'store',
    label: 'Department Store',
    description: 'Uniform sales, orders and payments',
    icon: Store,
    section: 'Department Store',
  },
  {
    id: 'tools',
    label: 'Setup & Tools',
    description: 'First-run setup, imports and NFC tags',
    icon: SlidersHorizontal,
    section: 'Setup & Tools',
  },
];

/**
 * Every route drawn inside the hub's header, matched against the bare path.
 *
 * `inventoryAdminAreas.test.ts` reads the route source and fails if a route
 * listed here does not wrap its page in `InventoryAdminLayout`, or one that
 * does is missing here — the two must agree, or a tab in the strip claims to
 * stay in the hub and then drops the header.
 *
 * Detail and editor screens (a clearance, a checklist template) are left out
 * on purpose: they are reached from a list, not from the strip, and keep their
 * own breadcrumb back to it.
 */
export const INVENTORY_ADMIN_SHELL_PATHS: ReadonlySet<string> = new Set([
  '/inventory/admin',
  '/inventory/admin/setup',
  '/inventory/admin/items',
  '/inventory/admin/pool',
  '/inventory/admin/categories',
  '/inventory/admin/maintenance',
  '/inventory/admin/members',
  '/inventory/admin/charges',
  '/inventory/admin/returns',
  '/inventory/admin/requests',
  '/inventory/admin/write-offs',
  '/inventory/admin/reorder',
  '/inventory/admin/kits',
  '/inventory/admin/variant-groups',
  '/inventory/admin/allowances',
  '/inventory/admin/vendors',
  '/inventory/admin/impact-planner',
  '/inventory/admin/nfc',
  '/inventory/admin/nfc/enroll',
  '/inventory/admin/nfc/tags',
  '/inventory/admin/not-seen',
  '/inventory/admin/checklists',
  '/inventory/admin/checklists/reports',
  '/inventory/admin/checklists/supply',
]);

export interface InventoryAdminDestination {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  path: string;
  /** Opens its own page rather than one drawn inside the hub's header. */
  outside: boolean;
}

/** `?tab=settings` is the metrics page's address from before the areas, kept so links still land. */
export const HEADLINE_METRICS_PATH = '/inventory/admin?tab=settings';

const splitPath = (target: string): { bare: string; query: URLSearchParams } => {
  const [bare = target, query = ''] = target.split('?');
  return { bare, query: new URLSearchParams(query) };
};

const destinationFromCard = (card: InventoryHubCard): InventoryAdminDestination => ({
  id: card.id,
  label: card.label,
  hint: card.description,
  icon: card.icon,
  path: card.path,
  outside: !INVENTORY_ADMIN_SHELL_PATHS.has(splitPath(card.path).bare),
});

export interface ResolvedInventoryAdminArea extends InventoryAdminArea {
  destinations: InventoryAdminDestination[];
}

/**
 * The areas this viewer sees, each holding only the destinations they may open.
 *
 * `visibleCards` must already be filtered through the viewer's grants and the
 * department's modules — this does no gating of its own beyond Headline
 * Metrics, which is not a card. An area left with no destinations is dropped,
 * except Overview, whose Dashboard is the hub page every viewer of the header
 * can open.
 */
export function inventoryAdminAreasFor(
  visibleCards: InventoryHubCard[],
  canManage: boolean
): ResolvedInventoryAdminArea[] {
  return INVENTORY_ADMIN_AREAS.map((area) => {
    if (area.id === 'overview') {
      const destinations: InventoryAdminDestination[] = [
        {
          id: 'dashboard',
          label: 'Dashboard',
          hint: 'Needs attention and the supply lines',
          icon: LayoutDashboard,
          path: '/inventory/admin',
          outside: false,
        },
      ];
      // Its read and its write both require `inventory.manage`.
      if (canManage) {
        destinations.push({
          id: 'metrics',
          label: 'Headline Metrics',
          hint: 'Choose the figures shown at the top of this page',
          icon: Gauge,
          path: HEADLINE_METRICS_PATH,
          outside: false,
        });
      }
      return { ...area, destinations };
    }
    return {
      ...area,
      destinations: visibleCards.filter((card) => card.section === area.section).map(destinationFromCard),
    };
  }).filter((area) => area.id === 'overview' || area.destinations.length > 0);
}

/**
 * Which area and destination the current URL is.
 *
 * Matched on the bare path, then on any query a destination's own path
 * carries: Dashboard and Headline Metrics share `/inventory/admin` and differ
 * only by `?tab=settings`, while `/inventory/admin/items?item_type=ppe` (the
 * PPE supply line) is still All Items. A destination naming a query wins over
 * one that names none, so the more specific match is taken.
 *
 * A path no destination matches resolves to Overview with no destination, so
 * the header still says where the viewer is rather than highlighting nothing.
 */
export function resolveInventoryAdminLocation(
  pathname: string,
  search: string,
  areas: ResolvedInventoryAdminArea[]
): { areaId: InventoryAdminAreaId; destinationId: string | null } {
  const current = new URLSearchParams(search);
  let best: { areaId: InventoryAdminAreaId; destinationId: string; specificity: number } | null = null;

  for (const area of areas) {
    for (const destination of area.destinations) {
      const { bare, query } = splitPath(destination.path);
      if (bare !== pathname) continue;
      const keys = [...query.keys()];
      const matches = keys.every((key) => current.get(key) === query.get(key));
      if (!matches) continue;
      if (!best || keys.length > best.specificity) {
        best = { areaId: area.id, destinationId: destination.id, specificity: keys.length };
      }
    }
  }

  return best
    ? { areaId: best.areaId, destinationId: best.destinationId }
    : { areaId: 'overview', destinationId: null };
}
