/**
 * One event in the /events grid.
 *
 * Extracted from EventsPage, which had grown to hold this whole tree inline.
 * The card ranks itself by {@link EventUrgency}: an urgent event gets a colored
 * left accent and a status strip naming what it wants, a routine one gets
 * neither, so the eye lands only on the cards that need something.
 */

import React from 'react';
import { Link } from 'react-router';
import {
  CalendarPlus,
  Check,
  CheckSquare,
  ClipboardCheck,
  Clock,
  Copy,
  MapPin,
  Pencil,
  QrCode,
  Repeat,
  Square,
  Users,
  X,
} from 'lucide-react';
import type { EventListItem } from '../../types/event';
import { RSVPStatus as RSVPStatusEnum } from '../../constants/enums';
import type { EventUrgency } from '../../utils/eventHelpers';
import {
  downloadICSFile,
  formatEventTimeRange,
  getEventTypeBadgeColor,
  getEventTypeLabel,
  getRSVPStatusColor,
  getRSVPStatusLabel,
  isRosterFull,
} from '../../utils/eventHelpers';
import { formatAbsoluteDate } from '../../hooks/useRelativeTime';
import { formatDateCustom, formatTime } from '../../utils/dateFormatting';
import { formatHoursExact } from '../../utils/hoursFormatting';
import { EventType as EventTypeEnum } from '../../constants/enums';
import { getUrgencyPresentation } from './eventUrgencyPresentation';

export interface EventListCardProps {
  event: EventListItem;
  urgency: EventUrgency;
  timezone: string;
  /** Short zone name ("EDT") appended to the time row's tooltip. */
  timezoneAbbr: string;
  /** Frozen "now" shared with the rest of the page, so no two cards disagree. */
  now: Date;
  canManage: boolean;
  selectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: (eventId: string) => void;
  onDuplicate: (eventId: string) => void;
  rsvpLoading: boolean;
  /** True while "Change RSVP" has swapped the footer for the Going pair. */
  isChangingRsvp: boolean;
  onQuickRSVP: (eventId: string, status: 'going' | 'not_going') => void;
  onStartChangeRsvp: (eventId: string) => void;
  onCancelChangeRsvp: (eventId: string) => void;
}

/** Why the hours row says "up to" rather than naming a figure. */
const CREDITED_HOURS_BASIS =
  "Based on the event's scheduled length. The hours credited to your record are your attended time, settled when you check out.";

const DETAIL_ROW_CLASS = 'text-theme-text-secondary flex items-center gap-2 text-sm';
const DETAIL_ICON_CLASS = 'text-theme-text-muted h-3.5 w-3.5 shrink-0';
const FOOTER_BUTTON_CLASS =
  'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 px-3 text-sm font-medium whitespace-nowrap';

