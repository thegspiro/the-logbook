/**
 * Election Results Component
 *
 * Displays election results in a simple, anonymous manner.
 * Shows summary statistics, quorum status, and per-position/overall
 * candidate results with visual progress bars.
 */

import React, { useEffect, useState } from 'react';
import { electionService } from '../services/api';
import type { ElectionResults as ElectionResultsType, CandidateResult, Election } from '../types/election';
import { getErrorMessage } from '../utils/errorHandling';
import { getVictoryDescription } from '../utils/electionHelpers';

interface ElectionResultsProps {
  electionId: string;
  election: Election;
}

/** Renders a single candidate's result row with vote count, percentage, and progress bar. */
const CandidateResultCard: React.FC<{ candidate: CandidateResult }> = ({ candidate }) => (
  <div
    className={`p-4 rounded-lg border-2 ${
      candidate.is_winner
        ? 'border-green-500 bg-green-500/10'
        : 'border-theme-surface-border bg-theme-surface-secondary'
    }`}
    aria-label={`${candidate.candidate_name}: ${candidate.vote_count} votes, ${candidate.percentage}%${candidate.is_winner ? ', winner' : ''}`}
  >
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center space-x-3">
        {candidate.is_winner && (
          <svg
            className="h-6 w-6 text-green-700 dark:text-green-400"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
        )}
        <div>
          <div className="font-medium text-theme-text-primary">
            {candidate.candidate_name}
          </div>
          {candidate.is_winner && (
            <div className="text-sm text-green-700 dark:text-green-400 font-medium">Winner</div>
          )}
        </div>
      </div>

      <div className="flex items-center space-x-4">
        <div className="text-right">
          <span className="text-lg font-semibold text-theme-text-primary">
            {candidate.vote_count}
          </span>
          <span className="text-sm text-theme-text-muted ml-1">
            {candidate.vote_count === 1 ? 'vote' : 'votes'}
          </span>
        </div>
        <div className="text-right">
          <span className="text-lg font-bold text-theme-text-primary">
            {candidate.percentage}%
          </span>
        </div>
      </div>
    </div>
    {/* Vote percentage progress bar */}
    <div className="w-full bg-theme-surface rounded-full h-2.5 overflow-hidden">
      <div
        className={`h-2.5 rounded-full transition-all duration-500 ${
          candidate.is_winner ? 'bg-green-500' : 'bg-blue-500'
        }`}
        style={{ width: `${Math.min(100, candidate.percentage)}%` }}
        role="progressbar"
        aria-valuenow={candidate.percentage}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  </div>
);

export const ElectionResults: React.FC<ElectionResultsProps> = ({ electionId, election }) => {
  const [results, setResults] = useState<ElectionResultsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchResults();
  }, [electionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchResults = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await electionService.getResults(electionId);
      setResults(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Results not available yet'));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="text-theme-text-muted">Loading results...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
        <p className="text-sm text-yellow-700 dark:text-yellow-300">{error}</p>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="card-secondary p-4">
        <p className="text-sm text-theme-text-secondary">No results available</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overall Stats */}
      <div className="bg-theme-surface backdrop-blur-xs rounded-lg p-6">
        <h3 className="text-lg font-medium text-theme-text-primary mb-4">Election Summary</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-blue-500/10 rounded-lg p-4">
            <div className="text-sm font-medium text-blue-700 dark:text-blue-400">Total Votes</div>
            <div className="mt-1 text-2xl font-semibold text-blue-700 dark:text-blue-200" aria-label={`Total votes: ${results.total_votes}`}>
              {results.total_votes}
            </div>
          </div>

          <div className="bg-green-500/10 rounded-lg p-4">
            <div className="text-sm font-medium text-green-700 dark:text-green-400">Eligible Voters</div>
            <div className="mt-1 text-2xl font-semibold text-green-700 dark:text-green-200" aria-label={`Eligible voters: ${results.total_eligible_voters}`}>
              {results.total_eligible_voters}
            </div>
          </div>

          <div className="bg-purple-500/10 rounded-lg p-4">
            <div className="text-sm font-medium text-purple-700 dark:text-purple-400">Turnout</div>
            <div className="mt-1 text-2xl font-semibold text-purple-700 dark:text-purple-200" aria-label={`Voter turnout: ${results.voter_turnout_percentage}%`}>
              {results.voter_turnout_percentage}%
            </div>
          </div>

          <div className="bg-theme-surface-secondary rounded-lg p-4">
            <div className="text-sm font-medium text-theme-text-muted">Victory Condition</div>
            <div className="mt-1 text-sm font-semibold text-theme-text-primary">
              {getVictoryDescription(election)}
            </div>
          </div>
        </div>
      </div>

      {/* Quorum Status */}
      {results.quorum_met !== undefined && (
        <div
          className={`rounded-lg p-4 border ${
            results.quorum_met
              ? 'bg-green-500/10 border-green-500/30'
              : 'bg-red-500/10 border-red-500/30'
          }`}
        >
          <div className="flex items-center space-x-2">
            {results.quorum_met ? (
              <svg className="h-5 w-5 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            )}
            <span className={`text-sm font-medium ${
              results.quorum_met
                ? 'text-green-700 dark:text-green-300'
                : 'text-red-700 dark:text-red-300'
            }`}>
              {results.quorum_met ? 'Quorum Met' : 'Quorum Not Met'}
            </span>
          </div>
          {results.quorum_detail && (
            <p className={`mt-1 text-sm ${
              results.quorum_met
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}>
              {results.quorum_detail}
            </p>
          )}
          {!results.quorum_met && (
            <p className="mt-2 text-sm text-red-700 dark:text-red-300 font-medium">
              Results are not valid until quorum is reached.
            </p>
          )}
        </div>
      )}

      {/* Results by Position */}
      {results.results_by_position && results.results_by_position.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-theme-text-primary">Results by Position</h3>
          {results.results_by_position.map((positionResult) => (
            <div key={positionResult.position} className="bg-theme-surface backdrop-blur-xs rounded-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h4 className="text-md font-semibold text-theme-text-primary">{positionResult.position}</h4>
                <span className="text-sm text-theme-text-muted">
                  {positionResult.total_votes} {positionResult.total_votes === 1 ? 'vote' : 'votes'}
                </span>
              </div>

              <div className="space-y-3">
                {(positionResult.candidates || []).map((candidate) => (
                  <CandidateResultCard key={candidate.candidate_id} candidate={candidate} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Overall Results (if no positions or single election) */}
      {(!results.results_by_position || results.results_by_position.length === 0) &&
        results.overall_results && results.overall_results.length > 0 && (
          <div className="bg-theme-surface backdrop-blur-xs rounded-lg p-6">
            <h3 className="text-lg font-medium text-theme-text-primary mb-4">Results</h3>
            <div className="space-y-3">
              {results.overall_results.map((candidate) => (
                <CandidateResultCard key={candidate.candidate_id} candidate={candidate} />
              ))}
            </div>
          </div>
        )}
    </div>
  );
};

export default ElectionResults;
