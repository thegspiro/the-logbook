import React, { useId } from 'react';
import { Link, useLocation } from 'react-router';
import { Breadcrumbs } from '../ux/Breadcrumbs';
import type { BreadcrumbItem } from '../ux/Breadcrumbs';
import { ScrollCueRow } from '../ux/ScrollCueRow';
import { BREADCRUMB_ROUTES, canLinkCrumb } from '../ux/breadcrumbRoutes';
import { useAuthStore } from '../../stores/authStore';
import type { SectionNavItem } from './sectionNavigation';
import { activeSection, isSectionPage, visibleSectionNavItems } from './sectionNavigation';

const DENY_ALL = (): boolean => false;

/**
 * The viewer's permission predicate, denying everything when the store hands
 * back no function — as `Breadcrumbs` does and for the same reason: page suites
 * stub `useAuthStore` with only the slice the page reads, some ignoring the
 * selector and returning the whole stub, and a navigation strip must never be
 * what stops a page rendering.
 */
function useSectionPermission(): (permission: string) => boolean {
  const storePredicate: unknown = useAuthStore((state) => state.checkPermission);
  return typeof storePredicate === 'function' ? (storePredicate as (permission: string) => boolean) : DENY_ALL;
}

/**
 * The strip's accent. Red is the house colour; Scheduling keeps the violet it
 * has always used for its own views.
 */
export type SectionAccent = 'red' | 'violet';

const ACTIVE_CLASSES: Record<SectionAccent, string> = {
  red: 'text-theme-text-primary border-red-800',
  violet: 'border-violet-600 text-violet-700 dark:text-violet-400',
};

interface SectionNavProps {
  items: SectionNavItem[];
  active: SectionNavItem | undefined;
  label: string;
  accent: SectionAccent;
}

/**
 * The strip of a group's sections, drawn at the top of every page in it.
 *
 * Links, not tabs: each section is its own route, so the strip is a `<nav>`
 * marking the open section with `aria-current="page"`, and a section can be
 * bookmarked, refreshed into and reached with the back button.
 */
const SectionNav: React.FC<SectionNavProps> = ({ items, active, label, accent }) => {
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
        {label}
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
                replace={item.replace ?? false}
                aria-current={isActive ? 'page' : undefined}
                className={`focus:ring-theme-focus-ring touch:min-h-11 -mb-px flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors focus:ring-2 focus:outline-hidden focus:ring-inset ${
                  isActive
                    ? ACTIVE_CLASSES[accent]
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

export interface PageHeaderProps {
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
  /**
   * The administration hub this page is a card of, when the page does not sit
   * under the hub in the URL — `/inventory/storage-areas` is an Inventory
   * Administration card but not under `/inventory/admin`. Its crumb follows the
   * section's, labelled and gated by `BREADCRUMB_ROUTES` like `Breadcrumbs`'
   * prop of the same name; `breadcrumbRoutes.test.ts` reads the literal to
   * prove every such card names its hub.
   */
  underHub?: string | undefined;
  /**
   * The section this page belongs to when its URL does not sit under it —
   * `/training/record-crew` is part of Submit Training, and a member's own
   * program progress is part of My Training. A path from the group's list;
   * the strip marks it and the trail starts from it. Ignored when the viewer
   * cannot open that section.
   */
  section?: string | undefined;
}

interface SectionPageHeaderProps extends PageHeaderProps {
  /** The group's full list; rows the viewer's grants do not open are dropped. */
  sections: SectionNavItem[];
  /** The strip's accessible name, e.g. "Operations sections". */
  stripLabel: string;
  accent?: SectionAccent;
}

/**
 * The header a group of sibling pages shares: the section strip, a trail on
 * any page below a section's own, then the title row in the shape the Training
 * pages use — a red icon beside a 2xl/3xl heading, a muted line under it,
 * actions on the right. `OperationsPageHeader` and `GovernancePageHeader`
 * supply the sections; pages use those, not this.
 *
 * The trail is written in the group's terms, not generated from the URL: the
 * URL says `/inventory/checklists/log`, which reads "Inventory › Equipment
 * Checklists › Log" directly under a strip saying the page is Fleet Readiness.
 * On a section's own page the strip already marks where the viewer is, so
 * there is no trail at all.
 */
export const SectionPageHeader: React.FC<SectionPageHeaderProps> = ({
  sections,
  stripLabel,
  accent = 'red',
  icon: Icon,
  title,
  subtitle,
  actions,
  breadcrumbLabel,
  parentCrumbs,
  underHub,
  section,
}) => {
  const { pathname } = useLocation();
  const checkPermission = useSectionPermission();
  const items = visibleSectionNavItems(sections, checkPermission);
  const active = items.find((item) => item.path === section) ?? activeSection(items, pathname);
  const pageLabel = breadcrumbLabel ?? (typeof title === 'string' ? title : undefined);
  const hub = underHub && canLinkCrumb(underHub, checkPermission) ? BREADCRUMB_ROUTES[underHub] : undefined;
  // The hub crumb stands on its own: an officer who opens the hub but not the
  // section (a storefront manager on Storage Areas) still gets a way back.
  const sectionCrumbs: BreadcrumbItem[] =
    active && !isSectionPage(active, pathname) ? [{ label: active.label, path: active.path }] : [];
  const hubCrumbs: BreadcrumbItem[] = hub && underHub ? [{ label: hub.label ?? 'Administration', path: underHub }] : [];
  // A hub inside the section follows it — Inventory › Inventory
  // Administration. One beside it comes first: Training Administration is
  // where an officer opened Programs from, not a page within Programs.
  const hubInsideSection = Boolean(active && underHub?.startsWith(`${active.path}/`));
  const leading = hubInsideSection ? [...sectionCrumbs, ...hubCrumbs] : [...hubCrumbs, ...sectionCrumbs];
  const trail: BreadcrumbItem[] =
    leading.length > 0 ? [...leading, ...(parentCrumbs ?? []), ...(pageLabel ? [{ label: pageLabel }] : [])] : [];

  return (
    <div>
      <SectionNav items={items} active={active} label={stripLabel} accent={accent} />
      {trail.length > 0 && <Breadcrumbs items={trail} />}
      <div className="page-header mb-8 gap-4 sm:items-center">
        <div className="page-header-title">
          <h1 className="text-theme-text-primary flex items-center space-x-3 text-2xl font-bold sm:text-3xl">
            <Icon className="h-8 w-8 shrink-0 text-red-700 dark:text-red-500" aria-hidden="true" />
            <span className="min-w-0">{title}</span>
          </h1>
          {subtitle && <div className="text-theme-text-muted mt-2">{subtitle}</div>}
        </div>
        {actions && (
          <div className="page-header-actions flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
        )}
      </div>
    </div>
  );
};

export default SectionPageHeader;
