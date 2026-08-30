/**
 * The check, swept one stop at a time.
 *
 * The lap put every stop on one scroll and opened the current one in place.
 * The sweep gives each stop the whole screen and puts a map of the truck across
 * the top, because the two questions a crew asks between stops — *where am I*
 * and *how much is left* — were the two the scroll answered worst. A strip of
 * nine segments answers both without reading anything.
 *
 * Three bands, and the middle one is the only one that scrolls: header, stop,
 * action bar. The stop is a tally the crew reads in one look before digging in
 * a cabinet, and the claim above it speaks for the whole stop, so a cabinet
 * that is fine costs one tap and only the exceptions cost more.
 *
 * **The numbering is a route, not a lock.** `Jump` opens every stop, marks
 * where you are, and offers the flat list — a crew interrupted at stop 3 comes
 * back to whichever end of the truck they are standing at, and a checklist that
 * argues with them is one they work around.
 *
 * Laid out as a flex column rather than with fixed positioning, so the same
 * component fills a phone and sits inside the template builder's 268px preview
 * frame without either being a special case.
 */

import { AlertTriangle, Check, ChevronRight, Menu, WifiOff, X } from 'lucide-react';
import React, { useMemo } from 'react';

import { CheckType, normalizeCheckType } from '@/modules/scheduling/types/equipmentCheck';

import {
  answerableItems,
  bulkClaim,
  bulkConfirmable,
  stopAnswered,
  stopMapState,
  stopRestocks,
  stopSwept,
  unreadGauges,
  type AnswerMap,
  type LapStop,
  type StopMapState,
} from './checkLapModel';

// ============================================================================
// The truck map
// ============================================================================

/**
 * The orientation device: one segment per stop, in walking order.
 *
 * Colour carries the state and width carries the position — the current stop is
 * wider and holds its own name, so the strip says "you are here" without a
 * legend. Read at arm's length in sun or in the dark, which is why the states
 * are four flat fills rather than anything with a gradient or an icon in it.
 */
const MAP_FILL: Record<StopMapState, string> = {
  complete: 'bg-green-700',
  fault: 'bg-red-800',
  restock: 'bg-orange-700',
  untouched: 'bg-white/20',
};

export const TruckMap: React.FC<{
  stops: LapStop[];
  answers: AnswerMap;
  current: number;
  onJump: (index: number) => void;
}> = ({ stops, answers, current, onJump }) => (
  <div className="flex gap-[3px]" role="list" aria-label="Truck map">
    {stops.map((stop, index) => {
      const state = stopMapState(stop, answers);
      const isCurrent = index === current;
      return (
        <button
          key={stop.id}
          type="button"
          role="listitem"
          onClick={() => onJump(index)}
          // The current segment is wider so the name fits; the rest share the
          // remaining width evenly however many stops there are.
          className={`min-w-0 rounded-[4px] transition-colors ${isCurrent ? 'flex-[1.8] bg-white' : `flex-1 ${MAP_FILL[state]}`}`}
          style={{ height: 30 }}
          aria-label={`Stop ${index + 1}, ${stop.name}, ${state}${isCurrent ? ', current' : ''}`}
          aria-current={isCurrent ? 'step' : undefined}
        >
          {isCurrent && <span className="block truncate px-1 text-[12px] font-bold text-slate-900">{stop.name}</span>}
        </button>
      );
    })}
  </div>
);

// ============================================================================
// Header
// ============================================================================

export type SweepSaveState = 'saved' | 'saving' | 'offline';

/**
 * Save state is on screen at all times, because the fear the brief names is
 * losing a walk — not losing a field. Offline is stated in the header and again
 * in one line under it, since "held on the phone" is the reassurance, and a
 * chip alone does not say it.
 */
