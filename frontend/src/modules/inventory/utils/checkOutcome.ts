/**
 * Shared styling for check outcomes and apparatus readiness.
 *
 * The fleet board, the recent-check strip, the readiness matrix and the log
 * all encode the same seven outcomes. Keeping the colour and label in one
 * place is what stops "missed" reading amber in one view and red in another —
 * a real hazard here, because the whole point of the grid is that a colour is
 * read without its label.
 */

import { CheckOutcome, Readiness } from '../types/equipmentCheck';

/** Tailwind background for a matrix cell / strip square. Colour only. */
export const OUTCOME_SWATCH: Record<CheckOutcome, string> = {
  passed: 'bg-green-500',
  failed: 'bg-red-500',
  // Striped rather than solid: a half-done check is not a third outcome
  // between pass and fail, it is an unfinished one, and the hatch says so
  // without inventing a colour.
  partial:
    'bg-amber-500 [background-image:repeating-linear-gradient(135deg,transparent_0_3px,rgba(0,0,0,0.28)_3px_6px)]',
  missed: 'bg-amber-500/60',
  due: 'bg-blue-500/40',
  scheduled: 'bg-theme-surface-border',
  out_of_service: 'bg-slate-400 dark:bg-slate-600',
};

/** Pill styling (text + background + border) for an outcome. */
export const OUTCOME_PILL: Record<CheckOutcome, string> = {
  passed: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/25',
  failed: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/25',
  partial: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25',
  missed: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/25',
  due: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/25',
  scheduled: 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border',
  out_of_service: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/25',
};

export const READINESS_PILL: Record<Readiness, string> = {
  in_service: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/25',
  attention: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25',
  out_of_service: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/25',
  no_checks: 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border',
};

/** Left accent stripe on an apparatus card, matching its readiness pill. */
export const READINESS_STRIPE: Record<Readiness, string> = {
  in_service: 'border-l-green-500',
  attention: 'border-l-amber-500',
  out_of_service: 'border-l-red-500',
  no_checks: 'border-l-theme-surface-border',
};

/** Sort key so the rigs that need a decision come first. */
export const READINESS_RANK: Record<Readiness, number> = {
  out_of_service: 0,
  attention: 1,
  in_service: 2,
  no_checks: 3,
};

/**
 * The strip and matrix legend, in the order it reads best: outcomes a crew
 * produced, then ones that describe an absence.
 */
export const OUTCOME_LEGEND: { status: CheckOutcome; label: string }[] = [
  { status: CheckOutcome.PASSED, label: 'Passed' },
  { status: CheckOutcome.FAILED, label: 'Found a problem' },
  { status: CheckOutcome.PARTIAL, label: 'Started, not finished' },
  { status: CheckOutcome.MISSED, label: 'Missed' },
  { status: CheckOutcome.OUT_OF_SERVICE, label: 'Out of service' },
];

export const TIMING_LABELS: Record<string, string> = {
  start_of_shift: 'Start of shift',
  end_of_shift: 'End of shift',
};

/** Short form for a matrix cell tooltip, where the row already names the rig. */
export const TIMING_SHORT: Record<string, string> = {
  start_of_shift: 'Start',
  end_of_shift: 'End',
};

/**
 * A completion rate as a string, or an em dash.
 *
 * `null` means the window owed this apparatus nothing — every occasion was
 * out of service or not yet due. Rendering that as "0%" would accuse a crew
 * of missing checks that were never theirs to do.
 */
export const formatRate = (rate?: number | null): string =>
  rate === null || rate === undefined ? '—' : `${Math.round(rate)}%`;
