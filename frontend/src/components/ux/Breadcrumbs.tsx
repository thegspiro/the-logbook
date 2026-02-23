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
  path?: string;
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
  'action-items': 'Action Items',
  'my-training': 'My Training',
  'my-equipment': 'My Equipment',
  submit: 'Submit',
  courses: 'Course Library',
  programs: 'Programs',
  account: 'My Account',
  checkouts: 'Checkouts',
  edit: 'Edit',
  new: 'Create',
  'qr-code': 'QR Code',
  'check-in': 'Check In',
  monitoring: 'Monitoring',
  import: 'Import',
  add: 'Add',
  roles: 'Roles',
  setup: 'Setup',
  integrations: 'Integrations',
};

function generateBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: BreadcrumbItem[] = [];

  let currentPath = '';
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    currentPath += '/' + segment;

    // Skip UUID-like segments for display but keep them in the path
    const isId = /^[0-9a-f]{8}-|^\d+$/.test(segment);
    if (isId) {
      // Add an "ID" breadcrumb or skip it
      continue;
    }

    const label = PATH_LABELS[segment] || segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
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
            className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
            aria-label="Home"
          >
            <Home className="w-4 h-4" />
          </Link>
        </li>
        {crumbs.map((crumb, index) => (
          <li key={index} className="flex items-center">
            <ChevronRight className="w-3.5 h-3.5 text-theme-text-muted mx-1 flex-shrink-0" aria-hidden="true" />
            {crumb.path ? (
              <Link
                to={crumb.path}
                className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="text-theme-text-primary font-medium" aria-current="page">
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
};