const SaveChip: React.FC<{ state: SweepSaveState }> = ({ state }) => {
  if (state === 'offline') {
    return (
      <span className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[12px] font-bold text-amber-300">
        <WifiOff className="h-3 w-3" aria-hidden="true" />
        Offline
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[12px] font-bold text-green-400">
      {state === 'saving' ? (
        'Saving…'
      ) : (
        <>
          <Check className="h-3 w-3" aria-hidden="true" />
          Saved
        </>
      )}
    </span>
  );
};

// ============================================================================
// The sweep
// ============================================================================

export interface CheckSweepProps {
  stops: LapStop[];
  answers: AnswerMap;
  /** Which stop is on screen. Owned above, because Jump and Finish move it. */
  stopIndex: number;
  onStopIndexChange: (index: number) => void;
  /** The one claim that speaks for the stop. */
  onBulkClaim: (stop: LapStop) => void;
  onOpenJump: () => void;
  onFinish: () => void;
  onClose: () => void;
  unitName: string;
  templateName: string;
  saveState: SweepSaveState;
  /** Renders the stop's items. Kept out of here so the frame stays readable. */
  renderStop: (stop: LapStop) => React.ReactNode;
  disabled?: boolean;
}

export const CheckSweep: React.FC<CheckSweepProps> = ({
  stops,
  answers,
  stopIndex,
  onStopIndexChange,
  onBulkClaim,
  onOpenJump,
  onFinish,
  onClose,
  unitName,
  templateName,
  saveState,
  renderStop,
  disabled,
}) => {
  const index = Math.min(Math.max(stopIndex, 0), Math.max(stops.length - 1, 0));
  const stop = stops[index];

  const totals = useMemo(() => {
    let answered = 0;
    let total = 0;
    stops.forEach((s) => {
      total += answerableItems(s).length;
      answered += stopAnswered(s, answers);
    });
    return { answered, total };
  }, [stops, answers]);

  if (!stop) return null;

  const items = answerableItems(stop);
  const claim = bulkClaim(items);
  const gaugesLeft = unreadGauges(stop, answers);
  const restocks = stopRestocks(stop, answers);
  const isLast = index === stops.length - 1;
  const next = stops[index + 1];

  // A gauge is the one thing a claim cannot cover, so a stop holding an unread
  // one cannot be left by the primary action. The button says how many rather
  // than going quiet, because a disabled control with no reason is a dead end.
  const blockedByGauges = gaugesLeft.length > 0;
  const primaryLabel = blockedByGauges
    ? `Read ${gaugesLeft.length} more gauge${gaugesLeft.length === 1 ? '' : 's'}`
    : isLast
      ? 'Finish the check'
      : `Next · ${next?.name ?? ''}`;

  const counts = items.filter((i) => normalizeCheckType(i.checkType) === CheckType.COUNT).length;
  const gauges = items.filter((i) => normalizeCheckType(i.checkType) === CheckType.LEVEL).length;
  const dates = items.filter((i) => normalizeCheckType(i.checkType) === CheckType.EXPIRY).length;
  const summary = [
    counts > 0 ? `${counts} to count` : null,
    gauges > 0 ? `${gauges} to read` : null,
    dates > 0 ? `${dates} date${dates === 1 ? '' : 's'}` : null,
  ].filter(Boolean);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-slate-950">
      {/* Band 1 — the dark header. Deliberately dark in both themes: it is the
          one fixed thing on a screen the crew is walking with, and a header
          that changes with the theme stops being a landmark. */}
      <div className="flex flex-col gap-2.5 bg-slate-900 px-3.5 pt-2 pb-3 text-white">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the check"
            className="mobile-touch-target -ml-2 flex items-center justify-center rounded-md text-slate-300 hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          <p className="min-w-0 flex-1 truncate font-mono text-[14px] font-bold tracking-tight">
            {unitName} · {templateName}
          </p>
          <SaveChip state={saveState} />
        </div>

        <TruckMap stops={stops} answers={answers} current={index} onJump={onStopIndexChange} />

        <div className="flex items-center justify-between text-[12px] text-slate-300">
          <span>
            Stop {index + 1} of {stops.length}
            {isLast ? ' · last one' : ''}
          </span>
          <span className="font-mono tabular-nums">
            {totals.answered} / {totals.total} answered
          </span>
        </div>
      </div>

      {saveState === 'offline' && (
        <p className="border-b border-amber-200 bg-amber-50 px-3.5 py-2 text-[13px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
          No signal. The walk is held on this phone — nothing is sent until you submit.
        </p>
      )}

      {/* Band 2 — the stop. The only band that scrolls. */}
      <div className="flex min-h-0 flex-1 scrollbar-thin flex-col gap-3 overflow-y-auto p-3.5">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-theme-text-primary text-[20px] leading-7 font-bold">{stop.name}</h2>
          <p className="text-theme-text-muted text-[13px]">
            {items.length} item{items.length === 1 ? '' : 's'}
            {summary.length > 0 ? ` · ${summary.join(', ')}` : ''}
          </p>
        </div>

        {claim && bulkConfirmable(items).length > 0 && !stopSwept(stop, answers) && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onBulkClaim(stop)}
            className="min-h-14 rounded-lg border border-green-700 bg-green-50 text-[17px] font-bold text-green-800 transition-colors hover:bg-green-100 disabled:pointer-events-none disabled:opacity-50 dark:bg-green-950/30 dark:text-green-400"
          >
            ✓ {claim}
          </button>
        )}

        {renderStop(stop)}

        {/* One consequence line, not a running commentary. */}
        {restocks.length > 0 && (
          <p className="text-[13px] font-bold text-orange-700 dark:text-orange-400">
            {restocks.length} restock line{restocks.length === 1 ? '' : 's'} from this stop
          </p>
        )}
        {gauges > 0 && (
          <p className="text-theme-text-muted text-[13px]">
            A reading is stored, not ticked — nothing here can be bulk-confirmed.
          </p>
        )}
      </div>

      {/* Band 3 — the action bar. */}
      <div className="border-theme-surface-border bg-theme-surface action-bar-safe flex items-center gap-3 border-t px-3 pt-3">
        <button
          type="button"
          onClick={onOpenJump}
          className="btn-secondary flex min-h-14 w-[84px] shrink-0 flex-col items-center justify-center gap-0.5 text-[13px] font-bold"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
          Jump
        </button>
        <button
          type="button"
          disabled={disabled || blockedByGauges}
          onClick={() => (isLast ? onFinish() : onStopIndexChange(index + 1))}
          className="btn-primary flex min-h-14 flex-1 items-center justify-center gap-2 text-[17px] font-bold"
        >
          {blockedByGauges && <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />}
          <span className="truncate">{primaryLabel}</span>
          {!blockedByGauges && !isLast && <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
};

export default CheckSweep;
