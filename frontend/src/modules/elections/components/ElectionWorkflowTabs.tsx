/**
 * Election Workflow Tabs
 *
 * The section links in an election's header: Overview, then every section
 * this viewer may open. Links, not ARIA tabs: each section is its own route
 * (`electionSectionPath`), so the row is a `<nav>` marking the open one with
 * `aria-current="page"`, and a section can be bookmarked, shared, refreshed
 * into and reached with the Back button. Which sections show is decided by
 * `visibleElectionSections`, which the page also uses to refuse a section
 * this viewer may not open.
 */

import React, { useId } from 'react';
import { Link } from 'react-router';
import { LayoutDashboard } from 'lucide-react';
import type { Election } from '../../../types/election';
import { ScrollCueRow } from '../../../components/ux/ScrollCueRow';
import { electionSectionPath, visibleElectionSections, type ElectionSection } from '../electionSections';

interface ElectionWorkflowTabsProps {
  electionId: string;
  election: Election;
  canManage: boolean;
  /** The open section; null is the Overview. */
  activeSection: ElectionSection | null;
  candidateCount?: number | undefined;
}

export const ElectionWorkflowTabs: React.FC<ElectionWorkflowTabsProps> = ({
  electionId,
  election,
  canManage,
  activeSection,
  candidateCount,
}) => {
  const labelId = useId();
  const items = [
    { id: null, label: 'Overview', icon: LayoutDashboard, badge: undefined },
    ...visibleElectionSections(election, canManage, candidateCount),
  ];

  return (
    <nav aria-labelledby={labelId} className="border-theme-surface-border border-t">
      {/* One name for the landmark and its scrolling row, as SectionNav does:
          the mobile sweep wants a scroll region labelled, and pointing both at
          one heading names it without saying it twice. */}
      <span id={labelId} className="sr-only">
        Election sections
      </span>
      <ScrollCueRow
        className="flex gap-1 px-2"
        revealKey={activeSection ?? 'overview'}
        aria-labelledby={labelId}
        data-mobile-scroll-region
      >
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeSection;
          return (
            <Link
              key={item.id ?? 'overview'}
              to={electionSectionPath(electionId, item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`focus:ring-theme-focus-ring touch:min-h-11 -mb-px flex items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors focus:ring-2 focus:outline-hidden focus:ring-inset ${
                isActive
                  ? 'text-theme-text-primary border-red-800'
                  : 'text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border border-transparent'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {item.label}
              {item.badge != null && item.badge > 0 && (
                <span className="bg-theme-surface-secondary text-theme-text-muted ml-1 rounded-full px-1.5 py-0.5 text-xs">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </ScrollCueRow>
    </nav>
  );
};

export default ElectionWorkflowTabs;
