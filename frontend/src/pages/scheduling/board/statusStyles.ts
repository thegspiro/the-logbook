/**
 * The one place the board's four status colours are written down.
 *
 * A calendar cell, a panel badge and a phone bar all say the same thing about
 * the same shift, and they only stay consistent because they read the same
 * table. Each entry carries a light palette straight from the design and a
 * dark counterpart — the tinted `/15` fills, rather than the light hexes,
 * because a red-100 block on a slate-900 page glares and stops reading as a
 * status at all.
 */

import { ShiftStatus } from '../../../modules/scheduling/utils/shiftBoard';

export interface StatusStyle {
  /** Filled chip: background, border and text together. */
  chip: string;
  /** Solid bar used by the phone month grid, where there is no room for text. */
  bar: string;
  /** Small square in the legend. */
  swatch: string;
  /** What the colour means, for the legend and for screen readers. */
  label: string;
}

export const STATUS_STYLES: Record<ShiftStatus, StatusStyle> = {
  [ShiftStatus.CRITICAL]: {
    chip: 'bg-red-100 border-red-300 text-red-700 dark:bg-red-500/15 dark:border-red-500/40 dark:text-red-300',
    bar: 'bg-red-300 dark:bg-red-500/70',
    swatch: 'bg-red-100 border-red-300 dark:bg-red-500/25 dark:border-red-500/50',
    label: '2+ seats open',
  },
  [ShiftStatus.SHORT]: {
    chip: 'bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-500/15 dark:border-amber-500/40 dark:text-amber-300',
    bar: 'bg-amber-300 dark:bg-amber-500/70',
    swatch: 'bg-amber-100 border-amber-300 dark:bg-amber-500/25 dark:border-amber-500/50',
    label: '1 seat open',
  },
  [ShiftStatus.FULL]: {
    chip: 'bg-green-50 border-green-200 text-green-700 dark:bg-green-500/10 dark:border-green-500/30 dark:text-green-300',
    bar: 'bg-green-300 dark:bg-green-500/60',
    swatch: 'bg-green-50 border-green-200 dark:bg-green-500/20 dark:border-green-500/40',
    label: 'Fully staffed',
  },
  [ShiftStatus.UNKNOWN]: {
    // Deliberately the quietest thing on the calendar. It is not a staffing
    // level, it is a shift nobody has told the system the size of, and it
    // must not compete for attention with a crew that is genuinely short.
    chip: 'bg-theme-surface-secondary border-theme-surface-border text-theme-text-muted',
    bar: 'bg-slate-300 dark:bg-slate-600',
    swatch: 'bg-theme-surface-secondary border-theme-surface-border',
    label: 'Crew size not set',
  },
  [ShiftStatus.MINE]: {
    chip: 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-500/15 dark:border-blue-500/40 dark:text-blue-300',
    bar: 'bg-blue-400 dark:bg-blue-500/70',
    swatch: 'bg-blue-100 border-blue-300 dark:bg-blue-500/25 dark:border-blue-500/50',
    label: "You're on it",
  },
};

/** Legend order: worst first, then "yours" — the order the eye should scan. */
export const LEGEND_ORDER: ShiftStatus[] = [
  ShiftStatus.CRITICAL,
  ShiftStatus.SHORT,
  ShiftStatus.FULL,
  ShiftStatus.MINE,
];

/**
 * The legend the board actually renders.
 *
 * "Crew size not set" is only explained when something on screen is in that
 * state — a department that configures its shifts properly never sees the
 * entry, and a permanent fifth swatch for a state they will never hit is
 * noise in the one row that has to stay scannable.
 */
export const legendFor = (hasUnsizedShift: boolean): ShiftStatus[] =>
  hasUnsizedShift ? [...LEGEND_ORDER, ShiftStatus.UNKNOWN] : LEGEND_ORDER;
