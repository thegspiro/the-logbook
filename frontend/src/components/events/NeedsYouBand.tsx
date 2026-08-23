/**
 * The "Needs You" band above the events grid.
 *
 * It holds only events with an outstanding action — check-in open now, a
 * mandatory event with no RSVP, a mandatory event that ended with no check-in
 * recorded — each next to the single control that clears it. Membership comes
 * from the same {@link getEventUrgency} the cards use, so the band can never
 * point at an event the grid renders as routine.
 *
 * The band is a shortcut, not a filter: every event in it is still in the grid
 * below. When it has no rows it renders nothing at all — an empty state here
 * would be a permanent strip of furniture saying "nothing to do".
 */

import React from 'react';
import { Link } from 'react-router';
import { AlertCircle, CalendarX, Check, QrCode, X } from 'lucide-react';
import type { EventListItem } from '../../types/event';
import type { EventUrgency } from '../../utils/eventHelpers';
import { formatEventTimeRange, getEventUrgency, isUrgentEventState } from '../../utils/eventHelpers';
import { formatDateCustom, formatTime } from '../../utils/dateFormatting';
import { NEEDS_YOU_MAX_ROWS } from '../../constants/config';
import { BAND_ROW_CLASS } from './eventUrgencyPresentation';

export interface NeedsYouBandProps {
  /** Upcoming events already on the page. */
  events: EventListItem[];
  /** Recently-ended mandatory events, fetched separately for `missed` rows. */
  pastMandatoryEvents: EventListItem[];
  timezone: string;
  now: Date;
  rsvpLoading: Record<string, boolean>;
  onQuickRSVP: (eventId: string, status: 'going' | 'not_going') => void;
  /** Reveals the rows the cap hid, by narrowing the grid to what needs a response. */
  onShowAll: () => void;
}

interface BandRow {
  event: EventListItem;
  urgency: EventUrgency;
}

const ROW_BUTTON_CLASS =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 px-3 text-sm font-medium whitespace-nowrap max-md:flex-1';

/** Numerals in the meta line are monospaced, matching how hours read elsewhere. */
const Hours: React.FC<{ value: number }> = ({ value }) => (
  <span className="text-theme-text-primary font-mono">{value.toFixed(1)}</span>
);

