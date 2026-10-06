/**
 * One ballot item as a voter answers it — Approve/Deny, a single choice, a
 * multi-select up to the cap, or a ranking — with the write-in and Abstain
 * rows. Rendered by both the emailed ballot and the in-app Cast Vote tab, so
 * the two ask every question the same way.
 */

import React from 'react';
import type { BallotItem, Candidate } from '../../types/election';
import { BallotChoice } from '../../constants/enums';
import { itemForm, type BallotSettings, type ItemChoice } from './ballotChoices';

interface BallotItemCardProps {
  item: BallotItem;
  index: number;
  settings: BallotSettings;
  /** Candidates for this item only (see candidatesForItem). */
  candidates: Candidate[];
  choice: ItemChoice | undefined;
  onChoice: (itemId: string, choice: string) => void;
  onWriteInName: (itemId: string, name: string) => void;
  onToggleCandidate: (itemId: string, candidateId: string, cap: number | null) => void;
  onRank: (itemId: string, candidateId: string, rank: number | null) => void;
  /** Replaces the options, e.g. "You have already voted on this item". */
  closedNote?: React.ReactNode;
}

const CandidateText: React.FC<{ candidate: Candidate }> = ({ candidate }) => (
  <div>
    <span className="text-theme-text-primary font-medium">{candidate.name}</span>
    {candidate.statement && <p className="text-theme-text-muted mt-0.5 text-sm">{candidate.statement}</p>}
  </div>
);

export const BallotItemCard: React.FC<BallotItemCardProps> = ({
  item,
  index,
  settings,
  candidates,
  choice,
  onChoice,
  onWriteInName,
  onToggleCandidate,
  onRank,
  closedNote,
}) => {
  const { isApprovalType, isRanked, isMultiSelect, selectionCap } = itemForm(item, settings);
  const atCap = isMultiSelect && selectionCap !== null && (choice?.candidate_ids.length ?? 0) >= selectionCap;

  return (
    <div className="card overflow-hidden shadow-xs">
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

      {closedNote ? (
        <div className="px-6 py-4">{closedNote}</div>
      ) : (
        <fieldset className="space-y-3 px-6 py-4">
          <legend className="sr-only">Voting options for {item.title}</legend>
          {isApprovalType ? (
            <>
              <label className="border-theme-surface-border flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:border-green-300 hover:bg-green-50 dark:hover:bg-green-500/10">
                <input
                  type="radio"
                  name={`item-${item.id}`}
                  checked={choice?.choice === BallotChoice.APPROVE}
                  onChange={() => onChoice(item.id, BallotChoice.APPROVE)}
                  className="focus:ring-theme-focus-ring h-4 w-4 text-green-600"
                />
                <span className="text-theme-text-primary font-medium">Approve</span>
              </label>
              <label className="border-theme-surface-border flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-500/10">
                <input
                  type="radio"
                  name={`item-${item.id}`}
                  checked={choice?.choice === BallotChoice.DENY}
                  onChange={() => onChoice(item.id, BallotChoice.DENY)}
                  className="focus:ring-theme-focus-ring h-4 w-4 text-blue-600"
                />
                <span className="text-theme-text-primary font-medium">Deny</span>
              </label>
            </>
          ) : isRanked ? (
            <>
              <p className="text-theme-text-muted text-xs">
                Rank the candidates in order of preference (1 = first choice). Leave a candidate unranked to exclude
                them.
              </p>
              {candidates.map((candidate) => {
                const currentRank = choice?.ranks[candidate.id];
                return (
                  <div
                    key={candidate.id}
                    className="border-theme-surface-border flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/10"
                  >
                    <select
                      value={currentRank ?? ''}
                      onChange={(e) => onRank(item.id, candidate.id, e.target.value ? Number(e.target.value) : null)}
                      aria-label={`Rank for ${candidate.name}`}
                      className="form-input-sm w-16"
                    >
                      <option value="">—</option>
                      {candidates.map((_, rankIdx) => (
                        <option key={rankIdx + 1} value={rankIdx + 1}>
                          {rankIdx + 1}
                        </option>
                      ))}
                    </select>
                    <CandidateText candidate={candidate} />
                  </div>
                );
              })}
            </>
          ) : isMultiSelect ? (
            <>
              <p className="text-theme-text-muted text-xs">
                {selectionCap === null
                  ? 'Select every candidate you approve of.'
                  : `Select up to ${selectionCap} candidates.`}
              </p>
              {candidates.map((candidate) => {
                const isChecked = choice?.candidate_ids.includes(candidate.id) ?? false;
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
                      onChange={() => onToggleCandidate(item.id, candidate.id, selectionCap)}
                      className="focus:ring-theme-focus-ring h-4 w-4 rounded text-blue-600"
                    />
                    <CandidateText candidate={candidate} />
                  </label>
                );
              })}
            </>
          ) : (
            candidates.map((candidate) => (
              <label
                key={candidate.id}
                className="border-theme-surface-border flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/10"
              >
                <input
                  type="radio"
                  name={`item-${item.id}`}
                  checked={choice?.choice === candidate.id}
                  onChange={() => onChoice(item.id, candidate.id)}
                  className="focus:ring-theme-focus-ring h-4 w-4 text-blue-600"
                />
                <CandidateText candidate={candidate} />
              </label>
            ))
          )}

          {settings.allow_write_ins && (
            <div>
              {/* The bordered card is the label, as for every other option:
                  with only the inner row clickable the write-in target was
                  24px tall (W50-52). */}
              <label
                className={`mobile-touch-row cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                  choice?.choice === BallotChoice.WRITE_IN
                    ? 'border-purple-300 bg-purple-50 dark:border-purple-500/30 dark:bg-purple-500/10'
                    : 'border-theme-surface-border hover:border-purple-300 hover:bg-purple-50 dark:hover:bg-purple-500/10'
                }`}
              >
                <input
                  type="radio"
                  name={`item-${item.id}`}
                  checked={choice?.choice === BallotChoice.WRITE_IN}
                  onChange={() => onChoice(item.id, BallotChoice.WRITE_IN)}
                  className="focus:ring-theme-focus-ring h-4 w-4 text-purple-600"
                />
                <span className="text-theme-text-primary font-medium">Write-in</span>
              </label>
              {choice?.choice === BallotChoice.WRITE_IN && (
                <input
                  type="text"
                  value={choice.write_in_name}
                  onChange={(e) => onWriteInName(item.id, e.target.value)}
                  placeholder="Enter name or option..."
                  aria-label="Enter name or option"
                  className="form-input mt-2 ml-7 w-[calc(100%-1.75rem)] shadow-xs"
                  autoFocus
                />
              )}
            </div>
          )}

          <label className="border-theme-surface-border hover:bg-theme-surface-hover flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors">
            <input
              type="radio"
              name={`item-${item.id}`}
              checked={choice?.choice === BallotChoice.ABSTAIN}
              onChange={() => onChoice(item.id, BallotChoice.ABSTAIN)}
              className="text-theme-text-muted focus:ring-theme-focus-ring h-4 w-4"
            />
            <span className="text-theme-text-muted">Abstain (Do not vote on this item)</span>
          </label>
        </fieldset>
      )}
    </div>
  );
};