const EventListCardBase: React.FC<EventListCardProps> = ({
  event,
  urgency,
  timezone,
  timezoneAbbr,
  now,
  canManage,
  selectionMode,
  isSelected,
  onToggleSelect,
  onDuplicate,
  rsvpLoading,
  isChangingRsvp,
  onQuickRSVP,
  onStartChangeRsvp,
  onCancelChangeRsvp,
}) => {
  const presentation = getUrgencyPresentation(urgency);
  const StripIcon = presentation?.icon ?? null;
  const rosterFull = isRosterFull(event);

  // No requires_rsvp here. That flag means a response is *expected*, which is
  // what drives the deadline and the Needs You band — not whether responses
  // are accepted at all. A member may always say they are coming, so the only
  // thing that removes the controls is the event being cancelled.
  // is_draft matters because EventsPage includes drafts for managers and the
  // API refuses every draft RSVP outright, so the controls could never succeed.
  // The same reasoning covers allowed_rsvp_statuses: this card only ever
  // submits going / not_going, so on an event that accepts neither there is
  // nothing here that can succeed and the member is better served by the link.
  const allowedStatuses = event.allowed_rsvp_statuses ?? [RSVPStatusEnum.GOING, RSVPStatusEnum.NOT_GOING];
  const canAnswerGoing = allowedStatuses.includes(RSVPStatusEnum.GOING);
  const canAnswerNotGoing = allowedStatuses.includes(RSVPStatusEnum.NOT_GOING);
  const rsvpAvailable = !event.is_cancelled && !event.is_draft && (canAnswerGoing || canAnswerNotGoing);
  const showRsvpPair = rsvpAvailable && (!event.user_rsvp_status || isChangingRsvp);

  const stripMeta = ((): string | null => {
    if (urgency === 'live' && event.check_in_closes_at) {
      return `Check-in closes ${formatTime(event.check_in_closes_at, timezone)}`;
    }
    if (urgency === 'action' && event.rsvp_deadline) {
      return `RSVP by ${formatDateCustom(event.rsvp_deadline, { weekday: 'short' }, timezone)} ${formatTime(event.rsvp_deadline, timezone)}`;
    }
    if (urgency === 'waitlisted') {
      const waiting = event.waitlist_count ?? 0;
      return waiting > 0 ? `${waiting} waiting` : 'On the waitlist';
    }
    if (urgency === 'confirmed' || urgency === 'declined') {
      return `${event.going_count ?? 0} going`;
    }
    return null;
  })();

  const rosterLine = ((): string | null => {
    if (event.max_attendees && event.max_attendees > 0) {
      if (rosterFull && !event.user_rsvp_status) return "Roster full — you'd be waitlisted";
      // Seats, matching what max_attendees caps — see isRosterFull.
      const taken = event.occupied_seats ?? event.going_count ?? 0;
      return `${taken} of ${event.max_attendees} slots filled`;
    }
    return `${event.going_count ?? 0} going`;
  })();

  return (
    <div
      className={`card relative flex flex-col overflow-hidden transition-all hover:border-red-300 hover:shadow-md ${
        presentation?.accentClass ?? ''
      } ${isSelected ? 'border-red-300 ring-2 ring-red-500/50' : ''}`}
    >
      {presentation && (
        <div
          className={`border-theme-surface-border flex items-center gap-2 border-b px-4 py-2 transition-colors duration-200 ${presentation.stripClass}`}
        >
          {urgency === 'live' ? (
            <span
              className="bg-theme-alert-success-icon animate-live-pulse h-2 w-2 shrink-0 rounded-full"
              aria-hidden="true"
            />
          ) : (
            StripIcon && <StripIcon className={`h-4 w-4 shrink-0 ${presentation.iconClass}`} aria-hidden="true" />
          )}
          {/* The label never shrinks: "HAPPENIN…" is not a status. When the
              two do not fit, the meta truncates — the same fact is spelled out
              in the band, and below `sm` the meta is not rendered at all. */}
          <span className={`shrink-0 ${presentation.labelClass}`}>{presentation.label}</span>
          {stripMeta && (
            <span className="text-theme-text-secondary ml-auto hidden min-w-0 truncate text-xs sm:inline">
              {stripMeta}
            </span>
          )}
        </div>
      )}

      {selectionMode && canManage && (
        <button
          onClick={() => onToggleSelect(event.id)}
          className={`absolute top-3 left-3 z-10 rounded p-0.5 transition-colors ${
            isSelected ? 'text-red-600 dark:text-red-400' : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
          aria-label={isSelected ? `Deselect ${event.title}` : `Select ${event.title}`}
        >
          {isSelected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
        </button>
      )}

      {/* Manager actions: a footer strip on a phone, the card corner from md up.
          In the corner at every width they overlapped the title, and the 96px of
          clearance they needed cut most titles on a single-column phone layout
          to "Monthly Traini…". `order-last` puts the strip below the card body
          while keeping it out of the anchor below.

          The corner offset clears the status strip when there is one — at
          `top-3` the chips land on the strip and cover its right-hand meta
          ("Check-in closes 8:15 PM"), which is the one place that fact appears
          on a phone. */}
      {canManage && (
        <div
          className={`border-theme-surface-border order-last flex items-center justify-end gap-1 border-t px-4 py-2 md:absolute md:right-3 md:z-10 md:order-none md:border-0 md:p-0 ${
            presentation ? 'md:top-11' : 'md:top-3'
          }`}
        >
          <Link
            to={`/events/${event.id}/edit`}
            className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700 shadow-sm transition-colors hover:bg-blue-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 max-md:min-h-[44px] max-md:px-4 dark:bg-blue-500/20 dark:text-blue-300 dark:hover:bg-blue-500/30"
            aria-label={`Edit ${event.title}`}
          >
            <Pencil className="h-3 w-3" aria-hidden="true" />
            Edit
          </Link>
          <button
            type="button"
            onClick={() => onDuplicate(event.id)}
            className="bg-theme-surface-modal text-theme-text-muted hover:bg-theme-surface-hover rounded-full p-1.5 shadow-sm transition-colors hover:text-blue-600 max-md:min-h-[44px] max-md:min-w-[44px] max-md:items-center max-md:justify-center dark:hover:text-blue-400"
            title="Duplicate event"
            aria-label={`Duplicate ${event.title}`}
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
      )}

      <Link to={`/events/${event.id}`} className="block flex-1">
        <div
          className={`flex flex-col gap-3 p-5 ${selectionMode && canManage ? 'pl-10' : ''} ${
            urgency === 'declined' ? 'opacity-75' : ''
          }`}
        >
          {/* The manager chips sit in this corner from md up, so the clearance
              they need belongs on the title block alone — on the whole body it
              also stole 96px from every detail row below. */}
          <div className={`flex items-start justify-between gap-2 ${canManage ? 'md:pr-24' : ''}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {event.event_type === EventTypeEnum.TRAINING && (
                  <svg
                    className="h-5 w-5 shrink-0 text-purple-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                    />
                  </svg>
                )}
                {/* Two lines rather than one truncated one: on a phone the card is a
                    single column and the manager chips claim the right quarter of it,
                    which cut most titles to "Monthly Traini…". */}
                <h3 className="text-theme-text-primary line-clamp-2 text-lg font-medium">{event.title}</h3>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getEventTypeBadgeColor(event.event_type)}`}
                >
                  {getEventTypeLabel(event.event_type)}
                </span>
                {event.is_draft && (
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-500/20 dark:text-gray-300">
                    Draft
                  </span>
                )}
                {event.is_mandatory && (
                  <span className="bg-theme-alert-warning-bg text-theme-alert-warning-title inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
                    Mandatory
                  </span>
                )}
                {(event.is_recurring || event.recurrence_parent_id) && (
                  <span className="bg-theme-alert-purple-bg text-theme-alert-purple-text inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium">
                    <Repeat className="h-3 w-3" />
                    Recurring
                  </span>
                )}
                {/* Only where the status strip does not already say it. The
                    strip covers going / not going / waitlisted; without this a
                    "Maybe" — which is a real answer the member gave — would
                    show nowhere on the card at all. */}
                {!presentation && event.user_rsvp_status && (
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getRSVPStatusColor(event.user_rsvp_status)}`}
                  >
                    {getRSVPStatusLabel(event.user_rsvp_status)}
                  </span>
                )}
              </div>
            </div>
            {event.is_cancelled && (
              <span className="ml-2 inline-flex shrink-0 items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-300">
                Cancelled
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className={DETAIL_ROW_CLASS}>
              <Clock className={DETAIL_ICON_CLASS} aria-hidden="true" />
              <span
                title={`${formatAbsoluteDate(event.start_datetime, timezone)}${timezoneAbbr ? ` ${timezoneAbbr}` : ''}`}
              >
                {formatEventTimeRange(event, timezone, now)}
              </span>
            </div>

            {(event.location_name || event.location) && (
              <div className={DETAIL_ROW_CLASS}>
                <MapPin className={DETAIL_ICON_CLASS} aria-hidden="true" />
                <span className="truncate">{event.location_name || event.location}</span>
              </div>
            )}

            {event.credited_hours != null && (
              <div className={DETAIL_ROW_CLASS}>
                <ClipboardCheck className={DETAIL_ICON_CLASS} aria-hidden="true" />
                {/* "up to", because this is the *scheduled* duration under the
                    org's hour mappings. What actually lands on the member's
                    record is their attended time, settled at check-out — leave
                    a two-hour drill after one hour and you earn 1.0. Stating
                    the ceiling as fact is how a member ends up short of a
                    requirement they believed they had met. */}
                <span className="truncate" title={CREDITED_HOURS_BASIS}>
                  Credits up to{' '}
                  <span className="text-theme-text-primary font-mono">{formatHoursExact(event.credited_hours)}</span>{' '}
                  {event.hour_category_label ? `${event.hour_category_label} hours` : 'hours'}
                </span>
              </div>
            )}

            {rosterLine && (
              <div className={DETAIL_ROW_CLASS}>
                <Users className={DETAIL_ICON_CLASS} aria-hidden="true" />
                <span className="truncate">{rosterLine}</span>
              </div>
            )}
          </div>
        </div>
      </Link>

      {/* Outside the anchor above, or every button press would also navigate. */}
      <div className="border-theme-surface-border bg-theme-surface-secondary flex items-center gap-2 border-t px-5 py-3">
        {urgency === 'live' ? (
          <Link to={`/events/${event.id}/check-in`} className={`btn-success ${FOOTER_BUTTON_CLASS}`}>
            <QrCode className="h-4 w-4" aria-hidden="true" />
            Check In
          </Link>
        ) : urgency === 'missed' ? (
          <Link to={`/events/${event.id}`} className={`btn-secondary ${FOOTER_BUTTON_CLASS}`}>
            View attendance
          </Link>
        ) : urgency === 'waitlisted' ? (
          <button
            type="button"
            onClick={() => onQuickRSVP(event.id, 'not_going')}
            disabled={rsvpLoading}
            className={`btn-secondary ${FOOTER_BUTTON_CLASS}`}
          >
            Leave Waitlist
          </button>
        ) : showRsvpPair ? (
          rosterFull && !event.user_rsvp_status ? (
            <button
              type="button"
              onClick={() => onQuickRSVP(event.id, 'going')}
              disabled={rsvpLoading}
              className={`btn-secondary ${FOOTER_BUTTON_CLASS}`}
            >
              Join Waitlist
            </button>
          ) : (
            <>
              {canAnswerGoing && (
                <button
                  type="button"
                  onClick={() => onQuickRSVP(event.id, 'going')}
                  disabled={rsvpLoading}
                  className={`${urgency === 'action' ? 'btn-primary' : 'btn-secondary'} ${FOOTER_BUTTON_CLASS}`}
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Going
                </button>
              )}
              {canAnswerNotGoing && (
                <button
                  type="button"
                  onClick={() => onQuickRSVP(event.id, 'not_going')}
                  disabled={rsvpLoading}
                  className={`btn-secondary ${FOOTER_BUTTON_CLASS}`}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  Not Going
                </button>
              )}
              {isChangingRsvp && (
                <button
                  type="button"
                  onClick={() => onCancelChangeRsvp(event.id)}
                  className="text-theme-text-muted hover:text-theme-text-primary shrink-0 px-1 text-xs"
                >
                  Cancel
                </button>
              )}
            </>
          )
        ) : rsvpAvailable ? (
          <button
            type="button"
            onClick={() => onStartChangeRsvp(event.id)}
            className={`btn-secondary ${FOOTER_BUTTON_CLASS}`}
          >
            Change RSVP
          </button>
        ) : (
          <span className="flex-1" />
        )}

        <button
          type="button"
          onClick={() => downloadICSFile(event)}
          className="btn-secondary text-theme-text-muted hover:text-theme-text-primary inline-flex h-11 w-11 shrink-0 items-center justify-center p-0"
          aria-label={`Add ${event.title} to calendar`}
          title="Add to calendar"
        >
          <CalendarPlus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

/**
 * Memoized because the page re-derives `paginatedEvents` on every keystroke in
 * the search box, which handed all 25 cards a new array and re-rendered every
 * one of them per character typed. Every prop above is a primitive, a stable
 * `useCallback`, or an object whose identity only changes when that event
 * changes — except `now`, which ticks once a minute on purpose so a check-in
 * window opening actually shows up. So the minute tick still re-renders the
 * grid, and nothing else does.
 */
export const EventListCard = React.memo(EventListCardBase);
