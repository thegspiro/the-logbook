/**
 * EventSummaryStrip
 *
 * The at-a-glance facts of an event, in one row above the page's cards. It
 * replaces two sidebar cards, Statistics and Event Information, that restated
 * each other and the header: the responses tally sat beside an attendee list
 * that already counted it, and rows read "0" for answers nobody had given.
 *
 * A figure is drawn only when it says something. That is why there is no
 * "Not going 0" or "Maybe 0", and why Checked In waits for the event to start
 * unless somebody has already been checked in.
 */

import React from 'react';
import type { EventStats } from '../../types/event';
import { formatShortDateTime } from '../../utils/dateFormatting';

export interface EventSummaryStripProps {
  /** Loaded only for those who manage the event; a member has none. */
  stats: EventStats | null;
  requiresRsvp: boolean;
  rsvpDeadline?: string | null | undefined;
  maxAttendees?: number | null | undefined;
  /** Seats taken, which is what `maxAttendees` caps: members plus their guests. */
  occupiedSeats: number;
  allowGuests: boolean;
  hasStarted: boolean;
  timezone: string;
}

const labelClass = 'text-theme-text-secondary text-sm';
const valueClass = 'text-theme-text-primary text-sm font-medium';
const noteClass = 'text-theme-text-muted mt-1 text-xs';

export const EventSummaryStrip: React.FC<EventSummaryStripProps> = ({
  stats,
  requiresRsvp,
  rsvpDeadline,
  maxAttendees,
  occupiedSeats,
  allowGuests,
  hasStarted,
  timezone,
}) => {
  const showCheckedIn = stats !== null && (stats.checked_in_count > 0 || hasStarted);
  const hasCapacity = Boolean(maxAttendees);

  if (stats === null && !requiresRsvp && !hasCapacity && !allowGuests) {
    return null;
  }

  const otherResponses = stats
    ? [
        stats.not_going_count > 0 ? `${stats.not_going_count} not going` : null,
        stats.maybe_count > 0 ? `${stats.maybe_count} maybe` : null,
      ].filter((part): part is string => part !== null)
    : [];

  // The percentage is the backend's where it sent one, so this bar agrees with
  // every other screen that reports it. Seats, not members, where it has to be
  // worked out here: max_attendees caps seats, and a bar drawn from the member
  // count promises room the RSVP path will refuse.
  const capacityPct =
    stats?.capacity_percentage ?? (maxAttendees ? Math.round((occupiedSeats / maxAttendees) * 100) : 0);
  const barColor = capacityPct >= 90 ? 'bg-red-800' : capacityPct >= 75 ? 'bg-amber-500' : 'bg-green-500';
  const isFull = hasCapacity && maxAttendees != null && occupiedSeats >= maxAttendees;

  return (
    <section aria-label="Event summary" className="card mb-6 p-4 sm:p-6">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-12">
        {stats !== null && (
          <div>
            <dt className={labelClass}>Responses</dt>
            <dd className={valueClass}>{stats.total_rsvps === 0 ? 'None yet' : `${stats.going_count} going`}</dd>
            {otherResponses.length > 0 && <dd className={noteClass}>{otherResponses.join(' · ')}</dd>}
          </div>
        )}
        {stats !== null && showCheckedIn && (
          <div>
            <dt className={labelClass}>Checked In</dt>
            <dd className={valueClass}>{stats.checked_in_count}</dd>
          </div>
        )}
        {hasCapacity && maxAttendees != null && (
          <div className="col-span-2 sm:min-w-48">
            <dt className={labelClass}>Capacity</dt>
            <dd className={valueClass}>
              {occupiedSeats} / {maxAttendees} spots filled
            </dd>
            <dd className="mt-1">
              <div className="bg-theme-surface h-2 w-full rounded-full">
                <div
                  className={`h-2 rounded-full transition-all ${barColor}`}
                  style={{ width: `${Math.min(capacityPct, 100)}%` }}
                ></div>
              </div>
            </dd>
            {isFull && (
              <dd className="mt-2">
                <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-300">
                  Event Full
                </span>
              </dd>
            )}
          </div>
        )}
        {requiresRsvp && (
          <div>
            <dt className={labelClass}>RSVP Required</dt>
            <dd className={valueClass}>{rsvpDeadline ? `By ${formatShortDateTime(rsvpDeadline, timezone)}` : 'Yes'}</dd>
          </div>
        )}
        {allowGuests && (
          <div>
            <dt className={labelClass}>Guests Allowed</dt>
            <dd className={valueClass}>Yes</dd>
          </div>
        )}
      </dl>
    </section>
  );
};
