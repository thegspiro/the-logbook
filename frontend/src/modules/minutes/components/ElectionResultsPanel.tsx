/**
 * Election results filed with a set of minutes.
 *
 * A filed result is a copy of the certified tally taken when it was imported,
 * not a live view of the election: the minutes are the permanent record and
 * the election can still be annotated or rolled back afterwards. A manager
 * files one from the list of closed elections while the minutes are a draft;
 * once the minutes are approved the filed results are part of what was
 * approved and are locked with it.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Trophy } from 'lucide-react';
import { Modal } from '../../../components/Modal';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { minutesService } from '../services/api';
import type {
  FiledCandidateResult,
  ImportableElection,
  MinutesElectionResult,
  FiledPositionResult,
} from '../types/minutes';

interface ElectionResultsPanelProps {
  minutesId: string;
  /**
   * A minutes manager. A result can be filed at any status: on a draft it is
   * part of the minutes, afterwards it is a dated addendum.
   */
  canFile: boolean;
  /** The minutes are still a draft, so a result filed on it can be taken back. */
  canRemoveDrafted: boolean;
}

const CandidateTable: React.FC<{ label: string | null; candidates: FiledCandidateResult[] }> = ({
  label,
  candidates,
}) => (
  <div className="mt-3">
    {label && <p className="text-theme-text-primary text-sm font-medium">{label}</p>}
    <div className="overflow-x-auto">
      <table className="mt-1 w-full text-sm">
        <caption className="sr-only">{label ? `Results for ${label}` : 'Results'}</caption>
        <thead>
          <tr className="text-theme-text-muted text-left text-xs uppercase">
            <th scope="col" className="py-1 pr-3">
              Candidate
            </th>
            <th scope="col" className="py-1 pr-3 text-right">
              Votes
            </th>
            <th scope="col" className="py-1 pr-3 text-right">
              %
            </th>
            <th scope="col" className="py-1">
              Outcome
            </th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate, i) => (
            <tr key={`${candidate.candidate_name}-${i}`} className="border-theme-surface-border border-t">
              <td className="text-theme-text-primary py-1 pr-3">{candidate.candidate_name}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{candidate.vote_count}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{candidate.percentage}%</td>
              <td className="py-1">
                {candidate.is_winner ? (
                  <span className="rounded-sm bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-500/20 dark:text-green-400">
                    Winner
                  </span>
                ) : candidate.is_tied ? (
                  <span className="rounded-sm bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-400">
                    Tied
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export const ElectionResultsPanel: React.FC<ElectionResultsPanelProps> = ({ minutesId, canFile, canRemoveDrafted }) => {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [results, setResults] = useState<MinutesElectionResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [elections, setElections] = useState<ImportableElection[] | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [filing, setFiling] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setResults(await minutesService.getElectionResults(minutesId));
    } catch {
      setResults([]);
    } finally {
      setLoaded(true);
    }
  }, [minutesId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openPicker = async () => {
    setShowPicker(true);
    setPickerError(null);
    try {
      setElections(await minutesService.getImportableElections(minutesId));
    } catch (err: unknown) {
      setElections([]);
      setPickerError(getErrorMessage(err, 'Could not load the closed elections'));
    }
  };

  const handleFile = async (election: ImportableElection) => {
    setFiling(election.id);
    try {
      await minutesService.fileElectionResult(minutesId, election.id);
      toast.success(`Filed the result of ${election.title}`);
      setShowPicker(false);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to file the election result'));
    } finally {
      setFiling(null);
    }
  };

  const handleRemove = async (result: MinutesElectionResult) => {
    const ok = await confirm({
      title: 'Remove this election result?',
      message: `${result.election_title} will no longer be part of these minutes. You can file it again from the closed elections.`,
      confirmLabel: 'Remove result',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    try {
      await minutesService.removeElectionResult(minutesId, result.id);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to remove the election result'));
    }
  };

  if (!loaded || (results.length === 0 && !canFile)) return null;

  return (
    <section
      className="bg-theme-surface mb-6 rounded-lg p-4 shadow-sm backdrop-blur-xs"
      aria-labelledby="election-results-heading"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id="election-results-heading"
          className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold"
        >
          <Trophy className="h-5 w-5" aria-hidden="true" />
          Election results
        </h2>
        {canFile && (
          <button
            type="button"
            onClick={() => {
              void openPicker();
            }}
            className="btn-secondary touch:min-h-11 text-sm"
          >
            File an election result
          </button>
        )}
      </div>

      {results.length === 0 && (
        <p className="text-theme-text-muted mt-2 text-xs italic">
          No election results filed. An election held at this meeting belongs here once it closes, even if it runs past
          the end of the meeting or the minutes have already been adopted.
        </p>
      )}

      <div className="mt-2 space-y-4">
        {results.map((result) => {
          const snapshot = result.snapshot;
          const contests: FiledPositionResult[] = snapshot.results_by_position ?? [];
          const others = snapshot.overall_results ?? [];
          return (
            <article key={result.id} className="border-theme-surface-border rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-theme-text-primary font-medium">
                    {result.election_title}
                    {result.is_addendum && (
                      <span className="ml-2 rounded-sm bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-400">
                        Addendum
                      </span>
                    )}
                  </h3>
                  <p className="text-theme-text-muted text-xs">
                    {result.election_closed_at ? `Closed ${formatDateTime(result.election_closed_at, tz)} · ` : ''}
                    Filed {formatDateTime(result.created_at, tz)}
                    {result.captured_by_name ? ` by ${result.captured_by_name}` : ''}
                  </p>
                </div>
                {canRemoveDrafted && !result.is_addendum && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleRemove(result);
                    }}
                    className="text-xs text-red-600 hover:text-red-700"
                  >
                    Remove
                  </button>
                )}
              </div>
              {result.is_addendum && (
                <p className="text-theme-text-muted mt-1 text-xs">
                  Filed after the minutes were circulated. It records the final result of an election held at this
                  meeting and is not part of the text that was adopted.
                </p>
              )}
              <p className="text-theme-text-secondary mt-2 text-xs">
                {[
                  snapshot.total_eligible_voters !== undefined ? `${snapshot.total_eligible_voters} eligible` : null,
                  snapshot.total_votes !== undefined ? `${snapshot.total_votes} ballots cast` : null,
                  snapshot.voter_turnout_percentage !== undefined
                    ? `${snapshot.voter_turnout_percentage}% turnout`
                    : null,
                  snapshot.quorum_detail
                    ? `Quorum: ${snapshot.quorum_detail}`
                    : snapshot.quorum_met === true
                      ? 'Quorum met'
                      : snapshot.quorum_met === false
                        ? 'Quorum NOT met'
                        : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {contests.map((contest) => (
                <CandidateTable
                  key={contest.position}
                  label={contest.label ?? contest.position}
                  candidates={contest.candidates}
                />
              ))}
              {others.length > 0 && (
                <CandidateTable label={contests.length > 0 ? 'Other candidates' : null} candidates={others} />
              )}
            </article>
          );
        })}
      </div>

      <Modal isOpen={showPicker} onClose={() => setShowPicker(false)} title="File an election result" size="lg">
        <p className="text-theme-text-secondary mb-3 text-sm">
          Only closed elections have a result to file. It is copied into these minutes as it stands now.
          {!canRemoveDrafted &&
            ' Because the minutes have been circulated, it is filed as a permanent, dated addendum.'}
        </p>
        {pickerError && (
          <p className="alert-danger mb-3 text-sm" role="alert">
            {pickerError}
          </p>
        )}
        {elections === null ? (
          <p className="text-theme-text-muted text-sm" role="status">
            Loading closed elections…
          </p>
        ) : elections.length === 0 ? (
          <p className="text-theme-text-muted text-sm">There are no closed elections to file.</p>
        ) : (
          <ul className="space-y-2">
            {elections.map((election) => (
              <li
                key={election.id}
                className="border-theme-surface-border flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="text-theme-text-primary truncate text-sm font-medium">
                    {election.title}
                    {election.linked_to_meeting && (
                      <span className="ml-2 rounded-sm bg-cyan-100 px-2 py-0.5 text-xs text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-400">
                        Held at this meeting
                      </span>
                    )}
                  </p>
                  <p className="text-theme-text-muted text-xs">
                    {election.closed_at ? `Closed ${formatDateTime(election.closed_at, tz)}` : 'Closed'}
                    {election.positions && election.positions.length > 0 ? ` · ${election.positions.join(', ')}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={election.already_imported || filing !== null}
                  onClick={() => {
                    void handleFile(election);
                  }}
                  className="btn-primary touch:min-h-11 shrink-0 text-sm"
                >
                  {election.already_imported ? 'Already filed' : filing === election.id ? 'Filing…' : 'File result'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </section>
  );
};

export default ElectionResultsPanel;
