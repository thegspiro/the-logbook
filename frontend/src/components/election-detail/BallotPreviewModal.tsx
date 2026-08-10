import React, { useCallback } from 'react';
import type { Election, Candidate, BallotItem } from '../../types/election';
import { VoteType, BallotItemType } from '../../constants/enums';
import { formatDate } from '../../utils/dateFormatting';

interface BallotPreviewModalProps {
  election: Election;
  candidates: Candidate[];
  onClose: () => void;
  timezone: string;
}

const BallotPreviewModal: React.FC<BallotPreviewModalProps> = ({ election, candidates, onClose, timezone }) => {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  const getPreviewCandidatesForItem = (item: BallotItem): Candidate[] => {
    if (item.position) {
      return candidates.filter((c) => c.position === item.position && !c.is_write_in);
    }
    return candidates.filter((c) => c.position && item.title.includes(c.position) && !c.is_write_in);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ballot-preview-title"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-theme-surface-secondary max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-lg shadow-xl">
        <div className="sticky top-0 z-10 bg-amber-500 px-4 py-2 text-center text-sm font-bold text-amber-900">
          BALLOT PREVIEW — This is how voters will see the ballot
        </div>

        <div className="bg-red-700 text-white">
          <div className="px-6 py-6 text-center">
            <h3 id="ballot-preview-title" className="text-xl font-bold">
              {election.title}
            </h3>
            {election.description && <p className="mt-2 text-red-100">{election.description}</p>}
            {election.meeting_date && (
              <p className="mt-1 text-sm text-red-200">Meeting Date: {formatDate(election.meeting_date, timezone)}</p>
            )}
          </div>
        </div>

        <div className="px-6 pt-6">
          <p className="text-theme-text-secondary text-sm">
            Please review each item below and make your selection. You may vote for the presented option, write in an
            alternative, or abstain from voting on any item.
          </p>
        </div>

        <div className="space-y-6 px-6 py-6">
          {(election.ballot_items || []).length === 0 ? (
            <div className="text-theme-text-muted py-8 text-center">No ballot items have been added yet.</div>
          ) : (
            (election.ballot_items || []).map((item, index) => {
              const itemCandidates = getPreviewCandidatesForItem(item);
              const isApprovalType = item.vote_type === VoteType.APPROVAL;

              return (
                <div
                  key={item.id}
                  className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-lg border"
                >
                  <div className="bg-theme-surface-secondary border-theme-surface-border border-b px-6 py-4">
                    <div className="flex items-start gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-sm font-bold text-red-700 dark:bg-red-500/20 dark:text-red-400">
                        {index + 1}
                      </span>
                      <div>
                        <h4 className="text-theme-text-primary font-semibold">{item.title}</h4>
                        {item.description && <p className="text-theme-text-muted mt-1 text-sm">{item.description}</p>}
                      </div>
                    </div>
                  </div>

                  <fieldset className="space-y-3 px-6 py-4">
                    <legend className="sr-only">Voting options for {item.title}</legend>
                    {isApprovalType ? (
                      <>
                        {itemCandidates.length > 0 && (
                          <div className="mb-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-500/30 dark:bg-blue-500/10">
                            <p className="mb-1.5 text-xs font-medium text-blue-700 dark:text-blue-400">
                              {item.type === BallotItemType.MEMBERSHIP_APPROVAL ? 'Prospective Member' : 'Candidate'}
                              {itemCandidates.length !== 1 ? 's' : ''}:
                            </p>
                            {itemCandidates.map((candidate) => (
                              <div key={candidate.id} className="flex items-center gap-2 py-1">
                                <span className="text-theme-text-primary text-sm font-medium">{candidate.name}</span>
                                {candidate.statement && (
                                  <span className="text-theme-text-muted text-xs">— {candidate.statement}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="border-theme-surface-border flex items-center gap-3 rounded-lg border p-3">
                          <input type="radio" disabled className="h-4 w-4 text-green-600" aria-label="Approve" />
                          <span className="text-theme-text-primary font-medium">Approve</span>
                        </div>
                        <div className="border-theme-surface-border flex items-center gap-3 rounded-lg border p-3">
                          <input type="radio" disabled className="h-4 w-4 text-red-600" aria-label="Deny" />
                          <span className="text-theme-text-primary font-medium">Deny</span>
                        </div>
                      </>
                    ) : (
                      <>
                        {itemCandidates.length > 0 ? (
                          itemCandidates.map((candidate) => (
                            <div
                              key={candidate.id}
                              className="border-theme-surface-border flex items-center gap-3 rounded-lg border p-3"
                            >
                              <input
                                type="radio"
                                disabled
                                className="h-4 w-4 text-blue-600"
                                aria-label={candidate.name}
                              />
                              <div>
                                <span className="text-theme-text-primary font-medium">{candidate.name}</span>
                                {candidate.statement && (
                                  <p className="text-theme-text-muted mt-0.5 text-sm">{candidate.statement}</p>
                                )}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                            No candidates added for this position yet.
                          </div>
                        )}
                      </>
                    )}

                    {election.allow_write_ins && (
                      <div className="border-theme-surface-border rounded-lg border p-3">
                        <div className="flex items-center gap-3">
                          <input type="radio" disabled className="h-4 w-4 text-purple-600" aria-label="Write-in" />
                          <span className="text-theme-text-primary font-medium">Write-in</span>
                        </div>
                        <input
                          type="text"
                          disabled
                          placeholder="Enter name or option..."
                          className="form-input text-theme-text-muted mt-2 ml-7 w-[calc(100%-1.75rem)] cursor-not-allowed opacity-50"
                        />
                      </div>
                    )}

                    <div className="border-theme-surface-border flex items-center gap-3 rounded-lg border p-3">
                      <input type="radio" disabled className="text-theme-text-muted h-4 w-4" aria-label="Abstain" />
                      <span className="text-theme-text-muted">Abstain (Do not vote on this item)</span>
                    </div>
                  </fieldset>

                  <div className="bg-theme-surface-secondary border-theme-surface-border flex flex-wrap gap-2 border-t px-6 py-2">
                    <span className="bg-theme-surface-hover text-theme-text-muted rounded-sm px-2 py-0.5 text-xs">
                      {item.type?.replace('_', ' ')}
                    </span>
                    <span className="bg-theme-surface-hover text-theme-text-muted rounded-sm px-2 py-0.5 text-xs">
                      {isApprovalType ? 'Yes/No vote' : 'Candidate selection'}
                    </span>
                    {item.require_attendance && (
                      <span className="rounded-sm bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400">
                        Requires attendance
                      </span>
                    )}
                    {item.eligible_voter_types && !item.eligible_voter_types.includes('all') && (
                      <span className="rounded-sm bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
                        Restricted: {item.eligible_voter_types.join(', ')}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {(election.ballot_items || []).length > 0 && (
            <div className="pt-4 text-center">
              <button
                type="button"
                disabled
                className="cursor-not-allowed rounded-lg bg-red-700 px-8 py-3 text-lg font-semibold text-white opacity-50"
              >
                Submit Ballot
              </button>
              <p className="text-theme-text-muted mt-2 text-sm">
                You will have a chance to review your choices before they are submitted.
              </p>
            </div>
          )}

          <div className="text-theme-text-muted mt-6 text-center text-xs">
            <p>Your vote is anonymous and securely recorded.</p>
            <p>This voting link is unique to you. Do not share it with others.</p>
          </div>
        </div>

        <div className="bg-theme-surface border-theme-surface-border border-t px-6 py-4">
          <h4 className="text-theme-text-muted mb-2 text-xs font-semibold tracking-wider uppercase">
            Election Details
          </h4>
          <div className="flex flex-wrap gap-2">
            <span className="bg-theme-surface-hover text-theme-text-secondary rounded-sm px-2 py-1 text-xs">
              {election.voting_method?.replace(/_/g, ' ')}
            </span>
            <span className="bg-theme-surface-hover text-theme-text-secondary rounded-sm px-2 py-1 text-xs">
              {election.victory_condition?.replace(/_/g, ' ')}
              {election.victory_percentage ? ` (${election.victory_percentage}%)` : ''}
            </span>
            {election.anonymous_voting && (
              <span className="rounded-sm bg-green-100 px-2 py-1 text-xs text-green-700 dark:bg-green-500/20 dark:text-green-400">
                Anonymous
              </span>
            )}
            {election.allow_write_ins && (
              <span className="rounded-sm bg-purple-100 px-2 py-1 text-xs text-purple-700 dark:bg-purple-500/20 dark:text-purple-400">
                Write-ins allowed
              </span>
            )}
            {election.quorum_type && election.quorum_type !== 'none' && (
              <span className="rounded-sm bg-blue-100 px-2 py-1 text-xs text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
                Quorum: {election.quorum_value}
                {election.quorum_type === 'percentage' ? '%' : ' members'}
              </span>
            )}
            {election.positions && election.positions.length > 0 && (
              <span className="bg-theme-surface-hover text-theme-text-secondary rounded-sm px-2 py-1 text-xs">
                {election.positions.length} position{election.positions.length !== 1 ? 's' : ''}:{' '}
                {election.positions.join(', ')}
              </span>
            )}
            <span className="bg-theme-surface-hover text-theme-text-secondary rounded-sm px-2 py-1 text-xs">
              {candidates.length} candidate{candidates.length !== 1 ? 's' : ''} total
            </span>
          </div>
        </div>

        <div className="bg-theme-surface-secondary border-theme-surface-border sticky bottom-0 flex justify-end border-t px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="bg-theme-surface-secondary text-theme-text-primary border-theme-surface-border hover:bg-theme-surface-hover rounded-md border px-6 py-2"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
};

export default BallotPreviewModal;
