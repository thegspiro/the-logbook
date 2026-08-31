/**
 * The finish, exceptions first.
 *
 * A crew that has just walked 130 items does not need to read 130 lines back.
 * What is still undecided is the handful that went wrong, so those are listed
 * and everything else is accounted for in a single line — which is also the
 * honest shape, because the long list is the one people scroll past.
 *
 * Ordered by what it costs to be wrong about: faults take a truck out of
 * service, unanswered items are a gap in the record that is still cheap to
 * close, restocks are a supply order. The unanswered block carries the jump
 * back, because the only useful action on an unanswered item is going to it.
 */

import { AlertTriangle, Check, PackageSearch } from 'lucide-react';
import React from 'react';

import { TruckMap } from './CheckSweep';
import { sweepSummary, type AnswerMap, type LapStop } from './checkLapModel';

export interface CheckFinishProps {
  stops: LapStop[];
  answers: AnswerMap;
  onJump: (index: number) => void;
  onSubmit: () => void;
  onBack: () => void;
  /** Who is submitting, and who it reaches. Named, because a check is a record. */
  submittingAs: string;
  goesTo?: string | undefined;
  /** Per-template: some departments will not take a check with gaps in it. */
  blockOnUnanswered?: boolean | undefined;
  submitting?: boolean | undefined;
  /**
   * The one note about the check rather than about an item.
   *
   * Here rather than on a stop, because it is written once and it is written
   * last — and because a note restored from a draft has to be visible before
   * it is submitted. Without it a crew can neither add one nor see the one
   * they are about to file.
   */
  overallNotes?: string | undefined;
  onOverallNotesChange?: ((next: string) => void) | undefined;
}

export const CheckFinish: React.FC<CheckFinishProps> = ({
  stops,
  answers,
  onJump,
  onSubmit,
  onBack,
  submittingAs,
  goesTo,
  blockOnUnanswered,
  submitting,
  overallNotes,
  onOverallNotesChange,
}) => {
  const summary = sweepSummary(stops, answers);
  const { faults, unanswered, restocks, goodCount, answeredCount, totalCount } = summary;
  const stopsNeedingALook = new Set([...faults, ...unanswered].map((e) => e.stopNumber)).size;
  const blocked = blockOnUnanswered === true && unanswered.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-slate-950">
      <div className="flex flex-col gap-2.5 bg-slate-900 px-3.5 pt-3 pb-3 text-white">
        <TruckMap stops={stops} answers={answers} current={-1} onJump={onJump} />
        <p data-testid="finish-tally" className="text-[12px] text-slate-300">
          <span className="font-mono tabular-nums">
            {answeredCount} of {totalCount}
          </span>{' '}
          answered
          {stopsNeedingALook > 0 &&
            ` · ${stopsNeedingALook} stop${stopsNeedingALook === 1 ? ' needs' : 's need'} a look`}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 scrollbar-thin flex-col gap-2.5 overflow-y-auto p-3.5">
        <p className="text-theme-text-muted text-[11px] font-bold tracking-[.06em] uppercase">
          {faults.length + unanswered.length + restocks.length > 0 ? 'Exceptions only' : 'Nothing to report'}
        </p>

        {faults.map((e) => (
          <div key={e.item.id} data-testid={`finish-fault-${e.item.id}`} className="alert-danger p-3">
            <p className="text-theme-alert-danger-title flex items-center gap-1.5 text-[15px] font-bold">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              Fault · {e.item.name}
            </p>
            <p className="text-theme-text-secondary mt-0.5 text-[13px]">
              Stop {e.stopNumber} · {e.stopName}
            </p>
          </div>
        ))}

        {unanswered.length > 0 && (
          <div data-testid="finish-unanswered" className="alert-warning p-3">
            <p className="text-theme-alert-warning-text text-[15px] font-bold">
              {unanswered.length} item{unanswered.length === 1 ? '' : 's'} not answered
            </p>
            <p className="text-theme-text-secondary mt-0.5 text-[13px]">
              {unanswered
                .slice(0, 3)
                .map((e) => e.item.name)
                .join(', ')}
              {unanswered.length > 3 ? ` +${unanswered.length - 3} more` : ''}
            </p>
            {/* One jump per stop, not per item: the crew is going back to a
                place, and three buttons to the same cabinet is three ways to
                say the same thing. */}
            <div className="mt-2 flex flex-wrap gap-2">
              {[...new Set(unanswered.map((e) => e.stopNumber))].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onJump(n - 1)}
                  className="border-theme-alert-warning-icon text-theme-alert-warning-text bg-theme-surface min-h-11 rounded-lg border px-3 text-[14px] font-bold"
                >
                  Go to stop {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {restocks.length > 0 && (
          <div data-testid="finish-restocks" className="alert-warning p-3">
            <p className="text-theme-alert-warning-text flex items-center gap-1.5 text-[15px] font-bold">
              <PackageSearch className="h-4 w-4 shrink-0" aria-hidden="true" />
              {restocks.length} restock line{restocks.length === 1 ? '' : 's'}
            </p>
            <p className="text-theme-text-secondary mt-0.5 text-[13px]">
              {restocks
                .map((e) => {
                  const par = e.item.expectedQuantity;
                  const found = answers[e.item.id]?.quantityFound;
                  const gap = typeof par === 'number' && found !== undefined ? par - found : null;
                  return gap === null ? e.item.name : `${e.item.name} −${gap}`;
                })
                .join(' · ')}
            </p>
          </div>
        )}

        {goodCount > 0 && (
          <div className="alert-success p-3">
            <p className="text-theme-alert-success-title flex items-start gap-1.5 text-[14px]">
              <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                The other <strong>{goodCount}</strong> item{goodCount === 1 ? ' was' : 's were'} good. They are on the
                record — you do not have to read them again.
              </span>
            </p>
          </div>
        )}

        {onOverallNotesChange && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sweep-overall-notes" className="form-label">
              Anything about the truck as a whole
            </label>
            <textarea
              id="sweep-overall-notes"
              data-testid="sweep-overall-notes"
              rows={3}
              value={overallNotes ?? ''}
              onChange={(event) => onOverallNotesChange(event.target.value)}
              className="form-input"
              placeholder="Optional — anything that is not about one item."
            />
          </div>
        )}
      </div>

      <div className="border-theme-surface-border bg-theme-surface action-bar-safe flex flex-col gap-2 border-t px-3.5 pt-3">
        <p className="text-theme-text-muted text-[12px]">
          Submitting as <span className="font-semibold">{submittingAs}</span>
          {goesTo ? ` · goes to ${goesTo}` : ''}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="btn-secondary min-h-14 w-[84px] shrink-0 text-[14px] font-bold"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting || blocked}
            className={`flex min-h-14 flex-1 items-center justify-center rounded-lg px-4 text-[17px] font-bold ${
              blocked
                ? 'text-theme-text-muted bg-theme-surface-secondary border-theme-surface-border cursor-not-allowed border'
                : 'btn-primary'
            }`}
          >
            {blocked
              ? `Answer ${unanswered.length} more to submit`
              : unanswered.length > 0
                ? `Submit with ${unanswered.length} unanswered`
                : 'Submit the check'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CheckFinish;
