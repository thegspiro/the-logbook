import React, { useId } from 'react';
import { Link, useLocation } from 'react-router';
import { Breadcrumbs } from '../ux/Breadcrumbs';
import type { BreadcrumbItem } from '../ux/Breadcrumbs';
import { ScrollCueRow } from '../ux/ScrollCueRow';
import { useAuthStore } from '../../stores/authStore';
import { useEnabledModules } from '../../hooks/useEnabledModules';
import type { OperationsNavItem } from '../layout/operationsNavigation';
import { activeOperationsSection, operationsNavItems, visibleOperationsNavItems } from '../layout/operationsNavigation';
import { isAdministrativeMember } from '../../utils/membership';

const DENY_ALL = (): boolean => false;

/**
 * The Operations sections this viewer's grants open, and the one the current
 * URL belongs to. Rows come from `operationsNavItems`, the same list the side
 * and top navigation draw, so nothing here can offer a section the navigation
 * hides.
 */
function useOperationsSections() {
  const { pathname } = useLocation();
  // Denies every row when the store hands back no predicate, as
  // `Breadcrumbs` does and for the same reason: page suites stub
  // `useAuthStore` with only the slice the page reads — some ignoring the
  // selector and returning the whole stub — and a navigation strip must never
  // be what stops a page rendering.
  const storePredicate: unknown = useAuthStore((state) => state.checkPermission);
  const checkPermission =
    typeof storePredicate === 'function' ? (storePredicate as (permission: string) => boolean) : DENY_ALL;
  // Read as unknown for the same reason: a suite that stubs the store without
  // honouring the selector hands back its whole stub, which is not a string.
  const membershipType: unknown = useAuthStore((state) => state.user?.membership_type);
  const isAdministrative = typeof membershipType === 'string' && isAdministrativeMember(undefined, membershipType);
  const { isModuleOn } = useEnabledModules();
  const items = visibleOperationsNavItems(operationsNavItems(isModuleOn, isAdministrative), checkPermission);
  return { pathname, items, active: activeOperationsSection(items, pathname) };
}

interface OperationsSectionNavProps {
  items: OperationsNavItem[];
  active: OperationsNavItem | undefined;
}

/**
 * The strip of Operations sections every Operations page draws at its top.
 *
 * Links, not tabs: each section is its own route, so the strip is a `<nav>`
 * marking the open section with `aria-current="page"`, and a section can be
 * bookmarked, refreshed into and reached with the back button.
 */
const OperationsSectionNav: React.FC<OperationsSectionNavProps> = ({ items, active }) => {
  const labelId = useId();
  // One section is no navigation: the strip would be a single selected link
  // to the page already open.
  if (items.length < 2) return null;

  return (
    <nav aria-labelledby={labelId} className="card mb-6 overflow-hidden">
      {/* One name for the landmark and its scrolling row: the mobile sweep
          requires a declared scroll region to carry a label of its own, and
          pointing both at one heading names it without saying it twice. */}
      <span id={labelId} className="sr-only">
        Operations sections
      </span>
      {/* The border sits on a wrapper so the edge fade does not erase it. */}
      <div className="border-theme-surface-border border-b">
        <ScrollCueRow
          className="flex gap-1 px-2"
          revealKey={active?.path}
          aria-labelledby={labelId}
          data-mobile-scroll-region
        >
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = item === active;
            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={isActive ? 'page' : undefined}
                className={`focus:ring-theme-focus-ring touch:min-h-11 -mb-px flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors focus:ring-2 focus:outline-hidden focus:ring-inset ${
                  isActive
                    ? 'text-theme-text-primary border-red-800'
                    : 'text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border border-transparent'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </ScrollCueRow>
      </div>
    </nav>
  );
};

interface OperationsPageHeaderProps {
  icon: React.ElementType;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Buttons and links for the page, drawn to the right of the title. */
  actions?: React.ReactNode;
  /**
   * The page's own crumb when `title` is not plain text — a record name with a
   * badge beside it, say. Defaults to `title` when that is a string.
   */
  breadcrumbLabel?: string | undefined;
  /** Crumbs between the section and this page, for a page two levels down. */
  parentCrumbs?: BreadcrumbItem[] | undefined;
}

/**
 * The header every Operations page shares: the section strip, a trail on any
 * page below a section's own, then the title row in the shape the Training
 * pages use — a red icon beside a 2xl/3xl heading, a muted line under it,
 * actions on the right.
 *
 * The pages under Operations grew one header each, with five title sizes,
 * back links pointing at four different places and one page with a band of
 * its own; the strip and the trail replace every one of those back links.
 *
 * The trail is written in Operations' terms, not generated from the URL: the
 * URL says `/inventory/checklists/log`, which reads "Inventory › Equipment
 * Checklists › Log" directly under a strip saying the page is Fleet Readiness.
 * On a section's own page the strip already marks where the viewer is, so
 * there is no trail at all.
 */
export const OperationsPageHeader: React.FC<OperationsPageHeaderProps> = ({
  icon: Icon,
  title,
  subtitle,
  actions,
  breadcrumbLabel,
  parentCrumbs,
}) => {
  const { pathname, items, active } = useOperationsSections();
  const pageLabel = breadcrumbLabel ?? (typeof title === 'string' ? title : undefined);
  const trail: BreadcrumbItem[] =
    active && pathname !== active.path
      ? [
          { label: active.label, path: active.path },
          ...(parentCrumbs ?? []),
          ...(pageLabel ? [{ label: pageLabel }] : []),
        ]
      : [];

  return (
    <div>
      <OperationsSectionNav items={items} active={active} />
      {trail.length > 0 && <Breadcrumbs items={trail} />}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 sm:flex-[1_1_16rem]">
          <h1 className="text-theme-text-primary flex items-center space-x-3 text-2xl font-bold sm:text-3xl">
            <Icon className="h-8 w-8 shrink-0 text-red-700 dark:text-red-500" aria-hidden="true" />
            <span className="min-w-0">{title}</span>
          </h1>
          {subtitle && <div className="text-theme-text-muted mt-2">{subtitle}</div>}
        </div>
        {actions && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-[0_1_auto] sm:justify-end">{actions}</div>
        )}
      </div>
    </div>
  );
};

export default OperationsPageHeader;
