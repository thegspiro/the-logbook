/**
 * The month-by-month hours behind an hours requirement's total — or shifts or
 * calls behind a shift or call requirement's — so a member can check the
 * figure. The months are the records the server counted, grouped by
 * month, so they add up to the number on the card; nothing here re-derives
 * which records count.
 *
 * Each bar is scaled to the monthly pace the department's requirement implies
 * (its annual hours over the months in the window, so 72 over 12 is 6 a month,
 * and 48 would be 4): a full bar is a month that kept pace, a short one fell
 * behind it.
 *
 * A month leave or a waiver excused keeps its hours — they still count toward
 * the total — and says why above them, so the leave stays on the record beside
 * the training done during it.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatHours } from '../../utils/hoursFormatting';
import { monthLabel } from '../../utils/requirementMonths';
import { requirementUnit } from '../../utils/requirementUnits';
import type { RequirementDetail, RequirementMonth } from '../../types/training';

/** A month of either breakdown, its hours or count as `value`. */
type BreakdownMonth = Omit<RequirementMonth, 'hours'> & { value: number };

/** How a breakdown names and prints its figure. Hours keep their original wording. */
interface BreakdownUnits {
  format: (n: number) => string;
  short: string;
  noun: string;
  spoken: (n: number) => string;
  excusedVerb: string;
}

const HOUR_UNITS: BreakdownUnits = {
  format: formatHours,
  short: 'hrs',
  noun: 'hours',
  spoken: (n) => `${formatHours(n)} hours`,
  excusedVerb: 'earned ',
};

const countUnits = (type: RequirementDetail['requirement_type']): BreakdownUnits => {
  const plural = requirementUnit(type, 2) || 'times';
  return {
    format: (n) => String(n),
    short: plural,
    noun: plural,
    spoken: (n) => `${n} ${requirementUnit(type, n) || plural}`,
    excusedVerb: '',
  };
};

/** One decimal, trailing zero dropped. Not `formatHours`, which rounds to the half hour. */
const oneDecimal = (n: number): string => String(Math.round(n * 10) / 10);

/**
 * Why a month was excused, as its label reads. A leave of absence is named
 * only when one covered the month; a training waiver alone reads "Waived".
 * A month from a server that predates the reason flags reads "Leave", as it
 * always did.
 */
const excusedMonthLabel = (m: BreakdownMonth): string | null => {
  if (!m.waived) return null;
  const reason = m.on_waiver && !m.on_leave ? 'Waived' : 'Leave';
  const partial = m.waived_share != null && m.waived_share > 0 && m.waived_share < 1;
  if (!partial) return reason;
  return reason === 'Leave' ? 'Partial leave' : 'Partly waived';
};

/** "on leave", "while waived" or "on leave or waived", for the summary line. */
const excusedPhrase = (months: BreakdownMonth[]): string => {
  const leave = months.some((m) => m.on_leave || !m.on_waiver);
  const waiver = months.some((m) => m.on_waiver);
  if (leave && waiver) return 'on leave or waived';
  return waiver ? 'while waived' : 'on leave';
};

