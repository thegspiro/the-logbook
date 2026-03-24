/**
 * Breadcrumbs Navigation Component (#7)
 *
 * Provides hierarchical navigation context for deeply nested pages.
 * Auto-generates breadcrumbs from the current URL path with custom overrides.
 */

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  path?: string | undefined;
}

interface BreadcrumbsProps {
  items?: BreadcrumbItem[];
  className?: string;
}

const PATH_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  events: 'Events',
  members: 'Members',
  training: 'Training',
  inventory: 'Inventory',
  scheduling: 'Scheduling',
  facilities: 'Facilities',
  elections: 'Elections',
  minutes: 'Minutes',
  notifications: 'Notifications',
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
  'my-equipment': 'My Equipment',
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
  'equipment-check-templates': 'Equipment Check Templates',
  'equipment-check-reports': 'Equipment Check Reports',

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

function generateBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: BreadcrumbItem[] = [];

  let currentPath = '';
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    currentPath += '/' + segment;

    // Skip UUID-like segments for display but keep them in the path
    if (!segment) continue;
    const isId = /^[0-9a-f]{8}-|^\d+$/.test(segment);
    if (isId) {
      // Add an "ID" breadcrumb or skip it
      continue;
    }

    const label = PATH_LABELS[segment] || segment.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const isLast = i === segments.length - 1;

    crumbs.push({
      label,
      path: isLast ? undefined : currentPath,
    });
  }

  return crumbs;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items, className = '' }) => {
  const location = useLocation();
  const crumbs = items || generateBreadcrumbs(location.pathname);

  if (crumbs.length <= 1) return null;

  return (
    <nav aria-label="Breadcrumb" className={`mb-4 ${className}`}>
      <ol className="flex items-center flex-wrap gap-1 text-sm">
        <li className="flex items-center">
          <Link
            to="/dashboard"
            className="text-theme-text-muted hover:text-theme-text-primary transition-all duration-150 hover:scale-110"
            aria-label="Home"
          >
            <Home className="w-4 h-4" />
          </Link>
        </li>
        {crumbs.map((crumb, index) => (
          <li key={index} className="flex items-center">
            <ChevronRight className="w-3.5 h-3.5 text-theme-text-muted mx-1 shrink-0" aria-hidden="true" />
            {crumb.path ? (
              <Link
                to={crumb.path}
                className="text-theme-text-muted hover:text-theme-text-primary transition-colors duration-150 hover:underline underline-offset-2"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="text-theme-text-primary font-semibold" aria-current="page">
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
};
