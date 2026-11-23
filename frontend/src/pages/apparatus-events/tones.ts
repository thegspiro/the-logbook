/**
 * Badge tones for apparatus events. The fills and text pairs are the ones the
 * scheduling board already uses (pages/scheduling/board/statusStyles.ts), so a
 * "Driver · EVOC" badge here reads at the same contrast as a status chip there.
 */

import { ApparatusEventEvocMode } from '../../types/apparatusEvent';

export const TONE = {
  red: 'border bg-red-100 border-red-300 text-red-700 dark:bg-red-500/15 dark:border-red-500/40 dark:text-red-300',
  amber:
    'border bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-500/15 dark:border-amber-500/40 dark:text-amber-300',
  green:
    'border bg-green-50 border-green-200 text-green-700 dark:bg-green-500/10 dark:border-green-500/30 dark:text-green-300',
  blue: 'border bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-500/15 dark:border-blue-500/40 dark:text-blue-300',
  slate: 'border bg-theme-surface-secondary border-theme-surface-border text-theme-text-secondary',
} as const;

/**
 * How full a night is, as a badge tone: green full, amber partly filled, red
 * with nobody yet. The night list and the crew card's night chips both use it,
 * so a night reads the same in each. It used to go red with two seats open, so
 * a night one seat from full looked as urgent as an empty one.
 */
export const fillTone = (filled: number, total: number): string => {
  if (total === 0) return TONE.slate;
  if (filled >= total) return TONE.green;
  return filled === 0 ? TONE.red : TONE.amber;
};

/**
 * Whether a night is staffed, as a badge tone (owner decision, 2026-11-23):
 * green once every essential seat is filled, red with none of them filled,
 * amber between. Non-essential seats do not move it. A night with no essential
 * seats falls back to fillTone, so an empty night of optional seats still reads
 * red rather than counting "every essential seat filled" over nothing.
 */
export const readinessTone = (
  essentialFilled: number,
  essentialTotal: number,
  filled: number,
  total: number
): string => {
  if (essentialTotal === 0) return fillTone(filled, total);
  if (essentialFilled >= essentialTotal) return TONE.green;
  return essentialFilled === 0 ? TONE.red : TONE.amber;
};

/** "Essential 3/3 · 5 of 7 filled", or just the fill when no seat is essential. */
export const readinessLabel = (
  essentialFilled: number,
  essentialTotal: number,
  filled: number,
  total: number
): string =>
  essentialTotal > 0 && essentialTotal < total
    ? `Essential ${essentialFilled}/${essentialTotal} · ${filled} of ${total} filled`
    : `${filled} of ${total} seats filled`;

export const EVOC_MODE_LABEL: Record<ApparatusEventEvocMode, string> = {
  [ApparatusEventEvocMode.ENFORCE]: 'EVOC enforced',
  [ApparatusEventEvocMode.WARN]: 'EVOC warn only',
  [ApparatusEventEvocMode.IGNORE]: 'EVOC not checked',
};

export const EVOC_MODE_TONE: Record<ApparatusEventEvocMode, string> = {
  [ApparatusEventEvocMode.ENFORCE]: TONE.red,
  [ApparatusEventEvocMode.WARN]: TONE.amber,
  [ApparatusEventEvocMode.IGNORE]: TONE.slate,
};

/** "3 h 30 m", "2 h", "45 m". */
export const formatDuration = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} h ${m} m`;
  if (h) return `${h} h`;
  return `${m} m`;
};
