import { ClipboardCheck, ClipboardList, Settings2 } from 'lucide-react';
import type { SectionNavItem } from './sectionNavigation';

/** Where the single Evaluations navigation entry lands, for every viewer. */
export const EVALUATIONS_HOME_PATH = '/reports/evaluations/mine';

/**
 * Every evaluation page sits under this prefix, so the navigation entry is
 * marked current on all of them and the Reports entry, whose own URL is a
 * prefix of it, is not.
 */
export const EVALUATIONS_AREA_PREFIX = '/reports/evaluations';

/**
 * The grants that see every evaluation in the department rather than only
 * the ones the viewer conducts. The conduct list answers both, so its label
 * says which the viewer is looking at.
 */
const SEES_ALL_EVALUATIONS = ['evaluations.view_all', 'evaluations.manage'];

/** What the conduct list is called for this viewer: theirs, or everyone's. */
export function conductListLabel(checkPermission: (permission: string) => boolean): string {
  return SEES_ALL_EVALUATIONS.some((permission) => checkPermission(permission))
    ? 'All evaluations'
    : 'Evaluations I conduct';
}

/** The setup section's name, shared by the strip and the template builder's way back. */
export const EVALUATION_SETUP_LABEL = 'Templates & periods';

/**
 * The Evaluations sections, drawn as the strip at the top of each evaluation
 * page. The side and top navigation carry one entry for the whole area, so
 * these rows are how an evaluator or an administrator moves between its parts.
 * See `SectionNavItem` for the rule every gate here must keep: each matches its
 * route's own gate in `modules/reports/routes.tsx`.
 *
 * My evaluations has no permission because its route has none — every member
 * can read the evaluations written about them.
 *
 * `counts` badge the links: the caller's own evaluations waiting on them, and
 * the overdue rows of the conduct list. Both come from the server
 * (`GET /evaluations/attention`); none are drawn until they arrive.
 */
export function evaluationsNavItems(
  checkPermission: (permission: string) => boolean,
  counts?: { mine: number; overdue: number } | null
): SectionNavItem[] {
  return [
    {
      label: 'My evaluations',
      path: EVALUATIONS_HOME_PATH,
      icon: ClipboardCheck,
      count: counts?.mine,
      countLabel: 'waiting on you',
    },
    {
      label: conductListLabel(checkPermission),
      path: '/reports/evaluations/conduct',
      icon: ClipboardList,
      anyPermission: ['evaluations.conduct', 'evaluations.view_all', 'evaluations.manage'],
      count: counts?.overdue,
      countLabel: 'overdue',
    },
    {
      label: EVALUATION_SETUP_LABEL,
      path: '/reports/evaluations',
      icon: Settings2,
      anyPermission: ['evaluations.configure', 'evaluations.manage'],
    },
  ];
}
