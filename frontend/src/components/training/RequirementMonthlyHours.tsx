/**
 * The month-by-month hours behind an hours requirement's total, so a member can
 * check the figure. The months are the records the server counted, grouped by
 * month, so they add up to the number on the card; nothing here re-derives
 * which records count.
 *
 * Each bar is scaled to the monthly pace the department's requirement implies
 * (its annual hours over the months in the window, so 72 over 12 is 6 a month,
 * and 48 would be 4): a full bar is a month that kept pace, a short one fell
 * behind it.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatHours } from '../../utils/hoursFormatting';
import { monthLabel } from '../../utils/requirementMonths';
import type { RequirementDetail } from '../../types/training';

/** One decimal, trailing zero dropped. Not `formatHours`, which rounds to the half hour. */
const oneDecimal = (n: number): string => String(Math.round(n * 10) / 10);

export const RequirementMonthlyHours: React.FC<{ requirement: RequirementDetail }> = ({ requirement }) => {
  const [open, setOpen] = useState(false);
  const months = requirement.monthly_hours;
  if (!months || months.length === 0) return null;

  const total = months.reduce((sum, m) => sum + m.hours, 0);
  // A month of leave owes nothing, so it is left out of the average rather
  // than dragging it down.
  const activeMonths = months.filter((m) => !m.waived).length;
  const waivedMonths = months.length - activeMonths;
  const average = activeMonths > 0 ? total / activeMonths : 0;
  // The department's own annual level over the months in the window. The
  // unadjusted figure, not the waiver-prorated one on the card: leave months
  // shrink what a member owes, not the pace the department set.
  const annualLevel = requirement.original_required_hours ?? requirement.required_hours;
  const pace = requirement.window_months ? annualLevel / requirement.window_months : null;
  // Without a pace there is nothing to measure a month against, so fall back
  // to the busiest month rather than drawing every bar empty.
  const scale = pace && pace > 0 ? pace : Math.max(...months.map((m) => m.hours), 1);
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
        <span>{open ? 'Hide monthly hours' : 'Show monthly hours'}</span>
      </button>
      {open && (
        <div id={panelId} className="mt-1">
          <p className="text-theme-text-muted mb-2 text-xs">
            {oneDecimal(total)} hrs over {months.length} {months.length === 1 ? 'month' : 'months'}
            {activeMonths > 0 && <> · average {oneDecimal(average)} hrs/month</>}
            {waivedMonths > 0 && (
              <>
                {' '}
                ({waivedMonths} {waivedMonths === 1 ? 'month' : 'months'} of leave not counted)
              </>
            )}
            {pace != null && <> · {oneDecimal(pace)} hrs/month needed (full bar)</>}
          </p>
          <ul className="grid grid-cols-6 gap-x-1 gap-y-2 sm:grid-cols-12">
            {months.map((m, i) => {
              const year = m.month.slice(0, 4);
              const showYear = i === 0 || m.month.endsWith('-01');
              const onPace = m.hours >= scale;
              return (
                <li
                  key={m.month}
                  className="flex flex-col items-center text-center"
                  aria-label={
                    m.waived
                      ? `${monthLabel(m.month, true)}: leave, ${formatHours(m.hours)} hours`
                      : `${monthLabel(m.month, true)}: ${formatHours(m.hours)} hours`
                  }
                >
                  <span
                    className={`text-xs leading-none font-semibold ${m.hours === 0 ? 'text-theme-text-muted' : 'text-theme-text-primary'}`}
                  >
                    {m.waived && m.hours === 0 ? 'Leave' : formatHours(m.hours)}
                  </span>
                  <span
                    className={`relative mt-1 flex h-9 w-3 items-end overflow-hidden rounded-sm ${
                      m.waived ? 'border border-dashed border-blue-500/50 bg-blue-500/10' : 'bg-theme-surface-hover'
                    }`}
                  >
                    <span
                      className={`w-full rounded-sm ${onPace ? 'bg-green-500' : 'bg-blue-500'}`}
                      style={{ height: `${Math.min((m.hours / scale) * 100, 100)}%` }}
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
