/**
 * The Elections area's own pages — the list, Meeting Attendance and Settings —
 * as one row of links under each page's title.
 *
 * Settings and attendance used to be buttons in the list's header, the first a
 * bare gear icon that officers overlooked; as links in a row each is named,
 * reachable from the others, and marked when open. Only a manager sees the
 * row: a member's one Elections page is the list, and the other two are
 * `elections.manage` routes.
 */

import React, { useId } from 'react';
import { Link, useLocation } from 'react-router';
import { ClipboardCheck, List, Settings } from 'lucide-react';
import { useAuthStore } from '../../../stores/authStore';
import { ScrollCueRow } from '../../../components/ux/ScrollCueRow';

// A phone shows the short labels and no icons: the full ones scrolled
// Settings — the page this row exists to surface — off a 390px screen.
const PAGES = [
  { path: '/elections', label: 'All Elections', short: 'Elections', icon: List },
  { path: '/elections/attendance', label: 'Meeting Attendance', short: 'Attendance', icon: ClipboardCheck },
  { path: '/elections/settings', label: 'Settings', short: 'Settings', icon: Settings },
] as const;

export const ElectionsAreaNav: React.FC = () => {
  const labelId = useId();
  const { pathname } = useLocation();
  const { checkPermission } = useAuthStore();
  if (!checkPermission('elections.manage')) return null;

  const current = pathname.replace(/\/+$/, '') || '/';

  return (
    <nav aria-labelledby={labelId} className="card mb-6 overflow-hidden">
      <span id={labelId} className="sr-only">
        Elections pages
      </span>
      <ScrollCueRow className="flex gap-1 px-2" revealKey={current} aria-labelledby={labelId} data-mobile-scroll-region>
        {PAGES.map((page) => {
          const Icon = page.icon;
          const isActive = current === page.path;
          return (
            <Link
              key={page.path}
              to={page.path}
              aria-current={isActive ? 'page' : undefined}
              // The full name on every width; the phone's short label is a
              // word of it, so what is seen is still what is said.
              aria-label={page.label}
              className={`focus:ring-theme-focus-ring touch:min-h-11 -mb-px flex flex-1 items-center justify-center gap-2 border-b-2 px-2 py-3 text-sm font-medium whitespace-nowrap transition-colors focus:ring-2 focus:outline-hidden focus:ring-inset sm:flex-none sm:px-3 ${
                isActive
                  ? 'text-theme-text-primary border-red-800'
                  : 'text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border border-transparent'
              }`}
            >
              <Icon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />
              <span className="sm:hidden">{page.short}</span>
              <span className="hidden sm:inline">{page.label}</span>
            </Link>
          );
        })}
      </ScrollCueRow>
    </nav>
  );
};

export default ElectionsAreaNav;
