/**
 * Election Summary Cards
 *
 * Dashboard-style summary cards for the elections list page.
 * Shows at-a-glance metrics: active elections, pending actions,
 * total votes cast, and upcoming elections that need attention.
 */

import React from 'react';
import { Vote, Clock, FileCheck, AlertTriangle } from 'lucide-react';
import type { ElectionListItem } from '../../../types/election';
import { ElectionStatus } from '../../../constants/enums';
import { getTimeRemaining } from '../../../utils/electionHelpers';

interface ElectionSummaryCardsProps {
  elections: ElectionListItem[];
}

export const ElectionSummaryCards: React.FC<ElectionSummaryCardsProps> = ({ elections }) => {
  const openElections = elections.filter((e) => e.status === ElectionStatus.OPEN);
  const draftElections = elections.filter((e) => e.status === ElectionStatus.DRAFT);
  const closedElections = elections.filter((e) => e.status === ElectionStatus.CLOSED);

  const totalVotes = elections.reduce((sum, e) => sum + (e.total_votes ?? 0), 0);

  // Elections that are open but time has expired (need secretary attention)
  const expiredOpenElections = openElections.filter((e) => !getTimeRemaining(e.end_date));

  const needsAttention = draftElections.length + expiredOpenElections.length;

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {/* Active elections */}
      <div className="bg-theme-surface rounded-lg p-4 shadow-sm backdrop-blur-xs">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-green-500/10 p-2">
            <Vote className="h-5 w-5 text-green-700 dark:text-green-400" />
          </div>
          <div>
            <div className="text-theme-text-primary text-2xl font-bold">{openElections.length}</div>
            <div className="text-theme-text-muted text-xs font-medium">Active Elections</div>
          </div>
        </div>
      </div>

      {/* Needs attention */}
      <div
        className={`bg-theme-surface rounded-lg p-4 shadow-sm backdrop-blur-xs ${
          needsAttention > 0 ? 'ring-2 ring-amber-500/30' : ''
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`rounded-lg p-2 ${needsAttention > 0 ? 'bg-amber-500/10' : 'bg-theme-surface-secondary'}`}>
            <AlertTriangle
              className={`h-5 w-5 ${
                needsAttention > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-theme-text-muted'
              }`}
            />
          </div>
          <div>
            <div className="text-theme-text-primary text-2xl font-bold">{needsAttention}</div>
            <div className="text-theme-text-muted text-xs font-medium">Need Attention</div>
          </div>
        </div>
        {needsAttention > 0 && (
          <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            {draftElections.length > 0 && <span>{draftElections.length} draft(s) to finalize</span>}
            {draftElections.length > 0 && expiredOpenElections.length > 0 && <span> · </span>}
            {expiredOpenElections.length > 0 && <span>{expiredOpenElections.length} expired to close</span>}
          </div>
        )}
      </div>

      {/* Completed */}
      <div className="bg-theme-surface rounded-lg p-4 shadow-sm backdrop-blur-xs">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-blue-500/10 p-2">
            <FileCheck className="h-5 w-5 text-blue-700 dark:text-blue-400" />
          </div>
          <div>
            <div className="text-theme-text-primary text-2xl font-bold">{closedElections.length}</div>
            <div className="text-theme-text-muted text-xs font-medium">Completed</div>
          </div>
        </div>
      </div>

      {/* Total votes */}
      <div className="bg-theme-surface rounded-lg p-4 shadow-sm backdrop-blur-xs">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-purple-500/10 p-2">
            <Clock className="h-5 w-5 text-purple-700 dark:text-purple-400" />
          </div>
          <div>
            <div className="text-theme-text-primary text-2xl font-bold">{totalVotes}</div>
            <div className="text-theme-text-muted text-xs font-medium">Total Votes Cast</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ElectionSummaryCards;
