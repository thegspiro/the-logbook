/**
 * Breadcrumbs Navigation Component (#7)
 *
 * Provides hierarchical navigation context for deeply nested pages.
 * Auto-generates breadcrumbs from the current URL path with custom overrides.
 *
 * A generated crumb is a LINK only when `breadcrumbRoutes.ts` says the path is
 * a real route and the viewer's permissions open it; otherwise it renders as
 * plain text. See that file for why both halves are necessary — in short, an
 * accumulated URL prefix is frequently neither. Explicit `items` skip that
 * check: a caller passing items has resolved its own trail, as
 * `TrainingProgramsPage` does when it drops the Admin crumb for a member who
 * cannot open the hub.
 */

import React from 'react';
import { Link, useLocation } from 'react-router';
import { ChevronRight, Home } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { BREADCRUMB_ROUTES, canLinkCrumb } from './breadcrumbRoutes';

export interface BreadcrumbItem {
  label: string;
  path?: string | undefined;
  onClick?: (() => void) | undefined;
  ariaLabel?: string | undefined;
}

interface BreadcrumbsProps {
  /**
   * `| undefined` on purpose: under `exactOptionalPropertyTypes` a caller
   * holding an optional trail — `AdminHubFrame`, which generates one when it
   * has none — cannot forward it to a bare `items?:` without a cast.
   */
  items?: BreadcrumbItem[] | undefined;
  className?: string;
  /**
   * End the generated trail at the parent, dropping the crumb for the page you
   * are on.
   *
   * For a page whose own heading already names it in larger type directly
   * below. `AdminHubFrame` is the case: its header reads eyebrow
   * "Administration", then an `<h1>` of "Inventory Administration" — a crumb
   * saying "Inventory Administration" immediately above that is a third
   * near-identical line, and a screen reader announces the name twice.
   *
   * Generated trails only. A caller passing `items` has written the crumbs it
   * wants shown, and silently deleting the last of them would be a different
   * thing entirely.
   */
  omitCurrentPage?: boolean;
}

const PATH_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  events: 'Events',
  members: 'Members',
  training: 'Training',
  inventory: 'Inventory',
  store: 'Department Store',
  scheduling: 'Scheduling',
  facilities: 'Facilities',
  elections: 'Elections',
  minutes: 'Minutes',
  notifications: 'Notifications',
  messages: 'Messages',
  documents: 'Documents',
  settings: 'Settings',
  reports: 'Reports',
  forms: 'Forms',
  admin: 'Admin',
  account: 'My Account',
  setup: 'Setup',
  integrations: 'Integrations',
  roles: 'Roles',

  // Actions & generic segments
  edit: 'Edit',
  new: 'Create',
  add: 'Add',
  import: 'Import',
  submit: 'Submit',
  active: 'Active',
  manage: 'Manage',
  test: 'Test',

  // Training module
  'my-training': 'My Training',
  courses: 'Course Library',
  programs: 'Programs',
  'skills-testing': 'Skills Testing',
  'compliance-config': 'Compliance Config',
  templates: 'Templates',

  // Events module
  'qr-code': 'QR Code',
  'check-in': 'Check In',
  monitoring: 'Monitoring',
  analytics: 'Analytics',

  // Inventory module
  'my-equipment': 'My Issued Gear',
  checkouts: 'Checkouts',
  items: 'Items',
  'storage-areas': 'Storage Areas',
  'variant-groups': 'Variant Groups',
  'write-offs': 'Write-Offs',
  reorder: 'Reorder',
  kits: 'Kits',
  pool: 'Pool',
  charges: 'Charges',
  returns: 'Returns',
  requests: 'Requests',
  maintenance: 'Maintenance',
  categories: 'Categories',
  'print-labels': 'Print Labels',

  // Finance module
  finance: 'Finance',
  budgets: 'Budgets',
  expenses: 'Expenses',
  'check-requests': 'Check Requests',
  'purchase-requests': 'Purchase Requests',
  dues: 'Dues',
  'approval-chains': 'Approval Chains',

  // Scheduling module
  patterns: 'Patterns',

  // Equipment checklists (Inventory). The segments are shared with the rest of
  // Inventory, so these are deliberately generic: /inventory/checklists,
  // /inventory/admin/checklists/templates/:id, .../reports, .../supply.
  checklists: 'Equipment Checklists',
  'apparatus-inventory': 'Apparatus Inventory',
  supply: 'Supply',

  // Other modules
  'action-items': 'Action Items',
  apparatus: 'Apparatus',
  'apparatus-basic': 'Apparatus',
  locations: 'Locations',
  inspections: 'Inspections',
  grants: 'Grants',
  applications: 'Applications',
  opportunities: 'Opportunities',
  campaigns: 'Campaigns',
  donors: 'Donors',
  donations: 'Donations',
  'prospective-members': 'Prospective Members',
  interview: 'Interview',
  'admin-hours': 'Admin Hours',
  'medical-screening': 'Medical Screening',
  'email-templates': 'Email Templates',
  communications: 'Communications',
  'ip-security': 'IP Security',
  'my-requests': 'My Requests',
  'public-portal': 'Public Portal',
  'platform-analytics': 'Platform Analytics',
  errors: 'Error Monitor',
  waivers: 'Waivers',
  scan: 'Scan Member ID',
  history: 'History',
  'id-card': 'ID Card',
};

