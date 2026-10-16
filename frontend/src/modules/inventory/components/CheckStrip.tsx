/**
 * Recent-check strip — one square per duty day, oldest to newest.
 *
 * The point of the strip is the *pattern*: a block of amber says a rig has
 * been going unchecked in a way that a single "last checked 5 days ago" line
 * does not. Squares are decorative to a screen reader (the same information is
 * on the card as text), so the strip carries one summary label rather than
 * seven unlabelled swatches.
 */

import React from 'react';
import type { CheckStripEntry } from '../types/equipmentCheck';
import { CHECK_OUTCOME_LABELS } from '../types/equipmentCheck';
import { OUTCOME_SWATCH } from '../utils/checkOutcome';
import { formatCalendarDate } from '../../../utils/dateFormatting';

interface CheckStripProps {
  entries: CheckStripEntry[];
  /**
   * `md`: larger squares. `fill`: squares share the full width, for the
   * apparatus detail header on a phone, where fourteen 16px squares left the
   * strip a quarter of the card and too small to read.
   */
  size?: 'sm' | 'md' | 'fill';
}

export const CheckStrip: React.FC<CheckStripProps> = ({ entries, size = 'sm' }) => {
  if (entries.length === 0) return null;

  const box = size === 'fill' ? 'h-4 max-w-6 min-w-0 flex-1' : size === 'md' ? 'h-4 w-4' : 'h-3 w-3';
  const summary = entries
    .filter((e) => e.status)
    .map(
      (e) =>
        `${formatCalendarDate(e.date, { month: 'short', day: 'numeric' })}: ${
          CHECK_OUTCOME_LABELS[e.status ?? 'scheduled']
        }`
    )
    .join('; ');

  return (
    <div
      className={`flex items-center gap-[3px] ${size === 'fill' ? 'w-full' : ''}`}
      role="img"
      aria-label={summary ? `Recent checks — ${summary}` : 'No checks in this window'}
    >
      {entries.map((entry) => (
        <span
          key={entry.date}
          aria-hidden="true"
          title={`${formatCalendarDate(entry.date, { month: 'short', day: 'numeric' })} — ${
            entry.status ? CHECK_OUTCOME_LABELS[entry.status] : 'No check scheduled'
          }`}
          className={`${box} shrink-0 rounded-[2px] ${
            entry.status ? OUTCOME_SWATCH[entry.status] : 'bg-theme-surface-border/50'
          }`}
        />
      ))}
    </div>
  );
};

export default CheckStrip;