export const NeedsYouBand: React.FC<NeedsYouBandProps> = ({
  events,
  pastMandatoryEvents,
  timezone,
  now,
  rsvpLoading,
  onQuickRSVP,
  onShowAll,
}) => {
  const rows = React.useMemo<BandRow[]>(() => {
    const seen = new Set<string>();
    const collected: BandRow[] = [];

    for (const event of [...events, ...pastMandatoryEvents]) {
      // The two sources overlap around an event that is ending right now.
      if (seen.has(event.id)) continue;
      seen.add(event.id);

      const urgency = getEventUrgency(event, now);
      if (isUrgentEventState(urgency)) collected.push({ event, urgency });
    }

    const rank: Record<string, number> = { live: 0, action: 1, missed: 2 };
    return collected.sort((a, b) => {
      const byState = (rank[a.urgency] ?? 9) - (rank[b.urgency] ?? 9);
      if (byState !== 0) return byState;
      // Nearest to now first — which for the past `missed` group means the most
      // recent miss, the one still worth explaining.
      const distance = (row: BandRow): number => Math.abs(Date.parse(row.event.start_datetime) - now.getTime());
      return distance(a) - distance(b);
    });
  }, [events, pastMandatoryEvents, now]);

  if (rows.length === 0) return null;

  const visibleRows = rows.slice(0, NEEDS_YOU_MAX_ROWS);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <section
      role="region"
      aria-label="Events needing your response"
      className="card mb-6 overflow-hidden"
      data-testid="needs-you-band"
    >
      <div className="border-theme-surface-border bg-theme-surface-secondary flex items-center justify-between gap-3 border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-theme-text-muted text-[10px] font-bold tracking-[0.12em] uppercase">Needs You</span>
          <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white">
            {rows.length}
          </span>
        </div>
        <span className="text-theme-text-muted hidden text-xs sm:inline">Clears itself as you respond</span>
      </div>

      <ul>
        {visibleRows.map(({ event, urgency }) => (
          <li
            key={event.id}
            className={`border-theme-surface-border flex flex-col gap-3 border-b border-l-4 px-5 py-3.5 last:border-b-0 md:flex-row md:items-center md:gap-4 ${
              BAND_ROW_CLASS[urgency] ?? ''
            }`}
          >
            {urgency === 'live' ? (
              <span
                className="bg-theme-alert-success-icon animate-live-pulse mt-1 h-2 w-2 shrink-0 rounded-full md:mt-0"
                aria-hidden="true"
              />
            ) : urgency === 'action' ? (
              <AlertCircle className="text-theme-alert-danger-icon h-5 w-5 shrink-0" aria-hidden="true" />
            ) : (
              <CalendarX className="text-theme-alert-warning-icon h-5 w-5 shrink-0" aria-hidden="true" />
            )}

            <div className="min-w-0 flex-1">
              <p className="text-theme-text-primary text-base font-semibold">
                {urgency === 'live'
                  ? `${event.title} is happening now`
                  : urgency === 'missed'
                    ? `No check-in recorded for ${event.title}`
                    : event.is_mandatory
                      ? `${event.title} is mandatory and you haven't responded`
                      : `RSVP for ${event.title} closes soon`}
              </p>
              <p className="text-theme-text-secondary text-sm">
                {urgency === 'live' && (
                  <>
                    {event.check_in_closes_at && (
                      <>Check-in closes at {formatTime(event.check_in_closes_at, timezone)}</>
                    )}
                    {(event.location_name || event.location) && <> · {event.location_name || event.location}</>}
                    {event.credited_hours != null && (
                      <>
                        {' '}
                        · Credits <Hours value={event.credited_hours} />{' '}
                        {event.hour_category_label ? `${event.hour_category_label} hours` : 'hours'}
                      </>
                    )}
                  </>
                )}
                {urgency === 'action' && (
                  <>
                    {formatEventTimeRange(event, timezone, now)}
                    {event.rsvp_deadline && (
                      <>
                        {' '}
                        · RSVP closes{' '}
                        {formatDateCustom(
                          event.rsvp_deadline,
                          { weekday: 'short', month: 'short', day: 'numeric' },
                          timezone
                        )}{' '}
                        at {formatTime(event.rsvp_deadline, timezone)}
                      </>
                    )}
                  </>
                )}
                {urgency === 'missed' && (
                  <>
                    Mandatory ·{' '}
                    {formatDateCustom(
                      event.start_datetime,
                      { weekday: 'short', month: 'short', day: 'numeric' },
                      timezone
                    )}
                    {event.credited_hours != null && (
                      <>
                        {' '}
                        · Missing <Hours value={event.credited_hours} /> hours from your record
                      </>
                    )}
                  </>
                )}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2 max-md:w-full">
              {urgency === 'live' && (
                <Link to={`/events/${event.id}/check-in`} className={`btn-success ${ROW_BUTTON_CLASS}`}>
                  <QrCode className="h-4 w-4" aria-hidden="true" />
                  Check In
                </Link>
              )}
              {urgency === 'action' && (
                <>
                  <button
                    type="button"
                    onClick={() => onQuickRSVP(event.id, 'going')}
                    disabled={!!rsvpLoading[event.id]}
                    className={`btn-primary ${ROW_BUTTON_CLASS}`}
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                    Going
                  </button>
                  <button
                    type="button"
                    onClick={() => onQuickRSVP(event.id, 'not_going')}
                    disabled={!!rsvpLoading[event.id]}
                    className={`btn-secondary ${ROW_BUTTON_CLASS}`}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                    Not Going
                  </button>
                </>
              )}
              {urgency === 'missed' && (
                <Link to={`/events/${event.id}`} className={`btn-secondary ${ROW_BUTTON_CLASS}`}>
                  View attendance
                </Link>
              )}
            </div>
          </li>
        ))}

        {hiddenCount > 0 && (
          <li className="border-theme-surface-border border-t">
            <button
              type="button"
              onClick={onShowAll}
              className="text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary min-h-[44px] w-full px-5 py-3 text-left text-sm font-medium transition-colors"
            >
              +{hiddenCount} more need a response
            </button>
          </li>
        )}
      </ul>
    </section>
  );
};