const titleCase = (segment: string): string =>
  segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/**
 * Denies every permission, and so links no crumb.
 *
 * Used when the store hands back no `checkPermission` — which the type says
 * cannot happen and which a partially-mocked store does constantly: eighteen
 * suites stub `useAuthStore` with only the slice they need. A breadcrumb trail
 * is an ornament on a page, so it must never be the reason that page fails to
 * render; a missing predicate costs the trail its links, not the screen.
 * Denying is also the direction the registry already fails in.
 */
const DENY_ALL = (): boolean => false;

interface GeneratedTrail {
  crumbs: BreadcrumbItem[];
  /**
   * Whether the last crumb is the page being viewed.
   *
   * False when the URL ends in a record id, because that id is skipped for
   * display and the crumb before it is the collection the record belongs to —
   * `Applications` on `/grants/applications/:id`, not the grant. Treating it as
   * the current page took away a working link to the list and announced a page
   * the viewer is not on.
   */
  endsAtCurrentPage: boolean;
}

function generateBreadcrumbs(pathname: string, checkPermission?: (permission: string) => boolean): GeneratedTrail {
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: BreadcrumbItem[] = [];
  const canCheck = checkPermission ?? DENY_ALL;

  let currentPath = '';
  let endsAtCurrentPage = false;
  for (const segment of segments) {
    currentPath += '/' + segment;

    // Skip UUID-like segments for display but keep them in the path
    if (!segment) continue;
    const isId = /^[0-9a-f]{8}-|^\d+$/.test(segment);
    if (isId) {
      // Add an "ID" breadcrumb or skip it
      endsAtCurrentPage = false;
      continue;
    }
    endsAtCurrentPage = true;

    const route = BREADCRUMB_ROUTES[currentPath];

    crumbs.push({
      label: route?.label ?? PATH_LABELS[segment] ?? titleCase(segment),
      path: canLinkCrumb(currentPath, canCheck) ? currentPath : undefined,
    });
  }

  // Only strip the link when the URL's final segment is what produced this
  // crumb. Deriving "current" from `i === segments.length - 1` inside the loop
  // was wrong on `/members/admin/edit/:userId`, where the id is skipped and no
  // crumb was marked at all; stripping it unconditionally is wrong in the other
  // direction, on `/grants/applications/:id`, where the last crumb is the list
  // the record came from and its link is the only way back to it.
  if (endsAtCurrentPage) {
    const last = crumbs[crumbs.length - 1];
    if (last) last.path = undefined;
  }

  return { crumbs, endsAtCurrentPage };
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items, className = '', omitCurrentPage = false }) => {
  const location = useLocation();
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const generated = generateBreadcrumbs(location.pathname, checkPermission);

  // Trimmed only when the trail was generated — see the prop.
  const trimmed = omitCurrentPage && !items;
  const base = items ?? generated.crumbs;
  const crumbs = trimmed ? base.slice(0, -1) : base;

  // Which crumb, if any, is the page being viewed. Explicit items keep the old
  // contract — the caller's last crumb is the page. A generated trail has one
  // only when the URL's final segment named it, and a trimmed trail has dropped
  // it on purpose. Nothing claims aria-current in the other two cases, because
  // in both the last crumb is an ancestor the viewer can still travel to.
  const currentIndex = items ? crumbs.length - 1 : trimmed || !generated.endsAtCurrentPage ? -1 : crumbs.length - 1;

  if (crumbs.length === 0) return null;
  // A single AUTO-generated crumb is suppressed: on a top-level route like
  // /members the trail would restate the page's own <h1> and nothing else.
  // Explicit items are always rendered, single or not — a caller that passes
  // items has decided this page needs a visible path back up, and dropping it
  // silently is what left the member inbox with no route home but the
  // dashboard.
  //
  // A TRIMMED trail is exempt: its one remaining crumb is the parent, not a
  // restatement of the page. Suppressing it would leave an administration hub
  // with no route up at all, which is the gap this trail was added to close.
  if (!items && !trimmed && crumbs.length === 1) return null;

  // Crumb links grow to the 44px touch minimum below md — a bare text link is
  // ~20px tall and the Home icon 16px square, both under it. Grown with
  // min-width/min-height rather than the padding + negative-margin trick
  // form-checkbox uses: crumbs sit a few pixels apart, so padded hit areas
  // would overlap and a tap near a chevron would open the neighbouring crumb.
  return (
    <nav aria-label="Breadcrumb" className={`mb-4 ${className}`}>
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        <li className="flex items-center">
          <Link
            to="/dashboard"
            className="text-theme-text-muted hover:text-theme-text-primary inline-flex items-center justify-center transition-all duration-150 hover:scale-110 max-md:min-h-[44px] max-md:min-w-[44px]"
            aria-label="Home"
          >
            <Home className="h-4 w-4" />
          </Link>
        </li>
        {crumbs.map((crumb, index) => (
          <li key={index} className="flex items-center">
            <ChevronRight className="text-theme-text-muted mx-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {crumb.onClick ? (
              <button
                type="button"
                onClick={crumb.onClick}
                aria-label={crumb.ariaLabel}
                className="text-theme-text-muted hover:text-theme-text-primary inline-flex items-center justify-center underline-offset-2 transition-colors duration-150 hover:underline max-md:min-h-[44px] max-md:min-w-[44px]"
              >
                {crumb.label}
              </button>
            ) : index === currentIndex ? (
              // The page you are on, resolved above rather than inferred from
              // "this crumb has no link". A middle crumb can lack one too — its
              // path is not a route, or not one this viewer may open — and
              // treating that as "you are here" announced two ends to the trail.
              //
              // Ordered after onClick so a handler a caller attached still
              // fires, whichever crumb carries it. Documents builds its folder
              // trail that way and gives the open folder no handler, so in
              // practice the current crumb reaches this branch.
              <span className="text-theme-text-primary font-semibold" aria-current="page">
                {crumb.label}
              </span>
            ) : crumb.path ? (
              <Link
                to={crumb.path}
                className="text-theme-text-muted hover:text-theme-text-primary inline-flex items-center justify-center underline-offset-2 transition-colors duration-150 hover:underline max-md:min-h-[44px] max-md:min-w-[44px]"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="text-theme-text-muted inline-flex items-center justify-center max-md:min-h-[44px]">
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
};
