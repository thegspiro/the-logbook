import React, { useCallback, useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import type { BallotItem, Candidate } from '../../types/election';
import { ballotItemTitlesById, candidateContestLabel, isRankedContest } from '../../utils/electionHelpers';

export interface RankedPaperBallotEntry {
  /** Candidate ids, first choice first. */
  rankings: string[];
  /** How many identical paper ballots this line stands for. */
  count: number;
}

interface RankedBallotLine extends RankedPaperBallotEntry {
  key: string;
  position: string;
}

interface RecordPaperBallotsModalProps {
  candidates: Candidate[];
  // Names the contest of an item's Approve/Deny row by the item's title
  // rather than its raw id (W50-30), and decides which contests are ranked.
  ballotItems?: BallotItem[] | undefined;
  // The election's own method; a ballot item may override it per contest.
  votingMethod?: string | undefined;
  recording: boolean;
  error: string | null;
  attestationsRequired?: number;
  onSubmit: (
    entries: Array<{ candidate_id: string; count: number }>,
    rankedBallots: RankedPaperBallotEntry[],
    notes: string,
    allowOverCount: boolean,
    ballotsCast: number | undefined
  ) => void;
  onClose: () => void;
}

const ordinal = (n: number): string => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

/**
 * Bulk entry of an in-room paper-ballot tally. A single-choice or approval
 * contest takes one count per candidate. A ranked-choice contest is entered
 * ballot by ballot instead — instant runoff needs each ballot's order, which
 * a total cannot carry, so the server refuses totals for it. Identical
 * ballots are entered once with a copy count.
 */
const RecordPaperBallotsModal: React.FC<RecordPaperBallotsModalProps> = ({
  candidates,
  ballotItems,
  votingMethod,
  recording,
  error,
  attestationsRequired = 0,
  onSubmit,
  onClose,
}) => {
  const dialogRef = useDialog<HTMLDivElement>({ onClose });

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [allowOverCount, setAllowOverCount] = useState(false);
  const [ballotsCastInput, setBallotsCastInput] = useState('');

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  // Per ranked contest: the choices picked so far for the ballot being
  // entered, and its copy count.
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [draftCopies, setDraftCopies] = useState<Record<string, string>>({});
  const [rankedLines, setRankedLines] = useState<RankedBallotLine[]>([]);

  const itemTitles = ballotItemTitlesById(ballotItems);
  const isRanked = (candidate: Candidate): boolean => isRankedContest(candidate.position, ballotItems, votingMethod);
  const totalsCandidates = candidates.filter((c) => !isRanked(c));
  const rankedContests = [...new Set(candidates.filter(isRanked).map((c) => c.position ?? ''))];
  const candidateName = (id: string): string => candidates.find((c) => c.id === id)?.name ?? id;

  const entries = totalsCandidates
    .map((c) => ({ candidate_id: c.id, count: parseInt(counts[c.id] ?? '', 10) }))
    .filter((e) => Number.isFinite(e.count) && e.count > 0);
  const total = entries.reduce((sum, e) => sum + e.count, 0) + rankedLines.reduce((sum, line) => sum + line.count, 0);

  const chooseRank = (position: string, slot: number, candidateId: string) => {
    const current = drafts[position] ?? [];
    // Choices stay contiguous: clearing a slot drops the ones after it, and
    // picking a candidate already chosen further down moves them up here.
    const next = candidateId
      ? [...current.slice(0, slot), candidateId, ...current.slice(slot + 1).filter((id) => id !== candidateId)]
      : current.slice(0, slot);
    setDrafts({ ...drafts, [position]: next });
  };

  const addBallot = (position: string) => {
    const rankings = drafts[position] ?? [];
    const copies = parseInt(draftCopies[position] ?? '1', 10);
    if (rankings.length === 0 || !Number.isFinite(copies) || copies < 1) return;
    setRankedLines([
      ...rankedLines,
      { key: `${position}-${Date.now()}-${rankedLines.length}`, position, rankings, count: copies },
    ]);
    setDrafts({ ...drafts, [position]: [] });
    setDraftCopies({ ...draftCopies, [position]: '1' });
  };
  // Optional; blank stays undefined so the key is omitted from the payload
  // and turnout falls back to the tally-derived estimate.
  const parsedBallotsCast = parseInt(ballotsCastInput, 10);
  const ballotsCast = Number.isFinite(parsedBallotsCast) && parsedBallotsCast > 0 ? parsedBallotsCast : undefined;

  return (
    <div
      className="modal-overlay z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paper-ballots-title"
      onKeyDown={handleKeyDown}
    >
      <div ref={dialogRef} className="modal-panel modal-panel-scroll w-full max-w-md">
        <div className="border-theme-surface-border border-b px-6 py-4">
          <h3 id="paper-ballots-title" className="text-theme-text-primary text-lg font-medium">
            Record Paper Ballots
          </h3>
        </div>

        <div className="modal-body px-6 py-4">
          <p className="text-theme-text-secondary mb-4 text-sm">
            Enter the paper-ballot count for each candidate
            {rankedContests.length > 0 && ', and each ranked-choice ballot below'}. Each ballot is recorded as an
            individual vote attributed to you and covered by integrity verification.
            {attestationsRequired > 0 && (
              <>
                {' '}
                The batch will not count in results until {attestationsRequired} other officer
                {attestationsRequired !== 1 ? 's' : ''} attest
                {attestationsRequired === 1 ? 's' : ''} the tally.
              </>
            )}
          </p>

          {error && (
            <div
              className="mb-4 rounded-sm border border-red-500/30 bg-red-500/10 p-3"
              role="alert"
              aria-live="assertive"
            >
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {rankedContests.map((position) => {
            const contestCandidates = candidates.filter((c) => c.position === position);
            const contestLabel = candidateContestLabel({ position }, itemTitles) ?? position;
            const chosen = drafts[position] ?? [];
            const slots = Math.min(chosen.length + 1, contestCandidates.length);
            const lines = rankedLines.filter((line) => line.position === position);
            return (
              <section
                key={position}
                aria-labelledby={`ranked-heading-${position}`}
                className="border-theme-surface-border mb-4 rounded-md border p-3"
              >
                <h4 id={`ranked-heading-${position}`} className="text-theme-text-primary text-sm font-medium">
                  {contestLabel} — ranked choice
                </h4>
                <p className="text-theme-text-muted mt-0.5 mb-3 text-xs">
                  Enter each ballot&apos;s choices in order. Enter identical ballots once and set the number of copies.
                </p>

                {lines.length > 0 && (
                  <ul className="mb-3 space-y-1" aria-label={`Ballots entered for ${contestLabel}`}>
                    {lines.map((line) => (
                      <li key={line.key} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-theme-text-primary">
                          {line.rankings.map((id, i) => `${i + 1}. ${candidateName(id)}`).join('  ')}
                          <span className="text-theme-text-muted"> × {line.count}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setRankedLines(rankedLines.filter((other) => other.key !== line.key))}
                          className="text-theme-text-secondary hover:text-theme-text-primary touch:min-h-11 text-xs underline"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="space-y-2">
                  {Array.from({ length: slots }, (_, slot) => {
                    const taken = new Set(chosen.slice(0, slot));
                    const selectId = `rank-${position}-${slot}`;
                    return (
                      <div key={slot} className="flex items-center justify-between gap-3">
                        <label htmlFor={selectId} className="text-theme-text-secondary text-sm">
                          {ordinal(slot + 1)} choice <span className="sr-only">for {contestLabel}</span>
                        </label>
                        <select
                          id={selectId}
                          value={chosen[slot] ?? ''}
                          onChange={(e) => chooseRank(position, slot, e.target.value)}
                          className="form-input-sm w-48"
                        >
                          <option value="">{slot === 0 ? 'Choose…' : '— none —'}</option>
                          {contestCandidates
                            .filter((c) => !taken.has(c.id))
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor={`copies-${position}`} className="text-theme-text-secondary text-sm">
                      Identical ballots <span className="sr-only">for {contestLabel}</span>
                    </label>
                    <input
                      id={`copies-${position}`}
                      type="number"
                      min={1}
                      max={500}
                      value={draftCopies[position] ?? '1'}
                      onChange={(e) => setDraftCopies({ ...draftCopies, [position]: e.target.value })}
                      className="form-input-sm w-24 text-right"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => addBallot(position)}
                    disabled={chosen.length === 0}
                    className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover w-full rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    Add ballot <span className="sr-only">for {contestLabel}</span>
                  </button>
                </div>
              </section>
            );
          })}

          <div className="space-y-3">
            {totalsCandidates.map((candidate) => (
              <div key={candidate.id} className="flex items-center justify-between gap-3">
                <label htmlFor={`paper-count-${candidate.id}`} className="text-theme-text-primary text-sm">
                  {candidate.name}
                  {candidate.position && (
                    <>
                      {' '}
                      <span className="text-theme-text-muted text-xs">
                        ({candidateContestLabel(candidate, itemTitles)})
                      </span>
                    </>
                  )}
                </label>
                <input
                  id={`paper-count-${candidate.id}`}
                  type="number"
                  min={0}
                  max={500}
                  value={counts[candidate.id] ?? ''}
                  onChange={(e) => setCounts({ ...counts, [candidate.id]: e.target.value })}
                  placeholder="0"
                  className="form-input-sm w-24 text-right"
                />
              </div>
            ))}
          </div>

          <div className="mt-4">
            <label htmlFor="paper-ballots-cast" className="text-theme-text-secondary block text-sm font-medium">
              Physical ballots in this stack <span className="text-theme-text-muted text-xs">(optional)</span>
            </label>
            <p className="text-theme-text-muted mt-0.5 text-xs">
              For ballots that select multiple candidates (approval or ranked voting), this count is what turnout and
              quorum are measured against — without it a conservative estimate is used.
            </p>
            <input
              id="paper-ballots-cast"
              type="number"
              min={1}
              max={2000}
              value={ballotsCastInput}
              onChange={(e) => setBallotsCastInput(e.target.value)}
              placeholder="e.g. 42"
              className="form-input-sm mt-1 w-28 text-right"
            />
          </div>

          <div className="mt-4">
            <label htmlFor="paper-notes" className="text-theme-text-secondary block text-sm font-medium">
              Notes <span className="text-theme-text-muted text-xs">(optional)</span>
            </label>
            <textarea
              id="paper-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. Paper ballots collected at the March business meeting"
              className="form-input mt-1 shadow-xs"
            />
          </div>

          {error && error.includes('over-count') && (
            <label className="mt-4 flex items-center gap-2">
              <input
                type="checkbox"
                checked={allowOverCount}
                onChange={(e) => setAllowOverCount(e.target.checked)}
                className="form-checkbox"
              />
              <span className="text-theme-text-secondary text-sm">
                The tally is correct — override the eligible-voter count check
              </span>
            </label>
          )}

          <div className="mt-6 flex items-center justify-between">
            <span className="text-theme-text-muted text-sm" aria-live="polite">
              Total: {total} ballot{total !== 1 ? 's' : ''}
            </span>
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={onClose}
                disabled={recording}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-md border px-4 py-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  onSubmit(
                    entries,
                    rankedLines.map(({ rankings, count }) => ({ rankings, count })),
                    notes,
                    allowOverCount,
                    ballotsCast
                  )
                }
                disabled={recording || total === 0}
                className="btn-primary rounded-md disabled:opacity-50"
              >
                {recording ? 'Recording…' : `Record ${total} Ballot${total !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecordPaperBallotsModal;
