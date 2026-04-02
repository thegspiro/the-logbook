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

const BallotPreviewModal: React.FC<BallotPreviewModalProps> = ({
  election,
  candidates,
  onClose,
  timezone,
}) => {
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  const getPreviewCandidatesForItem = (item: BallotItem): Candidate[] => {
    if (item.position) {
      return candidates.filter((c) => c.position === item.position && !c.is_write_in);
    }
    return candidates.filter(
      (c) => c.position && item.title.includes(c.position) && !c.is_write_in,
    );
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ballot-preview-title"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-theme-surface-secondary rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 z-10 bg-amber-500 text-amber-900 px-4 py-2 text-center text-sm font-bold">
          BALLOT PREVIEW — This is how voters will see the ballot
        </div>

        <div className="bg-red-700 text-white">
          <div className="px-6 py-6 text-center">
            <h3 id="ballot-preview-title" className="text-xl font-bold">{election.title}</h3>
            {election.description && (
              <p className="mt-2 text-red-100">{election.description}</p>
            )}
            {election.meeting_date && (
              <p className="mt-1 text-red-200 text-sm">
                Meeting Date: {formatDate(election.meeting_date, timezone)}
              </p>
            )}
          </div>
        </div>

        <div className="px-6 pt-6">
          <p className="text-theme-text-secondary text-sm">
            Please review each item below and make your selection. You may vote for the
            presented option, write in an alternative, or abstain from voting on any item.
          </p>
        </div>

        <div className="px-6 py-6 space-y-6">
          {(election.ballot_items || []).length === 0 ? (
            <div className="text-center py-8 text-theme-text-muted">
              No ballot items have been added yet.
            </div>
          ) : (
            (election.ballot_items || []).map((item, index) => {
              const itemCandidates = getPreviewCandidatesForItem(item);
              const isApprovalType = item.vote_type === VoteType.APPROVAL;

              return (
                <div
                  key={item.id}
                  className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden"
                >
                  <div className="bg-theme-surface-secondary px-6 py-4 border-b border-theme-surface-border">
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-8 h-8 bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400 rounded-full flex items-center justify-center text-sm font-bold">
                        {index + 1}
                      </span>
                      <div>
                        <h4 className="font-semibold text-theme-text-primary">{item.title}</h4>
                        {item.description && (
                          <p className="mt-1 text-sm text-theme-text-muted">{item.description}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <fieldset className="px-6 py-4 space-y-3">
                    <legend className="sr-only">Voting options for {item.title}</legend>
                    {isApprovalType ? (
                      <>
                        {itemCandidates.length > 0 && (
                          <div className="mb-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30">
                            <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-1.5">
                              {item.type === BallotItemType.MEMBERSHIP_APPROVAL ? 'Prospective Member' : 'Candidate'}{itemCandidates.length !== 1 ? 's' : ''}:
                            </p>
                            {itemCandidates.map((candidate) => (
                              <div key={candidate.id} className="flex items-center gap-2 py-1">
                                <span className="font-medium text-theme-text-primary text-sm">{candidate.name}</span>
                                {candidate.statement && (
                                  <span className="text-xs text-theme-text-muted">— {candidate.statement}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-3 p-3 rounded-lg border border-theme-surface-border">
                          <input type="radio" disabled className="w-4 h-4 text-green-600" aria-label="Approve" />
                          <span className="font-medium text-theme-text-primary">Approve</span>
                        </div>
                        <div className="flex items-center gap-3 p-3 rounded-lg border border-theme-surface-border">
                          <input type="radio" disabled className="w-4 h-4 text-red-600" aria-label="Deny" />
                          <span className="font-medium text-theme-text-primary">Deny</span>
                        </div>
                      </>
                    ) : (
                      <>
                        {itemCandidates.length > 0 ? (
                          itemCandidates.map((candidate) => (
                            <div key={candidate.id} className="flex items-center gap-3 p-3 rounded-lg border border-theme-surface-border">
                              <input type="radio" disabled className="w-4 h-4 text-blue-600" aria-label={candidate.name} />
                              <div>
                                <span className="font-medium text-theme-text-primary">{candidate.name}</span>
                                {candidate.statement && (
                                  <p className="text-sm text-theme-text-muted mt-0.5">{candidate.statement}</p>
                                )}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-sm">
                            No candidates added for this position yet.
                          </div>
                        )}
                      </>
                    )}

                    {election.allow_write_ins && (
                      <div className="p-3 rounded-lg border border-theme-surface-border">
                        <div className="flex items-center gap-3">
                          <input type="radio" disabled className="w-4 h-4 text-purple-600" aria-label="Write-in" />
                          <span className="font-medium text-theme-text-primary">Write-in</span>
                        </div>
                        <input
                          type="text"
                          disabled
                          placeholder="Enter name or option..."
                          className="mt-2 ml-7 block w-[calc(100%-1.75rem)] border border-theme-surface-border rounded-md py-2 px-3 text-sm bg-theme-input-bg text-theme-text-muted opacity-50 cursor-not-allowed"
                        />
                      </div>
                    )}

                    <div className="flex items-center gap-3 p-3 rounded-lg border border-theme-surface-border">
                      <input type="radio" disabled className="w-4 h-4 text-theme-text-muted" aria-label="Abstain" />
                      <span className="text-theme-text-muted">Abstain (Do not vote on this item)</span>
                    </div>
                  </fieldset>

                  <div className="px-6 py-2 bg-theme-surface-secondary border-t border-theme-surface-border flex flex-wrap gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-sm bg-theme-surface-hover text-theme-text-muted">
                      {item.type?.replace('_', ' ')}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-sm bg-theme-surface-hover text-theme-text-muted">
                      {isApprovalType ? 'Yes/No vote' : 'Candidate selection'}
                    </span>
                    {item.require_attendance && (
                      <span className="text-xs px-2 py-0.5 rounded-sm bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400">
                        Requires attendance
                      </span>
                    )}
                    {item.eligible_voter_types && !item.eligible_voter_types.includes('all') && (
                      <span className="text-xs px-2 py-0.5 rounded-sm bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
                        Restricted: {item.eligible_voter_types.join(', ')}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {(election.ballot_items || []).length > 0 && (
            <div className="text-center pt-4">
              <button
                type="button"
                disabled
                className="px-8 py-3 bg-red-700 text-white text-lg font-semibold rounded-lg opacity-50 cursor-not-allowed"
              >
                Submit Ballot
              </button>
              <p className="mt-2 text-sm text-theme-text-muted">
                You will have a chance to review your choices before they are submitted.
              </p>
            </div>
          )}

          <div className="mt-6 text-center text-xs text-theme-text-muted">
            <p>Your vote is anonymous and securely recorded.</p>
            <p>This voting link is unique to you. Do not share it with others.</p>
          </div>
        </div>

        <div className="px-6 py-4 bg-theme-surface border-t border-theme-surface-border">
          <h4 className="text-xs font-semibold text-theme-text-muted uppercase tracking-wider mb-2">Election Details</h4>
          <div className="flex flex-wrap gap-2">
            <span className="text-xs px-2 py-1 rounded-sm bg-theme-surface-hover text-theme-text-secondary">
              {election.voting_method?.replace(/_/g, ' ')}
            </span>
            <span className="text-xs px-2 py-1 rounded-sm bg-theme-surface-hover text-theme-text-secondary">
              {election.victory_condition?.replace(/_/g, ' ')}
              {election.victory_percentage ? ` (${election.victory_percentage}%)` : ''}
            </span>
            {election.anonymous_voting && (
              <span className="text-xs px-2 py-1 rounded-sm bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400">
                Anonymous
              </span>
            )}
            {election.allow_write_ins && (
              <span className="text-xs px-2 py-1 rounded-sm bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400">
                Write-ins allowed
              </span>
            )}
            {election.quorum_type && election.quorum_type !== 'none' && (
              <span className="text-xs px-2 py-1 rounded-sm bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
                Quorum: {election.quorum_value}{election.quorum_type === 'percentage' ? '%' : ' members'}
              </span>
            )}
            {election.positions && election.positions.length > 0 && (
              <span className="text-xs px-2 py-1 rounded-sm bg-theme-surface-hover text-theme-text-secondary">
                {election.positions.length} position{election.positions.length !== 1 ? 's' : ''}: {election.positions.join(', ')}
              </span>
            )}
            <span className="text-xs px-2 py-1 rounded-sm bg-theme-surface-hover text-theme-text-secondary">
              {candidates.length} candidate{candidates.length !== 1 ? 's' : ''} total
            </span>
          </div>
        </div>

        <div className="sticky bottom-0 bg-theme-surface-secondary border-t border-theme-surface-border px-6 py-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 bg-theme-surface-secondary text-theme-text-primary border border-theme-surface-border rounded-md hover:bg-theme-surface-hover"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
};

export default BallotPreviewModal;
