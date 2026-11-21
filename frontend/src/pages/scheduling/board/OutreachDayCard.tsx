/**
 * The selected day's apparatus outreach, beside its shifts. Read-only here:
 * seats are taken on the night's own event page, because these are not
 * shifts and the board's claim and release actions do not apply to them.
 */

import React from 'react';
import { Link } from 'react-router';
import { ChevronRight, Truck } from 'lucide-react';
import type { CalendarOutreachItem } from '../../../types/apparatusEvent';
import { formatTime } from '../../../utils/dateFormatting';
import { OUTREACH_STYLE } from './statusStyles';

export const OutreachDayCard: React.FC<{ items: CalendarOutreachItem[]; timezone: string }> = ({ items, timezone }) => {
  if (items.length === 0) return null;
  return (
    <section className="card shrink-0 overflow-hidden" aria-labelledby="outreach-day-heading">
      <header className="border-theme-surface-border border-b px-4 py-3">
        <h3 id="outreach-day-heading" className="text-theme-text-primary flex items-center gap-2 font-bold">
          <Truck className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
          Outreach
        </h3>
        <p className="text-theme-text-secondary text-[13px]">
          Apparatus committed, but not a shift: no shift hours, no coverage. Crew hours go to Admin Hours.
        </p>
      </header>
      <ul>
        {items.map((item) => (
          <li key={item.event_id} className="border-theme-surface-border border-b last:border-b-0">
            <Link
              to={`/events/${item.event_id}`}
              className="hover:bg-theme-surface-hover focus-visible:ring-theme-focus-ring flex items-center gap-3 px-4 py-3 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
            >
              <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${OUTREACH_STYLE.chip}`}>
                {item.unit_numbers.join(' + ') || 'Outreach'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-theme-text-primary block truncate font-semibold">{item.title}</span>
                <span className="text-theme-text-secondary block text-xs">
                  {formatTime(item.start_datetime, timezone)} – {formatTime(item.end_datetime, timezone)} ·{' '}
                  {item.filled} of {item.total} seats
                  {item.is_mine ? ' · you’re on the crew' : ''}
                </span>
              </span>
              <ChevronRight className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default OutreachDayCard;
