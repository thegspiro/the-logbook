/**
 * Publish Results Panel
 *
 * Streamlined secretary interface for publishing election results.
 * Provides clear visual feedback about result availability, a one-click
 * publish toggle, and the ability to send result report emails to
 * leadership or all members.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Send, BarChart3, CheckCircle2, AlertCircle, Loader2, Mail, Lock } from 'lucide-react';
import { electionService } from '../../../services/api';
import type { Election } from '../../../types/election';
import { ElectionStatus } from '../../../constants/enums';
import { getErrorMessage } from '../../../utils/errorHandling';
interface PublishResultsPanelProps {
  electionId: string;
  election: Election;
  onUpdate: (election: Election) => void;
}

export const PublishResultsPanel: React.FC<PublishResultsPanelProps> = ({ electionId, election, onUpdate }) => {
  const [updatingVisibility, setUpdatingVisibility] = useState(false);
  const [sendingReport, setSendingReport] = useState(false);

  const isClosed = election.status === ElectionStatus.CLOSED;
  const resultsPublished = election.results_visible_immediately;
  const hasVotes = (election.total_votes ?? 0) > 0;

  const handleToggleVisibility = async () => {
    try {
      setUpdatingVisibility(true);
      const updated = await electionService.updateElection(electionId, {
        results_visible_immediately: !resultsPublished,
      });
      onUpdate(updated);
      toast.success(resultsPublished ? 'Results are now hidden from voters' : 'Results are now visible to all voters');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update result visibility'));
    } finally {
      setUpdatingVisibility(false);
    }
  };

  const handleSendReport = async () => {
    try {
      setSendingReport(true);
      await electionService.sendReport(electionId);
      toast.success('Results report sent successfully');
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

        {/* Visibility toggle */}
        <div className="bg-theme-surface-secondary flex items-center justify-between rounded-lg p-4">
          <div className="flex items-center gap-3">
            {resultsPublished ? (
              <Eye className="h-5 w-5 text-green-600 dark:text-green-400" />
            ) : (
              <EyeOff className="text-theme-text-muted h-5 w-5" />
            )}
            <div>
              <p className="text-theme-text-primary text-sm font-medium">
                {resultsPublished ? 'Results are visible to all voters' : 'Results are hidden'}
              </p>
              <p className="text-theme-text-muted text-xs">
                {resultsPublished
                  ? 'Any member can view current results on the election page'
                  : 'Only administrators can see results until published'}
              </p>
            </div>
          </div>
          <button
            onClick={() => void handleToggleVisibility()}
            disabled={updatingVisibility}
            aria-pressed={resultsPublished}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              resultsPublished
                ? 'bg-theme-surface text-theme-text-primary border-theme-surface-border hover:bg-theme-surface-hover border'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {updatingVisibility ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : resultsPublished ? (
              <span className="flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" />
                Hide Results
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5" />
                Publish Results
              </span>
            )}
          </button>
        </div>

        {/* Email report (only when closed) */}
        {isClosed && (
          <div className="bg-theme-surface-secondary flex items-center justify-between rounded-lg p-4">
            <div className="flex items-center gap-3">
              <Mail className="text-theme-text-muted h-5 w-5" />
              <div>
                <p className="text-theme-text-primary text-sm font-medium">Email Results Report</p>
                <p className="text-theme-text-muted text-xs">Send final results to all eligible voters by email</p>
              </div>
            </div>
            <button
              onClick={() => void handleSendReport()}
              disabled={sendingReport}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
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
