/**
 * Election Results Component
 *
 * Displays election results in a simple, anonymous manner.
 */

import React, { useEffect, useState } from 'react';
import { electionService } from '../services/api';
import type { ElectionResults as ElectionResultsType, Election } from '../types/election';
import { getErrorMessage } from '../utils/errorHandling';

interface ElectionResultsProps {
  electionId: string;
  election: Election;
}

export const ElectionResults: React.FC<ElectionResultsProps> = ({ electionId, election }) => {
  const [results, setResults] = useState<ElectionResultsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchResults();
  }, [electionId]);

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
      <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-lg p-4">
        <p className="text-sm text-theme-text-secondary">No results available</p>
      </div>
    );
  }

  const getVictoryInfo = () => {
    const { victory_condition, victory_threshold, victory_percentage } = election;

    switch (victory_condition) {
      case 'most_votes':
        return 'Most Votes (Plurality)';
      case 'majority':
        return 'Majority (>50% of votes)';
      case 'supermajority':
        return `Supermajority (${victory_percentage || 67}% of votes)`;
      case 'threshold':
        if (victory_threshold) {
          return `Threshold (${victory_threshold} votes required)`;
        }
        if (victory_percentage) {
          return `Threshold (${victory_percentage}% of votes required)`;
        }
        return 'Threshold';
      default:
        return 'Simple Majority';
    }
  };

  return (
    <div className="space-y-6">
      {/* Overall Stats */}
      <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6">
        <h3 className="text-lg font-medium text-theme-text-primary mb-4">Election Summary</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-blue-500/10 rounded-lg p-4">
            <div className="text-sm font-medium text-blue-700 dark:text-blue-400">Total Votes</div>
            <div className="mt-1 text-2xl font-semibold text-blue-200">
              {results.total_votes}
            </div>
          </div>

          <div className="bg-green-500/10 rounded-lg p-4">
            <div className="text-sm font-medium text-green-700 dark:text-green-400">Eligible Voters</div>
            <div className="mt-1 text-2xl font-semibold text-green-200">
              {results.total_eligible_voters}
            </div>
          </div>

          <div className="bg-purple-500/10 rounded-lg p-4">
            <div className="text-sm font-medium text-purple-700 dark:text-purple-400">Turnout</div>
            <div className="mt-1 text-2xl font-semibold text-purple-200">
              {results.voter_turnout_percentage}%
            </div>
          </div>

          <div className="bg-theme-surface-secondary rounded-lg p-4">
            <div className="text-sm font-medium text-theme-text-muted">Victory Condition</div>
            <div className="mt-1 text-sm font-semibold text-theme-text-primary">
              {getVictoryInfo()}
            </div>
          </div>
        </div>
      </div>

      {/* Results by Position */}
      {results.results_by_position && results.results_by_position.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-theme-text-primary">Results by Position</h3>
          {results.results_by_position.map((positionResult) => (
            <div key={positionResult.position} className="bg-theme-surface backdrop-blur-sm rounded-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h4 className="text-md font-semibold text-theme-text-primary">{positionResult.position}</h4>
                <span className="text-sm text-theme-text-muted">
                  {positionResult.total_votes} {positionResult.total_votes === 1 ? 'vote' : 'votes'}
                </span>
              </div>

              <div className="space-y-3">
                {positionResult.candidates.map((candidate) => (
                  <div
                    key={candidate.candidate_id}
                    className={`flex items-center justify-between p-4 rounded-lg border-2 ${
                      candidate.is_winner
                        ? 'border-green-500 bg-green-500/10'
                        : 'border-theme-surface-border bg-theme-surface-secondary'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      {candidate.is_winner && (
                        <svg
                          className="h-6 w-6 text-green-700 dark:text-green-400"
                          fill="currentColor"
                          viewBox="0 0 20 20"
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
                        <div className="text-sm text-theme-text-muted">Votes</div>
                        <div className="text-lg font-semibold text-theme-text-primary">
                          {candidate.vote_count}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-theme-text-muted">Percentage</div>
                        <div className="text-lg font-semibold text-theme-text-primary">
                          {candidate.percentage}%
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Overall Results (if no positions or single election) */}
      {(!results.results_by_position || results.results_by_position.length === 0) &&
        results.overall_results && results.overall_results.length > 0 && (
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6">
            <h3 className="text-lg font-medium text-theme-text-primary mb-4">Results</h3>
            <div className="space-y-3">
              {results.overall_results.map((candidate) => (
                <div
                  key={candidate.candidate_id}
                  className={`flex items-center justify-between p-4 rounded-lg border-2 ${
                    candidate.is_winner
                      ? 'border-green-500 bg-green-500/10'
                      : 'border-theme-surface-border bg-theme-surface-secondary'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    {candidate.is_winner && (
                      <svg
                        className="h-6 w-6 text-green-700 dark:text-green-400"
                        fill="currentColor"
                        viewBox="0 0 20 20"
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
                      <div className="text-sm text-theme-text-muted">Votes</div>
                      <div className="text-lg font-semibold text-theme-text-primary">
                        {candidate.vote_count}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-theme-text-muted">Percentage</div>
                      <div className="text-lg font-semibold text-theme-text-primary">
                        {candidate.percentage}%
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
    </div>
  );
};

export default ElectionResults;
