/**
 * Scheduling Administration's navigation: seven areas, each a short list of
 * destinations, drawn the way Training and Inventory Administration draw their
 * own (area cards above a strip of the area's pages).
 *
 * The destinations are the hub's existing cards (`schedulingHubCards.ts`), so
 * a destination carries the gate of the route it opens and the registry's
 * route-gate test keeps covering it. Areas map one-to-one onto the card
 * sections; Overview's own two pages are declared here.
 *
 * As in Inventory, every destination is its own route. The header is drawn
 * around a page by `SchedulingAdminLayout`, which the routes in
 * `SCHEDULING_ADMIN_SHELL_PATHS` wrap their element in, so a link, a bookmark
 * or a refresh lands on the same URL it always did. A destination outside that
 * set (the two checklist pages, which belong to Inventory) still sits in the
 * strip, but opens its own page without this header.
 */

import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  CalendarRange,
  ClipboardCheck,
  Gauge,
  History,
  LayoutDashboard,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import type { SchedulingHubCard, SchedulingHubSection } from './schedulingHubCards';

export type SchedulingAdminAreaId =
  'overview' | 'planning' | 'on-shift' | 'after-shift' | 'people' | 'reports' | 'settings';

export interface SchedulingAdminArea {
  id: SchedulingAdminAreaId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** The card section whose cards are this area's destinations. Overview has none. */
  section?: SchedulingHubSection;
}

export const SCHEDULING_ADMIN_AREAS: SchedulingAdminArea[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'What needs a decision today',
    icon: LayoutDashboard,
  },
  {
    id: 'planning',
    label: 'Planning',
    description: 'Short shifts, and the templates and patterns behind them',
    icon: CalendarRange,
    section: 'Before the shift',
  },
  {
    id: 'on-shift',
    label: 'On the Shift',
    description: 'The checklists crews run, and when',
    icon: ClipboardCheck,
    section: 'On the shift',
  },
  {
    id: 'after-shift',
    label: 'Close-Out & History',
    description: 'Ended shifts to close, and past shifts to import',
    icon: History,
    section: 'After the shift',
  },
  {
    id: 'people',
    label: 'People & Eligibility',
    description: 'Who can fill which seat, and platoons',
    icon: Users,
    section: 'People & eligibility',
  },
  {
    id: 'reports',
    label: 'Reports',
    description: 'Hours, coverage, call volume and availability',
    icon: BarChart3,
    section: 'Reporting',
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Defaults, apparatus and notifications',
    icon: SlidersHorizontal,
    section: 'Department settings',
  },
];

/** Every settings section is a route under this prefix — see `resolveSchedulingAdminLocation`. */
const SETTINGS_PREFIX = '/scheduling/admin/settings/';

/**
 * Every route drawn inside the hub's header, matched against the bare path.
 *
 * `schedulingAdminAreas.test.ts` reads the route source and fails if a route
 * listed here does not wrap its page in `SchedulingAdminLayout`, or one that
 * does is missing here — the two must agree, or a page in the strip claims to
 * stay in the hub and then drops the header.
 *
 * The history-import review screen is left out on purpose: it is reached from
 * an import in the list, not from the strip, and keeps its own breadcrumb back
 * to it. So is the bare `/settings` path, which only redirects.
 */
export const SCHEDULING_ADMIN_SHELL_PATHS: ReadonlySet<string> = new Set([
  '/scheduling/admin',
  '/scheduling/admin/planning',
  '/scheduling/admin/planning/templates',
  '/scheduling/admin/planning/patterns',
  '/scheduling/admin/closeout',
  '/scheduling/admin/history-import',
  '/scheduling/admin/reports',
  '/scheduling/admin/platoons',
  '/scheduling/admin/positions',
  '/scheduling/admin/settings/general',
  '/scheduling/admin/settings/apparatus',
  '/scheduling/admin/settings/platoons',
  '/scheduling/admin/settings/eligibility',
  '/scheduling/admin/settings/notifications',
  '/scheduling/admin/settings/shift-reports',
  '/scheduling/admin/settings/outside-apparatus',
]);

export interface SchedulingAdminDestination {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  path: string;
  /** Opens its own page rather than one drawn inside the hub's header. */
  outside: boolean;
}

/**
 * Where the header's Create Shift opens. The dialog lives on the member
 * schedule, beside the board it adds to; `SchedulingPage` opens it when it
 * arrives with this query, and drops the query once it has.
 */
export const CREATE_SHIFT_PATH = '/scheduling?create=shift';

/** `?tab=settings` is the metrics page's address from before the areas, kept so links still land. */
export const SCHEDULING_HEADLINE_METRICS_PATH = '/scheduling/admin?tab=settings';

const splitPath = (target: string): { bare: string; query: URLSearchParams } => {
  const [bare = target, query = ''] = target.split('?');
  return { bare, query: new URLSearchParams(query) };
};

const destinationFromCard = (card: SchedulingHubCard): SchedulingAdminDestination => ({
  id: card.id,
  label: card.label,
  hint: card.description,
  icon: card.icon,
  path: card.path,
  outside: !SCHEDULING_ADMIN_SHELL_PATHS.has(splitPath(card.path).bare),
});

export interface ResolvedSchedulingAdminArea extends SchedulingAdminArea {
  destinations: SchedulingAdminDestination[];
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
export function schedulingAdminAreasFor(
  visibleCards: SchedulingHubCard[],
  canManage: boolean
): ResolvedSchedulingAdminArea[] {
  return SCHEDULING_ADMIN_AREAS.map((area) => {
    if (area.id === 'overview') {
      const destinations: SchedulingAdminDestination[] = [
        {
          id: 'dashboard',
          label: 'Dashboard',
          hint: 'Setup, and what needs a decision today',
          icon: LayoutDashboard,
          path: '/scheduling/admin',
          outside: false,
        },
      ];
      // Its read and its write both require `scheduling.manage`.
      if (canManage) {
        destinations.push({
          id: 'metrics',
          label: 'Headline Metrics',
          hint: 'Choose the figures shown at the top of this page',
          icon: Gauge,
          path: SCHEDULING_HEADLINE_METRICS_PATH,
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
 * carries: Dashboard and Headline Metrics share `/scheduling/admin` and differ
 * only by `?tab=settings`. A destination naming a query wins over one that
 * names none, so the more specific match is taken.
 *
 * A settings section with no card of its own (Platoons, which exists only once
 * platoon scheduling is on) resolves to the Settings area with no page, so the
 * header still says it is a setting. Any other path no destination matches
 * resolves to Overview with no destination, so the header still says where the
 * viewer is rather than highlighting nothing.
 */
export function resolveSchedulingAdminLocation(
  pathname: string,
  search: string,
  areas: ResolvedSchedulingAdminArea[]
): { areaId: SchedulingAdminAreaId; destinationId: string | null } {
  const current = new URLSearchParams(search);
  let best: { areaId: SchedulingAdminAreaId; destinationId: string; specificity: number } | null = null;

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

  if (best) return { areaId: best.areaId, destinationId: best.destinationId };
  if (pathname.startsWith(SETTINGS_PREFIX) && areas.some((area) => area.id === 'settings')) {
    return { areaId: 'settings', destinationId: null };
  }
  return { areaId: 'overview', destinationId: null };
}
