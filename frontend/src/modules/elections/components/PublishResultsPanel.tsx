/**
 * Publish Results Panel
 *
 * Streamlined secretary interface for publishing election results.
 * Provides clear visual feedback about result availability (closing the
 * election releases them) and the ability to email the results report to
 * the election secretary.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Send, BarChart3, CheckCircle2, AlertCircle, Loader2, Mail } from 'lucide-react';
import { electionService } from '../../../services/api';
import type { Election } from '../../../types/election';
import { ElectionStatus } from '../../../constants/enums';
import { getErrorMessage } from '../../../utils/errorHandling';
interface PublishResultsPanelProps {
  electionId: string;
  election: Election;
}

export const PublishResultsPanel: React.FC<PublishResultsPanelProps> = ({ electionId, election }) => {
  const [sendingReport, setSendingReport] = useState(false);

  const isClosed = election.status === ElectionStatus.CLOSED;
  const resultsPublished = election.results_visible_immediately;
  const hasVotes = (election.total_votes ?? 0) > 0;

  const handleSendReport = async () => {
    try {
      setSendingReport(true);
      await electionService.sendReport(electionId);
      toast.success('Results report sent');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to send results report'));
    } finally {
      setSendingReport(false);
    }
  };

  // Only show for open or closed elections
  if (election.status === ElectionStatus.DRAFT || election.status === ElectionStatus.CANCELLED) {
    return null;
  }

  return (
    <div className="bg-theme-surface mb-6 overflow-hidden rounded-lg shadow-sm backdrop-blur-xs">
      <div className="border-theme-surface-border border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="text-theme-text-muted h-5 w-5" />
          <h3 className="text-theme-text-primary text-lg font-semibold">Results & Publishing</h3>
        </div>
      </div>

      <div className="space-y-4 p-6">
        {/* Status overview */}
        <div
          className={`flex items-start gap-3 rounded-lg border-2 p-4 ${
            isClosed ? 'border-green-500/30 bg-green-500/5' : 'border-blue-500/30 bg-blue-500/5'
          }`}
        >
          {isClosed ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
          ) : (
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
          )}
          <div>
            <p className="text-theme-text-primary text-sm font-medium">
              {isClosed ? 'Election is closed — results are finalized' : 'Election is still open — results may change'}
            </p>
            <p className="text-theme-text-muted mt-1 text-xs">
              {hasVotes ? `${election.total_votes} vote(s) cast` : 'No votes cast yet'}
              {election.voter_turnout_percentage != null
                ? ` · ${election.voter_turnout_percentage.toFixed(1)}% turnout`
                : ''}
            </p>
          </div>
        </div>

        {/* Visibility. Closing is what releases results (W50-10, W50-22):
            a CLOSED election's tally is readable by every member who can
            view elections, whether it closed early or at the scheduled end,
            so there is no publish switch left to offer. While voting is open
            the backend refuses to reveal a live tally; one can only be
            configured before opening, on the election form. */}
        <div className="bg-theme-surface-secondary flex items-center gap-3 rounded-lg p-4">
          {isClosed || resultsPublished ? (
            <Eye className="h-5 w-5 text-green-600 dark:text-green-400" />
          ) : (
            <EyeOff className="text-theme-text-muted h-5 w-5" />
          )}
          <div>
            <p className="text-theme-text-primary text-sm font-medium">
              {isClosed
                ? 'Results are visible to members'
                : resultsPublished
                  ? 'Live results are visible to members'
                  : 'Results are hidden while voting is open'}
            </p>
            <p className="text-theme-text-muted text-xs">
              {isClosed
                ? 'Closing the election released them, early or at the scheduled end alike.'
                : resultsPublished
                  ? 'This election was set to show results immediately before it opened.'
                  : 'They appear for every member who can view elections as soon as voting closes.'}
            </p>
          </div>
        </div>

        {/* Email report (only when closed) */}
        {isClosed && (
          <div className="bg-theme-surface-secondary flex flex-wrap items-center justify-between gap-3 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <Mail className="text-theme-text-muted h-5 w-5" />
              <div>
                <p className="text-theme-text-primary text-sm font-medium">Email Results Report</p>
                <p className="text-theme-text-muted text-xs">Email the results report to the election secretary</p>
              </div>
            </div>
            <button
              onClick={() => void handleSendReport()}
              disabled={sendingReport}
              className="rounded-md bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900 disabled:opacity-50"
            >
              {sendingReport ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="flex items-center gap-1.5">
                  <Send className="h-3.5 w-3.5" />
                  Send Report
                </span>
              )}
            </button>
          </div>
        )}

        {/* Quick stats grid */}
        {hasVotes && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
              <div className="text-theme-text-primary text-xl font-bold">{election.total_votes ?? 0}</div>
              <div className="text-theme-text-muted text-xs">Total Votes</div>
            </div>
            <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
              <div className="text-theme-text-primary text-xl font-bold">{election.total_voters ?? 0}</div>
              <div className="text-theme-text-muted text-xs">Unique Voters</div>
            </div>
            <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
              <div className="text-theme-text-primary text-xl font-bold">
                {election.voter_turnout_percentage != null ? `${election.voter_turnout_percentage.toFixed(0)}%` : '—'}
              </div>
              <div className="text-theme-text-muted text-xs">Turnout</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PublishResultsPanel;
