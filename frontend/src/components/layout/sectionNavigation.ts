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
  /**
   * Other URLs that open this section's own page — `/training` renders My
   * Training. Matched exactly, never as a prefix: as a prefix `/training` would
   * claim every Training page that sits under no section of its own.
   */
  aliases?: string[];
  /**
   * Replace the history entry rather than push one. For sections that are
   * views of one page (`/scheduling?tab=…`), where moving between them has
   * never been a step the Back button retraces.
   */
  replace?: boolean;
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

/** Whether `pathname` is the section's own page rather than one below it. */
export function isSectionPage(item: SectionNavItem, pathname: string): boolean {
  // A section addressed by a query (`/scheduling?tab=my-shifts`) is still its
  // page's own section, never a page below it.
  const ownPath = item.path.split('?')[0] ?? item.path;
  return pathname === ownPath || (item.aliases?.includes(pathname) ?? false);
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
    const length = item.aliases?.includes(pathname) ? pathname.length : matchLength(pathname, item.path);
    if (length > bestLength) {
      best = item;
      bestLength = length;
    }
  }
  return best;
}
