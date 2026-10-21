import type React from 'react';

/**
 * One destination in a group of sibling pages — Operations, Governance — that
 * the side navigation, the top navigation and the group's section strip all
 * draw from a single list. Three hand-kept copies of the same gates is how a
 * row ends up offered in one place and hidden in another.
 *
 * Every gate must stay a subset of its route's own gate: `ProtectedRoute`
 * answers a permission failure with a full-page Access Denied, so a row the
 * route will refuse is a link to a dead end.
 */
export interface SectionNavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  permission?: string;
  anyPermission?: string[];
}

/** The rows a viewer's grants open. */
export function visibleSectionNavItems<T extends SectionNavItem>(
  items: T[],
  checkPermission: (permission: string) => boolean
): T[] {
  return items.filter(
    (item) =>
      (!item.permission || checkPermission(item.permission)) &&
      (!item.anyPermission || item.anyPermission.some((p) => checkPermission(p)))
  );
}

function matchLength(pathname: string, prefix: string): number {
  return pathname === prefix || pathname.startsWith(`${prefix}/`) ? prefix.length : -1;
}

/**
 * The section a URL belongs to: the longest matching prefix, so
 * `/inventory/checklists/my` is My Checklists and not Fleet Readiness, and
 * Fleet Readiness is not Inventory. `undefined` when nothing matches — the
 * strip then shows no selection rather than guessing.
 */
export function activeSection<T extends SectionNavItem>(items: T[], pathname: string): T | undefined {
  let best: T | undefined;
  let bestLength = -1;
  for (const item of items) {
    const length = matchLength(pathname, item.path);
    if (length > bestLength) {
      best = item;
      bestLength = length;
    }
  }
  return best;
}
