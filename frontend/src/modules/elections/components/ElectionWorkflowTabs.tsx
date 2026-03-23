/**
 * Election Workflow Tabs
 *
 * Organizes the ElectionDetailPage secretary controls into a tabbed
 * interface so the secretary can focus on one task at a time instead
 * of scrolling through a monolithic page.
 *
 * Tabs adapt based on election status — e.g., "Ballot" tab only shows
 * in draft, "Results" tab only shows when results are available.
 */

import React, { useMemo } from 'react';
import {
  ClipboardList,
  Users,
  Vote,
  BarChart3,
  Shield,
  UserCheck,
  Handshake,
  FileText,
} from 'lucide-react';
import type { Election } from '../../../types/election';
import { ElectionStatus } from '../../../constants/enums';

interface Tab {
  id: string;
  label: string;
  icon: React.ElementType;
  badge?: number;
  show: boolean;
}

interface ElectionWorkflowTabsProps {
  election: Election;
  canManage: boolean;
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export const ElectionWorkflowTabs: React.FC<ElectionWorkflowTabsProps> = ({
  election,
  canManage,
  activeTab,
  onTabChange,
}) => {
  const tabs = useMemo((): Tab[] => {
    const isDraft = election.status === ElectionStatus.DRAFT;
    const isOpen = election.status === ElectionStatus.OPEN;
    const isClosed = election.status === ElectionStatus.CLOSED;
    const isCancelled = election.status === ElectionStatus.CANCELLED;
    const resultsAvailable = isClosed || election.results_visible_immediately;
    const ballotItemCount = election.ballot_items?.length ?? 0;

    return [
      {
        id: 'ballot',
        label: 'Ballot',
        icon: ClipboardList,
        badge: ballotItemCount,
        show: canManage && !isCancelled,
      },
      {
        id: 'candidates',
        label: 'Candidates',
        icon: Users,
        show: canManage,
      },
      {
        id: 'eligibility',
        label: 'Eligibility',
        icon: UserCheck,
        show: canManage && !isCancelled,
      },
      {
        id: 'attendance',
        label: 'Attendance',
        icon: FileText,
        show: canManage && !isCancelled && (isDraft || isOpen),
      },
      {
        id: 'overrides',
        label: 'Overrides',
        icon: Shield,
        show: canManage && !isCancelled,
      },
      {
        id: 'proxies',
        label: 'Proxy Voting',
        icon: Handshake,
        show: canManage && !isCancelled,
      },
      {
        id: 'voting',
        label: 'Cast Vote',
        icon: Vote,
        show: isOpen,
      },
      {
        id: 'results',
        label: 'Results',
        icon: BarChart3,
        show: resultsAvailable,
      },
    ].filter((t) => t.show);
  }, [election, canManage]);

  // Auto-select first visible tab if active tab is hidden
  const validActiveTab = tabs.find((t) => t.id === activeTab) ? activeTab : (tabs[0]?.id ?? 'ballot');

  return (
    <div className="mb-6">
      <nav
        className="flex gap-1 overflow-x-auto pb-1 border-b border-theme-surface-border"
        role="tablist"
        aria-label="Election management sections"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = validActiveTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                isActive
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text-secondary hover:border-theme-surface-border'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              {tab.badge != null && tab.badge > 0 && (
                <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                  isActive
                    ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400'
                    : 'bg-theme-surface-secondary text-theme-text-muted'
                }`}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default ElectionWorkflowTabs;