export const RequirementMonthlyHours: React.FC<{ requirement: RequirementDetail }> = ({ requirement }) => {
  const [open, setOpen] = useState(false);
  const hours = requirement.monthly_hours;
  const counts = requirement.monthly_counts;
  const months: BreakdownMonth[] | null = hours?.length
    ? hours.map(({ hours: value, ...rest }) => ({ ...rest, value }))
    : counts?.length
      ? counts.map(({ count: value, ...rest }) => ({ ...rest, value }))
      : null;
  if (!months) return null;
  const units = hours?.length ? HOUR_UNITS : countUnits(requirement.requirement_type);

  const total = months.reduce((sum, m) => sum + m.value, 0);
  const excused = months.filter((m) => m.waived);
  const excusedHours = excused.reduce((sum, m) => sum + m.value, 0);
  // The average is the member's pace in the months nothing excused, measured
  // only on those months' hours. Dividing every hour, leave hours included, by
  // the active months alone overstated it: 26 hours with 23 earned on leave
  // read as 13 a month for a member who logged 3.
  const activeMonths = months.filter((m) => !m.waived);
  const activeHours = activeMonths.reduce((sum, m) => sum + m.value, 0);
  const average = activeMonths.length > 0 ? activeHours / activeMonths.length : null;
  // The department's own annual level over the months in the window. The
  // unadjusted figure, not the waiver-prorated one on the card: leave months
  // shrink what a member owes, not the pace the department set.
  const annualLevel = requirement.original_required_hours ?? requirement.required_hours;
  const pace = requirement.window_months ? annualLevel / requirement.window_months : null;
  // Without a pace there is nothing to measure a month against, so fall back
  // to the busiest month rather than drawing every bar empty.
  const scale = pace && pace > 0 ? pace : Math.max(...months.map((m) => m.value), 1);
  const panelId = `monthly-hours-${requirement.id}`;

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="text-theme-text-secondary mobile-touch-target flex items-center gap-1 text-xs font-medium hover:underline"
      >
        {open ? (
          <ChevronUp className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        )}
        <span>{open ? `Hide monthly ${units.noun}` : `Show monthly ${units.noun}`}</span>
      </button>
      {open && (
        <div id={panelId} className="mt-1">
          <p className="text-theme-text-muted mb-2 text-xs">
            {oneDecimal(total)} {units.short} over {months.length} {months.length === 1 ? 'month' : 'months'}
            {excused.length > 0 && (
              <>
                {' '}
                ({oneDecimal(excusedHours)} {units.excusedVerb}
                {excusedPhrase(excused)})
              </>
            )}
            {average != null && excused.length > 0 && (
              <>
                {' '}
                · average {oneDecimal(average)} {units.short}/month in the {activeMonths.length}{' '}
                {activeMonths.length === 1 ? 'month' : 'months'} not excused
              </>
            )}
            {average != null && excused.length === 0 && (
              <>
                {' '}
                · average {oneDecimal(average)} {units.short}/month
              </>
            )}
            {pace != null && (
              <>
                {' '}
                · {oneDecimal(pace)} {units.short}/month needed (full bar)
              </>
            )}
          </p>
          <ul className="grid grid-cols-6 gap-x-1 gap-y-2 sm:grid-cols-12">
            {months.map((m, i) => {
              const year = m.month.slice(0, 4);
              const showYear = i === 0 || m.month.endsWith('-01');
              const label = excusedMonthLabel(m);
              const share = m.waived_share ?? (m.waived ? 1 : 0);
              // A partly excused month owes the rest of its pace, so its full
              // bar is that remainder. A wholly excused one owes nothing and
              // is drawn against the ordinary pace, to show what was done.
              const monthScale = share > 0 && share < 1 ? scale * (1 - share) : scale;
              const onPace = m.value >= monthScale;
              return (
                <li
                  key={m.month}
                  className="flex flex-col items-center text-center"
                  aria-label={
                    label
                      ? `${monthLabel(m.month, true)}: ${label.toLowerCase()}, ${units.spoken(m.value)}`
                      : `${monthLabel(m.month, true)}: ${units.spoken(m.value)}`
                  }
                >
                  <span
                    className="h-3 text-[10px] leading-3 font-semibold text-blue-700 dark:text-blue-300"
                    aria-hidden="true"
                  >
                    {label ?? ''}
                  </span>
                  <span
                    className={`text-xs leading-none font-semibold ${m.value === 0 ? 'text-theme-text-muted' : 'text-theme-text-primary'}`}
                  >
                    {units.format(m.value)}
                  </span>
                  <span
                    className={`relative mt-1 flex h-9 w-3 items-end overflow-hidden rounded-sm ${
                      m.waived ? 'border border-dashed border-blue-500/50 bg-blue-500/10' : 'bg-theme-surface-hover'
                    }`}
                  >
                    <span
                      className={`w-full rounded-sm ${onPace ? 'bg-green-500' : 'bg-blue-500'}`}
                      style={{ height: `${Math.min((m.value / monthScale) * 100, 100)}%` }}
                    />
                  </span>
                  <span className="text-theme-text-muted mt-1 text-[10px] leading-none">{monthLabel(m.month)}</span>
                  <span className="text-theme-text-muted h-3 text-[10px] leading-3">{showYear ? year : ''}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
