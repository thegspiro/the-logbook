/**
 * Election Ballot Component
 *
 * Voter-facing ballot interface that allows authenticated users to cast votes.
 * Supports simple, ranked-choice, and approval voting methods.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { electionService } from '../services/api';
import type { Election, Candidate, VoterEligibility, VoteCreate, VotingMethod } from '../types/election';
import { getErrorMessage } from '../utils/errorHandling';
import { VotingMethod as VM } from '../constants/enums';

interface ElectionBallotProps {
  electionId: string;
  election: Election;
  onVoteCast?: () => void;
}

export const ElectionBallot: React.FC<ElectionBallotProps> = ({ electionId, election, onVoteCast }) => {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [eligibility, setEligibility] = useState<VoterEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Simple/supermajority: single selection per position
  const [selectedCandidates, setSelectedCandidates] = useState<Record<string, string>>({});

  // Ranked-choice: ordered rankings per position
  const [rankings, setRankings] = useState<Record<string, string[]>>({});

  // Approval: multiple selections per position
  const [approvals, setApprovals] = useState<Record<string, Set<string>>>({});

  useEffect(() => {
    void fetchData();
  }, [electionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [candidatesData, eligibilityData] = await Promise.all([
        electionService.getCandidates(electionId),
        electionService.checkEligibility(electionId),
      ]);

      setCandidates(candidatesData.filter((c) => c.accepted));
      setEligibility(eligibilityData);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load ballot'));
    } finally {
      setLoading(false);
    }
  };

  /** Returns the list of positions to vote on, or ['_default'] for single-position elections. */
  const getPositions = (): string[] => {
    if (election.positions && election.positions.length > 0) {
      return election.positions;
    }
    return ['_default'];
  };

  const getCandidatesForPosition = (position: string): Candidate[] => {
    if (position === '_default') {
      return candidates;
    }
    return candidates.filter((c) => c.position === position);
  };

  const isPositionVoted = (position: string): boolean => {
    if (!eligibility) return false;
    if (position === '_default') return eligibility.has_voted;
    return eligibility.positions_voted.includes(position);
  };

  const handleSimpleSelect = (position: string, candidateId: string) => {
    setSelectedCandidates((prev) => ({ ...prev, [position]: candidateId }));
  };

  const handleApprovalToggle = (position: string, candidateId: string) => {
    setApprovals((prev) => {
      const current = new Set(prev[position] || []);
      if (current.has(candidateId)) {
        current.delete(candidateId);
      } else {
        current.add(candidateId);
      }
      return { ...prev, [position]: current };
    });
  };

  const handleRankingAdd = (position: string, candidateId: string) => {
    setRankings((prev) => {
      const current = [...(prev[position] || [])];
      if (current.includes(candidateId)) {
        return { ...prev, [position]: current.filter((id) => id !== candidateId) };
      }
      current.push(candidateId);
      return { ...prev, [position]: current };
    });
  };

  const handleRankingRemove = (position: string, candidateId: string) => {
    setRankings((prev) => {
      const current = [...(prev[position] || [])];
      return { ...prev, [position]: current.filter((id) => id !== candidateId) };
    });
  };

  /**
   * Submits a vote for a single position. Handles three voting methods:
   * - ranked_choice: submits ordered rankings with rank numbers
   * - approval: submits one vote per approved candidate
   * - simple/supermajority: submits a single selected candidate
   */
  const handleSubmitVote = async (position: string) => {
    try {
      setSubmitting(true);
      setError(null);

      const votingMethod: VotingMethod = election.voting_method;
      const actualPosition = position === '_default' ? undefined : position;

      if (votingMethod === VM.RANKED_CHOICE) {
        const ranked = rankings[position] || [];
        if (ranked.length === 0) {
          setError('Please rank at least one candidate');
          return;
        }

        // Submit all ranked votes atomically — a sequential per-rank loop
        // could leave a partial ballot recorded if one call failed mid-way
        await electionService.bulkCastVotes(
          electionId,
          ranked.map((candidateId, i) => ({
            candidate_id: candidateId,
            position: actualPosition,
            vote_rank: i + 1,
          }))
        );
      } else if (votingMethod === VM.APPROVAL) {
        const approved = approvals[position];
        if (!approved || approved.size === 0) {
          setError('Please approve at least one candidate');
          return;
        }

        // Submit all approvals atomically (same partial-ballot concern)
        await electionService.bulkCastVotes(
          electionId,
          [...approved].map((candidateId) => ({
            candidate_id: candidateId,
            position: actualPosition,
          }))
        );
      } else {
        // Simple majority or supermajority
        const candidateId = selectedCandidates[position];
        if (!candidateId) {
          setError('Please select a candidate');
          return;
        }

        const voteData: VoteCreate = {
          election_id: electionId,
          candidate_id: candidateId,
          position: actualPosition,
        };
        await electionService.castVote(electionId, voteData);
      }

      toast.success(
        actualPosition ? `Vote for ${actualPosition} submitted successfully` : 'Vote submitted successfully'
      );

      // Refresh eligibility
      const updatedEligibility = await electionService.checkEligibility(electionId);
      setEligibility(updatedEligibility);
      onVoteCast?.();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to cast vote'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-theme-surface rounded-lg p-6 backdrop-blur-xs">
        <div className="text-theme-text-muted py-4 text-center">Loading ballot...</div>
      </div>
    );
  }

  if (!eligibility) {
    return null;
  }

  if (!eligibility.is_eligible && eligibility.has_voted && eligibility.positions_remaining.length === 0) {
    return (
      <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-6">
        <div className="flex items-center">
          <svg className="mr-2 h-6 w-6 text-green-700 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span className="font-medium text-green-700 dark:text-green-300">
            You have already voted in this election.
          </span>
        </div>
      </div>
    );
  }

  if (!eligibility.is_eligible && !eligibility.has_voted) {
    return (
      <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-6">
        <p className="text-yellow-700 dark:text-yellow-300">
          {eligibility.reason ||
            'You are not eligible to vote in this election. Contact the election administrator for details.'}
        </p>
      </div>
    );
  }

  const positions = getPositions();
  const votingMethod: VotingMethod = election.voting_method;

  const getMethodLabel = () => {
    switch (votingMethod) {
      case VM.RANKED_CHOICE:
        return 'Rank candidates in order of preference (click to add ranking)';
      case VM.APPROVAL:
        return 'Select all candidates you approve of';
      case VM.SUPERMAJORITY:
        return 'Select one candidate';
      default:
        return 'Select one candidate';
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-theme-surface rounded-lg p-6 backdrop-blur-xs">
        <h3 className="text-theme-text-primary mb-2 text-lg font-medium">Cast Your Vote</h3>
        <p className="text-theme-text-muted mb-4 text-sm">{getMethodLabel()}</p>

        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-4 rounded-sm border border-red-500/30 bg-red-500/10 p-3"
          >
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {positions.map((position) => {
          const positionCandidates = getCandidatesForPosition(position);
          const voted = isPositionVoted(position);

          if (voted) {
            return (
              <div key={position} className="mb-6">
                {position !== '_default' && (
                  <h4 className="text-md text-theme-text-primary mb-3 font-semibold">{position}</h4>
                )}
                <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4">
                  <div className="flex items-center text-green-700 dark:text-green-300">
                    <svg className="mr-2 h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Vote submitted for {position === '_default' ? 'this election' : position}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={position} className="mb-6">
              {position !== '_default' && (
                <h4 className="text-md text-theme-text-primary mb-3 font-semibold">{position}</h4>
              )}

              {positionCandidates.length === 0 ? (
                <p className="text-theme-text-muted text-sm">No candidates for this position</p>
              ) : (
                <>
                  {/* Ranked Choice: Show ranking */}
                  {votingMethod === VM.RANKED_CHOICE && (
                    <div
                      className="space-y-2"
                      role="group"
                      aria-label={`Ranked choice candidates${position !== '_default' ? ` for ${position}` : ''}`}
                    >
                      {(rankings[position] || []).length > 0 && (
                        <div className="mb-4 rounded-lg bg-blue-500/10 p-3">
                          <p className="mb-2 text-sm font-medium text-blue-700 dark:text-blue-300">Your Rankings:</p>
                          {(rankings[position] || []).map((candidateId, idx) => {
                            const candidate = positionCandidates.find((c) => c.id === candidateId);
                            return (
                              <div
                                key={candidateId}
                                className="bg-theme-surface-secondary mb-1 flex items-center justify-between rounded-sm px-2 py-1"
                              >
                                <span className="text-theme-text-primary text-sm">
                                  <span className="mr-2 font-bold text-blue-700 dark:text-blue-400">#{idx + 1}</span>
                                  {candidate?.name}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleRankingRemove(position, candidateId)}
                                  aria-label={`Remove ${candidate?.name ?? 'candidate'} from ranking`}
                                  className="text-xs text-red-700 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                                >
                                  Remove
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {positionCandidates.map((candidate) => {
                        const isRanked = (rankings[position] || []).includes(candidate.id);
                        return (
                          <button
                            key={candidate.id}
                            type="button"
                            onClick={() => handleRankingAdd(position, candidate.id)}
                            disabled={isRanked}
                            aria-label={
                              isRanked
                                ? `${candidate.name} ranked #${(rankings[position] || []).indexOf(candidate.id) + 1}`
                                : `Add ${candidate.name} to ranking`
                            }
                            className={`w-full rounded-lg border-2 p-4 text-left transition-colors ${
                              isRanked
                                ? 'border-blue-500 bg-blue-500/10 opacity-60'
                                : 'border-theme-surface-border hover:border-blue-400 hover:bg-blue-500/10'
                            }`}
                          >
                            <div className="text-theme-text-primary font-medium">{candidate.name}</div>
                            {candidate.statement && (
                              <p className="text-theme-text-muted mt-1 text-sm">{candidate.statement}</p>
                            )}
                            {isRanked && (
                              <span className="text-xs text-blue-700 dark:text-blue-400">
                                Ranked #{(rankings[position] || []).indexOf(candidate.id) + 1}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Approval Voting: Checkboxes */}
                  {votingMethod === VM.APPROVAL && (
                    <div
                      className="space-y-2"
                      role="group"
                      aria-label={`Approval voting candidates${position !== '_default' ? ` for ${position}` : ''}`}
                    >
                      {positionCandidates.map((candidate) => {
                        const isApproved = (approvals[position] || new Set()).has(candidate.id);
                        return (
                          <button
                            key={candidate.id}
                            type="button"
                            onClick={() => handleApprovalToggle(position, candidate.id)}
                            aria-pressed={isApproved}
                            aria-label={`${isApproved ? 'Remove approval for' : 'Approve'} ${candidate.name}`}
                            className={`w-full rounded-lg border-2 p-4 text-left transition-colors ${
                              isApproved
                                ? 'border-green-500 bg-green-500/10'
                                : 'border-theme-surface-border hover:border-green-400 hover:bg-green-500/10'
                            }`}
                          >
                            <div className="flex items-center">
                              <div
                                className={`mr-3 flex h-5 w-5 items-center justify-center rounded border-2 ${
                                  isApproved ? 'border-green-500 bg-green-500' : 'border-theme-input-border'
                                }`}
                              >
                                {isApproved && (
                                  <svg
                                    className="text-theme-text-primary h-3 w-3"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path
                                      fillRule="evenodd"
                                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                )}
                              </div>
                              <div>
                                <div className="text-theme-text-primary font-medium">{candidate.name}</div>
                                {candidate.statement && (
                                  <p className="text-theme-text-muted mt-1 text-sm">{candidate.statement}</p>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Simple / Supermajority: Radio-style selection */}
                  {(votingMethod === VM.SIMPLE_MAJORITY || votingMethod === VM.SUPERMAJORITY) && (
                    <div
                      className="space-y-2"
                      role="group"
                      aria-label={`Candidates${position !== '_default' ? ` for ${position}` : ''}`}
                    >
                      {positionCandidates.map((candidate) => {
                        const isSelected = selectedCandidates[position] === candidate.id;
                        return (
                          <button
                            key={candidate.id}
                            type="button"
                            onClick={() => handleSimpleSelect(position, candidate.id)}
                            aria-pressed={isSelected}
                            aria-label={`Select ${candidate.name}`}
                            className={`w-full rounded-lg border-2 p-4 text-left transition-colors ${
                              isSelected
                                ? 'border-blue-500 bg-blue-500/10'
                                : 'border-theme-surface-border hover:border-blue-400 hover:bg-blue-500/10'
                            }`}
                          >
                            <div className="flex items-center">
                              <div
                                className={`mr-3 flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                                  isSelected ? 'border-blue-500' : 'border-theme-input-border'
                                }`}
                              >
                                {isSelected && <div className="h-3 w-3 rounded-full bg-blue-500" />}
                              </div>
                              <div>
                                <div className="text-theme-text-primary font-medium">{candidate.name}</div>
                                {candidate.statement && (
                                  <p className="text-theme-text-muted mt-1 text-sm">{candidate.statement}</p>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => {
                        void handleSubmitVote(position);
                      }}
                      disabled={submitting}
                      className="btn-info rounded-md px-6"
                    >
                      {submitting
                        ? 'Submitting...'
                        : position === '_default'
                          ? 'Submit Vote'
                          : `Submit Vote for ${position}`}
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ElectionBallot;
