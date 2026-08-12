/**
 * Ballot Voting Page (Public — Token-Based)
 *
 * Standalone page that members access via the "Vote Now" link in their
 * email. Authentication is via the 32-character token in the URL, not
 * a user login. The token maps to a voter_hash for anonymous voting.
 *
 * Flow:
 * 1. Member clicks "Vote Now" in email → /ballot#token=xxx (the token rides
 *    in the URL fragment — browsers never send fragments to any server, so
 *    the live credential stays out of access logs; ?token= is still accepted
 *    for links emailed before the fragment change)
 * 2. Page captures the token into state, scrubs it from the address bar,
 *    and loads election data + candidates via POST /elections/ballot/lookup
 * 3. Member votes on each item (approve, deny, write-in, or abstain)
 * 4. Member clicks "Submit Ballot"
 * 5. Confirmation modal shows summary of all choices
 * 6. Member confirms → ballot submitted atomically
 * 7. Success confirmation displayed
 */

import React, { useEffect, useState, useCallback } from 'react';
import { electionService } from '../services/api';
import type {
  BallotElection,
  BallotItem,
  Candidate,
  BallotItemVote,
  BallotSubmissionResponse,
} from '../types/election';
import { getErrorMessage } from '../utils/errorHandling';
import { formatDate } from '../utils/dateFormatting';
import { BallotChoice } from '../constants/enums';
import { VoteType } from '../constants/enums';
import { useTimezone } from '../hooks/useTimezone';

type ItemChoice = {
  choice: string; // 'approve' | 'deny' | 'write_in' | 'abstain' | candidate UUID
  write_in_name: string;
  // Multi-select for approval / multi-vote items (candidate UUIDs)
  candidate_ids: string[];
  // Ranked choice: candidate UUID → rank number (unique per item)
  ranks: Record<string, number>;
};

const emptyChoice = (): ItemChoice => ({
  choice: BallotChoice.ABSTAIN,
  write_in_name: '',
  candidate_ids: [],
  ranks: {},
});

/** Ordered candidate ids for the wire payload — index 0 = rank 1. */
const ranksToOrderedIds = (ranks: Record<string, number>): string[] =>
  Object.entries(ranks)
    .sort((a, b) => a[1] - b[1])
    .map(([cid]) => cid);

/**
 * Capture the voting token from the URL (fragment preferred, query-string
 * fallback for pre-fragment emails) and scrub it from the address bar so it
 * can't linger in browser history or be leaked via a copied URL.
 */
const captureTokenFromUrl = (): string => {
  const hashToken = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token');
  const queryToken = new URLSearchParams(window.location.search).get('token');
  const token = hashToken || queryToken || '';
  if (token) {
    window.history.replaceState(null, '', window.location.pathname);
  }
  return token;
};

