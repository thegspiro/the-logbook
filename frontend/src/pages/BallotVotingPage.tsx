/**
 * Ballot Voting Page (Public — Token-Based)
 *
 * Standalone page that members access via the "Vote Now" link in their
 * email. Authentication is via the 32-character token in the URL, not
 * a user login. The token maps to a voter_hash for anonymous voting.
 *
 * Flow:
 * 1. Member clicks "Vote Now" in email → /ballot?token=xxx
 * 2. Page loads election data and ballot items via token
 * 3. Member votes on each item (approve, deny, write-in, or abstain)
 * 4. Member clicks "Submit Ballot"
 * 5. Confirmation modal shows summary of all choices
 * 6. Member confirms → ballot submitted atomically
 * 7. Success confirmation displayed
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { electionService } from '../services/api';
import type {
  Election,
  BallotItem,
  Candidate,
  BallotItemVote,
  BallotSubmissionResponse,
} from '../types/election';
import { getErrorMessage } from '../utils/errorHandling';

type ItemChoice = {
  choice: string; // 'approve' | 'deny' | 'write_in' | 'abstain' | candidate UUID
  write_in_name: string;
};

export const BallotVotingPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [election, setElection] = useState<Election | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, ItemChoice>>({});
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitResult, setSubmitResult] = useState<BallotSubmissionResponse | null>(null);

  useEffect(() => {
    if (token) {
      loadBallot();
    } else {
      setError('No voting token provided. Please use the link from your ballot email.');
      setLoading(false);
    }
  }, [token]);

  const loadBallot = async () => {
    try {
      setLoading(true);
      setError(null);
      const [electionData, candidateData] = await Promise.all([
        electionService.getBallotByToken(token),
        electionService.getBallotCandidates(token),
      ]);
      setElection(electionData);
      setCandidates(candidateData);

      // Initialize choices with 'abstain' for all ballot items
      const initialChoices: Record<string, ItemChoice> = {};
      for (const item of electionData.ballot_items || []) {
        initialChoices[item.id] = { choice: 'abstain', write_in_name: '' };
      }
      setChoices(initialChoices);
    } catch (err: unknown) {
      const detail = getErrorMessage(err, 'Unable to load ballot. The link may be expired or invalid.');
      if (detail === 'This ballot has already been fully submitted') {
        setError('This ballot has already been submitted. Each voting link can only be used once.');
      } else {
        setError(detail);
      }
    } finally {
      setLoading(false);
    }
  };

  const updateChoice = useCallback((itemId: string, choice: string, writeInName?: string) => {
    setChoices((prev) => ({
      ...prev,
      [itemId]: {
        choice,
        write_in_name: writeInName !== undefined ? writeInName : prev[itemId]?.write_in_name || '',
      },
    }));
  }, []);

  const updateWriteInName = useCallback((itemId: string, name: string) => {
    setChoices((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        write_in_name: name,
      },
    }));
  }, []);

  const handleSubmitBallot = () => {
    // Validate write-ins have names
    for (const [itemId, itemChoice] of Object.entries(choices)) {
      if (itemChoice.choice === 'write_in' && !itemChoice.write_in_name.trim()) {
        const item = (election?.ballot_items || []).find((i) => i.id === itemId);
        setError(`Please enter a name for your write-in on: ${item?.title || itemId}`);
        return;
      }
    }
    setError(null);
    setShowConfirmation(true);
  };

  const handleConfirmSubmit = async () => {
    if (!election) return;

    try {
      setSubmitting(true);
      setError(null);

      const votes: BallotItemVote[] = Object.entries(choices).map(([itemId, itemChoice]) => ({
        ballot_item_id: itemId,
        choice: itemChoice.choice,
        write_in_name: itemChoice.choice === 'write_in' ? itemChoice.write_in_name.trim() : undefined,
      }));

      const result = await electionService.submitBallot(token, votes);
      setSubmitResult(result);
      setSubmitted(true);
      setShowConfirmation(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to submit ballot. Please try again.'));
      setShowConfirmation(false);
    } finally {
      setSubmitting(false);
    }
  };

  const getChoiceLabel = (itemId: string): string => {
    const itemChoice = choices[itemId];
    if (!itemChoice) return 'Abstain';

    switch (itemChoice.choice) {
      case 'approve':
        return 'Approve';
      case 'deny':
        return 'Deny';
      case 'abstain':
        return 'Abstain (No Vote)';
      case 'write_in':
        return `Write-in: ${itemChoice.write_in_name || '(empty)'}`;
      default: {
        // Candidate UUID
        const candidate = candidates.find((c) => c.id === itemChoice.choice);
        return candidate ? candidate.name : itemChoice.choice;
      }
    }
  };

  const getCandidatesForItem = (item: BallotItem): Candidate[] => {
    const position = item.position || item.id;
    return candidates.filter((c) => c.position === position && !c.is_write_in);
  };

  // ---- Render states ----

  if (loading) {
    return (
      <div className="min-h-screen bg-theme-surface-secondary flex items-center justify-center">
        <div className="text-center" role="status" aria-live="polite">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-t-4 border-b-4 border-red-600 mb-4"></div>
          <p className="text-theme-text-secondary">Loading your ballot...</p>
        </div>
      </div>
    );
  }

  if (error && !election) {
    return (
      <div className="min-h-screen bg-theme-surface-secondary flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-theme-surface rounded-lg shadow-lg p-8 text-center">
          <div className="text-red-600 text-5xl mb-4">!</div>
          <h1 className="text-xl font-bold text-theme-text-primary mb-2">Unable to Load Ballot</h1>
          <p className="text-theme-text-secondary">{error}</p>
          <p className="text-sm text-theme-text-muted mt-4">
            If you believe this is an error, please contact your organization secretary.
          </p>
        </div>
      </div>
    );
  }

  if (submitted && submitResult) {
    return (
      <div className="min-h-screen bg-theme-surface-secondary flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-theme-surface rounded-lg shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-theme-text-primary mb-2">Ballot Submitted</h1>
          <p className="text-theme-text-secondary mb-4">{submitResult.message}</p>
          <div className="bg-theme-surface-secondary rounded-lg p-4 text-sm text-theme-text-muted">
            <p>Your ballot has been recorded securely and anonymously.</p>
            <p className="mt-2">You may close this page.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!election) return null;

  const ballotItems = election.ballot_items || [];

  return (
    <div className="min-h-screen bg-theme-surface-secondary">
      {/* Header */}
      <div className="bg-red-700 text-white">
        <div className="max-w-2xl mx-auto px-4 py-8 text-center">
          <h1 className="text-2xl font-bold">{election.title}</h1>
          {election.description && (
            <p className="mt-2 text-red-100">{election.description}</p>
          )}
          {election.meeting_date && (
            <p className="mt-1 text-red-200 text-sm">
              Meeting Date: {new Date(election.meeting_date).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          )}
        </div>
      </div>

      {/* Ballot Content */}
      <div className="max-w-2xl mx-auto px-4 py-8">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="mb-6">
          <p className="text-theme-text-secondary text-sm">
            Please review each item below and make your selection. You may vote for the
            presented option, write in an alternative, or abstain from voting on any item.
          </p>
        </div>

        {/* Ballot Items */}
        <div className="space-y-6">
          {ballotItems.map((item, index) => {
            const itemChoice = choices[item.id];
            const itemCandidates = getCandidatesForItem(item);
            const isApprovalType = item.vote_type === 'approval';

            return (
              <div
                key={item.id}
                className="bg-theme-surface rounded-lg shadow-sm border border-theme-surface-border overflow-hidden"
              >
                {/* Item Header */}
                <div className="bg-theme-surface-secondary px-6 py-4 border-b border-theme-surface-border">
                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-8 h-8 bg-red-100 text-red-700 rounded-full flex items-center justify-center text-sm font-bold">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="font-semibold text-theme-text-primary">{item.title}</h3>
                      {item.description && (
                        <p className="mt-1 text-sm text-theme-text-muted">{item.description}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Voting Options */}
                <div className="px-6 py-4 space-y-3">
                  {isApprovalType ? (
                    <>
                      {/* Approve */}
                      <label className="flex items-center gap-3 p-3 rounded-lg border border-theme-surface-border cursor-pointer hover:bg-green-50 hover:border-green-300 transition-colors">
                        <input
                          type="radio"
                          name={`item-${item.id}`}
                          checked={itemChoice?.choice === 'approve'}
                          onChange={() => updateChoice(item.id, 'approve')}
                          className="w-4 h-4 text-green-600 focus:ring-green-500"
                        />
                        <span className="font-medium text-theme-text-primary">Approve</span>
                      </label>

                      {/* Deny */}
                      <label className="flex items-center gap-3 p-3 rounded-lg border border-theme-surface-border cursor-pointer hover:bg-red-50 hover:border-red-300 transition-colors">
                        <input
                          type="radio"
                          name={`item-${item.id}`}
                          checked={itemChoice?.choice === 'deny'}
                          onChange={() => updateChoice(item.id, 'deny')}
                          className="w-4 h-4 text-red-600 focus:ring-red-500"
                        />
                        <span className="font-medium text-theme-text-primary">Deny</span>
                      </label>
                    </>
                  ) : (
                    <>
                      {/* Candidate Selection */}
                      {itemCandidates.map((candidate) => (
                        <label
                          key={candidate.id}
                          className="flex items-center gap-3 p-3 rounded-lg border border-theme-surface-border cursor-pointer hover:bg-blue-50 hover:border-blue-300 transition-colors"
                        >
                          <input
                            type="radio"
                            name={`item-${item.id}`}
                            checked={itemChoice?.choice === candidate.id}
                            onChange={() => updateChoice(item.id, candidate.id)}
                            className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                          />
                          <div>
                            <span className="font-medium text-theme-text-primary">{candidate.name}</span>
                            {candidate.statement && (
                              <p className="text-sm text-theme-text-muted mt-0.5">{candidate.statement}</p>
                            )}
                          </div>
                        </label>
                      ))}
                    </>
                  )}

                  {/* Write-in option */}
                  {election.allow_write_ins && (
                    <div
                      className={`p-3 rounded-lg border transition-colors ${
                        itemChoice?.choice === 'write_in'
                          ? 'border-purple-300 bg-purple-50'
                          : 'border-theme-surface-border hover:bg-purple-50 hover:border-purple-300'
                      }`}
                    >
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="radio"
                          name={`item-${item.id}`}
                          checked={itemChoice?.choice === 'write_in'}
                          onChange={() => updateChoice(item.id, 'write_in')}
                          className="w-4 h-4 text-purple-600 focus:ring-purple-500"
                        />
                        <span className="font-medium text-theme-text-primary">Write-in</span>
                      </label>
                      {itemChoice?.choice === 'write_in' && (
                        <input
                          type="text"
                          value={itemChoice.write_in_name}
                          onChange={(e) => updateWriteInName(item.id, e.target.value)}
                          placeholder="Enter name or option..."
                          aria-label="Enter name or option"
                          className="mt-2 ml-7 block w-[calc(100%-1.75rem)] border border-theme-surface-border rounded-md shadow-sm py-2 px-3 focus:ring-purple-500 focus:border-purple-500 text-sm bg-theme-input-bg text-theme-text-primary"
                          autoFocus
                        />
                      )}
                    </div>
                  )}

                  {/* Abstain */}
                  <label className="flex items-center gap-3 p-3 rounded-lg border border-theme-surface-border cursor-pointer hover:bg-theme-surface-hover transition-colors">
                    <input
                      type="radio"
                      name={`item-${item.id}`}
                      checked={itemChoice?.choice === 'abstain'}
                      onChange={() => updateChoice(item.id, 'abstain')}
                      className="w-4 h-4 text-theme-text-muted focus:ring-gray-500"
                    />
                    <span className="text-theme-text-muted">Abstain (Do not vote on this item)</span>
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        {/* Submit Button */}
        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={handleSubmitBallot}
            className="px-8 py-3 bg-red-700 text-white text-lg font-semibold rounded-lg hover:bg-red-800 shadow-lg transition-colors"
          >
            Submit Ballot
          </button>
          <p className="mt-2 text-sm text-theme-text-muted">
            You will have a chance to review your choices before they are submitted.
          </p>
        </div>

        {/* Security notice */}
        <div className="mt-8 text-center text-xs text-theme-text-muted">
          <p>Your vote is anonymous and securely recorded.</p>
          <p>This voting link is unique to you. Do not share it with others.</p>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmation && (
        <div
          className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-ballot-title"
          onKeyDown={(e) => { if (e.key === 'Escape' && !submitting) setShowConfirmation(false); }}
        >
          <div className="bg-theme-surface rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-theme-surface-border bg-theme-surface-secondary">
              <h3 id="confirm-ballot-title" className="text-lg font-bold text-theme-text-primary">Confirm Your Ballot</h3>
              <p className="text-sm text-theme-text-muted mt-1">
                Please review your selections below. Once submitted, your ballot cannot be changed.
              </p>
            </div>

            <div className="px-6 py-4">
              <div className="space-y-4">
                {ballotItems.map((item, index) => {
                  const label = getChoiceLabel(item.id);
                  const isAbstain = choices[item.id]?.choice === 'abstain';

                  return (
                    <div
                      key={item.id}
                      className={`flex items-start gap-3 p-3 rounded-lg ${
                        isAbstain ? 'bg-theme-surface-secondary' : 'bg-blue-50'
                      }`}
                    >
                      <span className="flex-shrink-0 w-6 h-6 bg-theme-surface-secondary text-theme-text-secondary rounded-full flex items-center justify-center text-xs font-bold">
                        {index + 1}
                      </span>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-theme-text-primary">{item.title}</div>
                        <div
                          className={`text-sm mt-0.5 font-semibold ${
                            isAbstain
                              ? 'text-theme-text-muted'
                              : choices[item.id]?.choice === 'approve'
                                ? 'text-green-700'
                                : choices[item.id]?.choice === 'deny'
                                  ? 'text-red-700'
                                  : 'text-blue-700'
                          }`}
                        >
                          {label}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-theme-surface-border bg-theme-surface-secondary flex justify-between">
              <button
                type="button"
                onClick={() => setShowConfirmation(false)}
                disabled={submitting}
                className="px-4 py-2 border border-theme-surface-border rounded-md text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-50"
              >
                Change Ballot
              </button>
              <button
                type="button"
                onClick={handleConfirmSubmit}
                disabled={submitting}
                className="px-6 py-2 bg-red-700 text-white font-semibold rounded-md hover:bg-red-800 disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Cast Ballot'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BallotVotingPage;