export const BallotVotingPage: React.FC = () => {
  const tz = useTimezone();
  const [token] = useState<string>(captureTokenFromUrl);

  const [election, setElection] = useState<BallotElection | null>(null);
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
      void loadBallot();
    } else {
      setError('No voting token provided. Please use the link from your ballot email.');
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadBallot = async () => {
    try {
      setLoading(true);
      setError(null);
      const { election: electionData, candidates: candidateData } = await electionService.lookupBallot(token);
      setElection(electionData);
      setCandidates(candidateData);

      // Initialize choices with 'abstain' for all ballot items
      const initialChoices: Record<string, ItemChoice> = {};
      for (const item of electionData.ballot_items || []) {
        initialChoices[item.id] = emptyChoice();
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
    // Picking any single-selection option clears multi-select / rank state
    setChoices((prev) => ({
      ...prev,
      [itemId]: {
        choice,
        write_in_name: writeInName !== undefined ? writeInName : prev[itemId]?.write_in_name || '',
        candidate_ids: [],
        ranks: {},
      },
    }));
  }, []);

  const updateWriteInName = useCallback((itemId: string, name: string) => {
    setChoices((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] ?? emptyChoice()),
        write_in_name: name,
      },
    }));
  }, []);

  /** Toggle a candidate in an approval / multi-vote item's checkbox list. */
  const toggleCandidate = useCallback((itemId: string, candidateId: string, maxSelections: number | null) => {
    setChoices((prev) => {
      const current = prev[itemId] ?? emptyChoice();
      const selected = current.candidate_ids.includes(candidateId)
        ? current.candidate_ids.filter((id) => id !== candidateId)
        : maxSelections !== null && current.candidate_ids.length >= maxSelections
          ? current.candidate_ids // at the cap — ignore (box is disabled anyway)
          : [...current.candidate_ids, candidateId];
      return {
        ...prev,
        [itemId]: { ...current, choice: '', candidate_ids: selected, ranks: {} },
      };
    });
  }, []);

  /** Assign a rank to a candidate; a rank held by another candidate is freed. */
  const setCandidateRank = useCallback((itemId: string, candidateId: string, rank: number | null) => {
    setChoices((prev) => {
      const current = prev[itemId] ?? emptyChoice();
      const ranks: Record<string, number> = {};
      for (const [cid, r] of Object.entries(current.ranks)) {
        if (cid !== candidateId && r !== rank) ranks[cid] = r;
      }
      if (rank !== null) ranks[candidateId] = rank;
      return {
        ...prev,
        [itemId]: { ...current, choice: '', candidate_ids: [], ranks },
      };
    });
  }, []);

  /** Validates all choices (e.g. write-ins must have names) then shows the confirmation modal. */
  const handleSubmitBallot = () => {
    // Validate write-ins have names
    for (const [itemId, itemChoice] of Object.entries(choices)) {
      if (itemChoice.choice === BallotChoice.WRITE_IN && !itemChoice.write_in_name.trim()) {
        const item = (election?.ballot_items || []).find((i) => i.id === itemId);
        setError(`Please enter a name for your write-in on: ${item?.title || itemId}`);
        return;
      }
    }
    setError(null);
    setShowConfirmation(true);
  };

  /** Transforms choices into BallotItemVote[] and submits them atomically via the token endpoint. */
  const handleConfirmSubmit = async () => {
    if (!election) return;

    try {
      setSubmitting(true);
      setError(null);

      const votes: BallotItemVote[] = Object.entries(choices).map(([itemId, itemChoice]) => {
        if (itemChoice.candidate_ids.length > 0) {
          return { ballot_item_id: itemId, candidate_ids: itemChoice.candidate_ids };
        }
        const ordered = ranksToOrderedIds(itemChoice.ranks);
        if (ordered.length > 0) {
          return { ballot_item_id: itemId, rankings: ordered };
        }
        return {
          ballot_item_id: itemId,
          choice: itemChoice.choice || BallotChoice.ABSTAIN,
          write_in_name: itemChoice.choice === BallotChoice.WRITE_IN ? itemChoice.write_in_name.trim() : undefined,
        };
      });

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

  const candidateName = (candidateId: string): string =>
    candidates.find((c) => c.id === candidateId)?.name ?? candidateId;

  /** Converts a selection (choice/multi-select/rankings) to a display label. */
  const getChoiceLabel = (itemId: string): string => {
    const itemChoice = choices[itemId];
    if (!itemChoice) return 'Abstain';

    if (itemChoice.candidate_ids.length > 0) {
      return `Approved: ${itemChoice.candidate_ids.map(candidateName).join(', ')}`;
    }
    const ordered = ranksToOrderedIds(itemChoice.ranks);
    if (ordered.length > 0) {
      return `Ranked: ${ordered.map((cid, i) => `${i + 1}. ${candidateName(cid)}`).join(', ')}`;
    }
    if (!itemChoice.choice) return 'Abstain (No Vote)';

    switch (itemChoice.choice) {
      case BallotChoice.APPROVE:
        return 'Approve';
      case BallotChoice.DENY:
        return 'Deny';
      case BallotChoice.ABSTAIN:
        return 'Abstain (No Vote)';
      case BallotChoice.WRITE_IN:
        return `Write-in: ${itemChoice.write_in_name || '(empty)'}`;
      default: {
        // Candidate UUID
        const candidate = candidates.find((c) => c.id === itemChoice.choice);
        return candidate ? candidate.name : itemChoice.choice;
      }
    }
  };

  /**
   * Returns accepted candidates for a ballot item, matched by exact position.
   * Substring matching against the item title is deliberately avoided — a
   * position named "Chief" would match an item titled "Assistant Chief
   * Election" and surface candidates under the wrong item. For legacy items
   * without a position, the backend derives position from the item title, so
   * an exact title match is the correct fallback.
   */
  const getCandidatesForItem = (item: BallotItem): Candidate[] => {
    if (item.position) {
      return candidates.filter((c) => c.position === item.position && !c.is_write_in);
    }
    return candidates.filter(
      (c) => c.position != null && (c.position === item.title || c.position === item.id) && !c.is_write_in
    );
  };

  // ---- Render states ----

  if (loading) {
    return (
      <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br">
        <div className="text-center" role="status" aria-live="polite">
          <div className="mb-4 inline-block h-10 w-10 animate-spin rounded-full border-t-4 border-b-4 border-red-600"></div>
          <p className="text-theme-text-secondary">Loading your ballot...</p>
        </div>
      </div>
    );
  }

  if (error && !election) {
    return (
      <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br p-4">
        <div className="bg-theme-surface w-full max-w-md rounded-lg p-8 text-center shadow-lg">
          <div className="mb-4 text-5xl text-red-600">!</div>
          <h1 className="text-theme-text-primary mb-2 text-xl font-bold">Unable to Load Ballot</h1>
          <p className="text-theme-text-secondary">{error}</p>
          <p className="text-theme-text-muted mt-4 text-sm">
            If you believe this is an error, please contact your organization secretary.
          </p>
        </div>
      </div>
    );
  }

  if (submitted && submitResult) {
    return (
      <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br p-4">
        <div className="bg-theme-surface w-full max-w-md rounded-lg p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/20">
            <svg
              className="h-8 w-8 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-theme-text-primary mb-2 text-2xl font-bold">Ballot Submitted</h1>
          <p className="text-theme-text-secondary mb-4">{submitResult.message}</p>
          <div className="bg-theme-surface-secondary text-theme-text-muted rounded-lg p-4 text-sm">
            <p>Your ballot has been recorded securely and anonymously.</p>
            {submitResult.receipt_hashes && submitResult.receipt_hashes.length > 0 && (
              <div className="border-theme-surface-border mt-3 border-t pt-3">
                <p className="text-theme-text-secondary mb-1 font-medium">Vote Receipt</p>
                <p className="mb-2 text-xs">
                  Save this receipt to verify your vote was counted. It cannot reveal how you voted.
                </p>
                {submitResult.receipt_hashes.map((hash, i) => (
                  <code key={i} className="bg-theme-surface mb-1 block rounded px-2 py-1 font-mono text-xs break-all">
                    {hash}
                  </code>
                ))}
              </div>
            )}
            <p className="mt-2">You may close this page.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!election) return null;

  const ballotItems = election.ballot_items || [];

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to min-h-screen bg-linear-to-br">
      {/* Header */}
      <div className="bg-red-700 text-white">
        <div className="mx-auto max-w-2xl px-4 py-8 text-center">
          <h1 className="text-2xl font-bold">{election.title}</h1>
          {election.description && <p className="mt-2 text-red-100">{election.description}</p>}
          {election.meeting_date && (
            <p className="mt-1 text-sm text-red-200">Meeting Date: {formatDate(election.meeting_date, tz)}</p>
          )}
        </div>
      </div>

      {/* Ballot Content */}
      <div className="mx-auto max-w-2xl px-4 py-8">
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="mb-6">
          <p className="text-theme-text-secondary text-sm">
            Please review each item below and make your selection. You may vote for the presented option, write in an
            alternative, or abstain from voting on any item.
          </p>
        </div>

        {/* Ballot Items */}
        <div className="space-y-6">
          {ballotItems.map((item, index) => {
            const itemChoice = choices[item.id];
            const itemCandidates = getCandidatesForItem(item);
            const isApprovalType = item.vote_type === VoteType.APPROVAL;
            // Items may override the election-level method (mirrors backend)
            const effectiveMethod = item.voting_method ?? election.voting_method;
            const maxVotes = election.max_votes_per_position || 1;
            const isRanked = !isApprovalType && effectiveMethod === 'ranked_choice';
            const isMultiSelect = !isApprovalType && !isRanked && (effectiveMethod === 'approval' || maxVotes > 1);
            // Approval-method items have no selection cap; multi-vote items do
            const selectionCap = effectiveMethod === 'approval' ? null : maxVotes;
            const atCap =
              isMultiSelect && selectionCap !== null && (itemChoice?.candidate_ids.length ?? 0) >= selectionCap;

            return (
              <div
                key={item.id}
                className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-lg border shadow-xs"
              >
                {/* Item Header */}
                <div className="bg-theme-surface-secondary border-theme-surface-border border-b px-6 py-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-sm font-bold text-red-700 dark:bg-red-500/20 dark:text-red-400">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="text-theme-text-primary font-semibold">{item.title}</h3>
                      {item.description && <p className="text-theme-text-muted mt-1 text-sm">{item.description}</p>}
                    </div>
                  </div>
                </div>

                {/* Voting Options */}
                <fieldset className="space-y-3 px-6 py-4">
                  <legend className="sr-only">Voting options for {item.title}</legend>
                  {isApprovalType ? (
                    <>
                      {/* Approve */}
                      <label className="border-theme-surface-border flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:border-green-300 hover:bg-green-50 dark:hover:bg-green-500/10">
                        <input
                          type="radio"
                          name={`item-${item.id}`}
                          checked={itemChoice?.choice === BallotChoice.APPROVE}
                          onChange={() => updateChoice(item.id, BallotChoice.APPROVE)}
                          className="focus:ring-theme-focus-ring h-4 w-4 text-green-600"
                        />
                        <span className="text-theme-text-primary font-medium">Approve</span>
                      </label>

                      {/* Deny */}
                      <label className="border-theme-surface-border flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-500/10">
                        <input
                          type="radio"
                          name={`item-${item.id}`}
                          checked={itemChoice?.choice === BallotChoice.DENY}
                          onChange={() => updateChoice(item.id, BallotChoice.DENY)}
                          className="focus:ring-theme-focus-ring h-4 w-4 text-blue-600"
                        />
                        <span className="text-theme-text-primary font-medium">Deny</span>
                      </label>
                    </>
                  ) : isRanked ? (
                    <>
                      {/* Ranked choice: assign a unique rank per candidate */}
                      <p className="text-theme-text-muted text-xs">
                        Rank the candidates in order of preference (1 = first choice). Leave a candidate unranked to
                        exclude them.
                      </p>
                      {itemCandidates.map((candidate) => {
                        const currentRank = itemChoice?.ranks[candidate.id];
                        return (
                          <div
                            key={candidate.id}
                            className="border-theme-surface-border flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/10"
                          >
                            <select
                              value={currentRank ?? ''}
                              onChange={(e) =>
                                setCandidateRank(item.id, candidate.id, e.target.value ? Number(e.target.value) : null)
                              }
                              aria-label={`Rank for ${candidate.name}`}
                              className="form-input-sm w-16"
                            >
                              <option value="">—</option>
                              {itemCandidates.map((_, rankIdx) => (
                                <option key={rankIdx + 1} value={rankIdx + 1}>
                                  {rankIdx + 1}
                                </option>
                              ))}
                            </select>
                            <div>
                              <span className="text-theme-text-primary font-medium">{candidate.name}</span>
                              {candidate.statement && (
                                <p className="text-theme-text-muted mt-0.5 text-sm">{candidate.statement}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  ) : isMultiSelect ? (
                    <>
                      {/* Approval / multi-vote: select every candidate you support */}
                      <p className="text-theme-text-muted text-xs">
                        {selectionCap === null
                          ? 'Select every candidate you approve of.'
                          : `Select up to ${selectionCap} candidates.`}
                      </p>
                      {itemCandidates.map((candidate) => {
                        const isChecked = itemChoice?.candidate_ids.includes(candidate.id) ?? false;
                        const disabled = !isChecked && atCap;
                        return (
                          <label
                            key={candidate.id}
                            className={`border-theme-surface-border flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                              disabled
                                ? 'cursor-not-allowed opacity-50'
                                : 'cursor-pointer hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/10'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={disabled}
                              onChange={() => toggleCandidate(item.id, candidate.id, selectionCap)}
                              className="focus:ring-theme-focus-ring h-4 w-4 rounded text-blue-600"
                            />
                            <div>
                              <span className="text-theme-text-primary font-medium">{candidate.name}</span>
                              {candidate.statement && (
                                <p className="text-theme-text-muted mt-0.5 text-sm">{candidate.statement}</p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </>
                  ) : (
                    <>
                      {/* Candidate Selection */}
                      {itemCandidates.map((candidate) => (
                        <label
                          key={candidate.id}
                          className="border-theme-surface-border flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/10"
                        >
                          <input
                            type="radio"
                            name={`item-${item.id}`}
                            checked={itemChoice?.choice === candidate.id}
                            onChange={() => updateChoice(item.id, candidate.id)}
                            className="focus:ring-theme-focus-ring h-4 w-4 text-blue-600"
                          />
                          <div>
                            <span className="text-theme-text-primary font-medium">{candidate.name}</span>
                            {candidate.statement && (
                              <p className="text-theme-text-muted mt-0.5 text-sm">{candidate.statement}</p>
                            )}
                          </div>
                        </label>
                      ))}
                    </>
                  )}

                  {/* Write-in option */}
                  {election.allow_write_ins && (
                    <div
                      className={`rounded-lg border p-3 transition-colors ${
                        itemChoice?.choice === BallotChoice.WRITE_IN
                          ? 'border-purple-300 bg-purple-50 dark:border-purple-500/30 dark:bg-purple-500/10'
                          : 'border-theme-surface-border hover:border-purple-300 hover:bg-purple-50 dark:hover:bg-purple-500/10'
                      }`}
                    >
                      <label className="flex cursor-pointer items-center gap-3">
                        <input
                          type="radio"
                          name={`item-${item.id}`}
                          checked={itemChoice?.choice === BallotChoice.WRITE_IN}
                          onChange={() => updateChoice(item.id, BallotChoice.WRITE_IN)}
                          className="focus:ring-theme-focus-ring h-4 w-4 text-purple-600"
                        />
                        <span className="text-theme-text-primary font-medium">Write-in</span>
                      </label>
                      {itemChoice?.choice === BallotChoice.WRITE_IN && (
                        <input
                          type="text"
                          value={itemChoice.write_in_name}
                          onChange={(e) => updateWriteInName(item.id, e.target.value)}
                          placeholder="Enter name or option..."
                          aria-label="Enter name or option"
                          className="form-input mt-2 ml-7 w-[calc(100%-1.75rem)] shadow-xs"
                          autoFocus
                        />
                      )}
                    </div>
                  )}

                  {/* Abstain */}
                  <label className="border-theme-surface-border hover:bg-theme-surface-hover flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors">
                    <input
                      type="radio"
                      name={`item-${item.id}`}
                      checked={itemChoice?.choice === BallotChoice.ABSTAIN}
                      onChange={() => updateChoice(item.id, BallotChoice.ABSTAIN)}
                      className="text-theme-text-muted focus:ring-theme-focus-ring h-4 w-4"
                    />
                    <span className="text-theme-text-muted">Abstain (Do not vote on this item)</span>
                  </label>
                </fieldset>
              </div>
            );
          })}
        </div>

        {/* Submit Button */}
        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={handleSubmitBallot}
            className="rounded-lg bg-red-700 px-8 py-3 text-lg font-semibold text-white shadow-lg transition-colors hover:bg-red-800"
          >
            Submit Ballot
          </button>
          <p className="text-theme-text-muted mt-2 text-sm">
            You will have a chance to review your choices before they are submitted.
          </p>
        </div>

        {/* Security notice */}
        <div className="text-theme-text-muted mt-8 text-center text-xs">
          <p>Your vote is anonymous and securely recorded.</p>
          <p>This voting link is unique to you. Do not share it with others.</p>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-ballot-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !submitting) setShowConfirmation(false);
          }}
        >
          <div className="bg-theme-surface-modal max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg shadow-xl">
            <div className="border-theme-surface-border bg-theme-surface-secondary border-b px-6 py-4">
              <h3 id="confirm-ballot-title" className="text-theme-text-primary text-lg font-bold">
                Confirm Your Ballot
              </h3>
              <p className="text-theme-text-muted mt-1 text-sm">
                Please review your selections below. Once submitted, your ballot cannot be changed.
              </p>
            </div>

            <div className="px-6 py-4">
              <div className="space-y-4">
                {ballotItems.map((item, index) => {
                  const label = getChoiceLabel(item.id);
                  const isAbstain = label.startsWith('Abstain');

                  return (
                    <div
                      key={item.id}
                      className={`flex items-start gap-3 rounded-lg p-3 ${
                        isAbstain ? 'bg-theme-surface-secondary' : 'bg-blue-50 dark:bg-blue-500/10'
                      }`}
                    >
                      <span className="bg-theme-surface-secondary text-theme-text-secondary flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                        {index + 1}
                      </span>
                      <div className="flex-1">
                        <div className="text-theme-text-primary text-sm font-medium">{item.title}</div>
                        <div
                          className={`mt-0.5 text-sm font-semibold ${
                            isAbstain
                              ? 'text-theme-text-muted'
                              : choices[item.id]?.choice === BallotChoice.APPROVE
                                ? 'text-green-700'
                                : choices[item.id]?.choice === BallotChoice.DENY
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

            <div className="border-theme-surface-border bg-theme-surface-secondary flex flex-wrap justify-between gap-2 border-t px-6 py-4">
              <button
                type="button"
                onClick={() => setShowConfirmation(false)}
                disabled={submitting}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-md border px-4 py-2 disabled:opacity-50"
              >
                Change Ballot
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleConfirmSubmit();
                }}
                disabled={submitting}
                className="rounded-md bg-red-700 px-6 py-2 font-semibold text-white hover:bg-red-800 disabled:opacity-50"
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
