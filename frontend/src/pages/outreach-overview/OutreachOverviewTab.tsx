/**
 * Outreach Overview — the Community Outreach Manager's home page
 * (owner decisions, 2026-11-21).
 *
 * What needs the manager now (requests waiting for a reply, events short of
 * people, events waiting to be closed out), a week or month planning calendar
 * of every outreach event, and the year's Outreach Impact at a glance. It
 * gathers what the other Community Outreach pages already hold and links into
 * them; it edits nothing itself.
 *
 * Lazy-loaded as the first page of the Community Outreach area in
 * EventsAdminHub. Each source loads on its own, so one failing leaves the rest
 * of the page standing.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  ClipboardCheck,
  Clock,
  Inbox,
  Phone,
  ShieldCheck,
  Truck,
  Users,
} from 'lucide-react';
import { dashboardService, eventRequestService, eventService } from '../../services/api';
import type { CommunityReachTotals } from '../../services/api';
import type { EventRequestListItem, OutreachCalendarItem } from '../../types/event';
import { useTimezone } from '../../hooks/useTimezone';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import {
  formatCalendarDate,
  formatDate,
  formatNumber,
  formatTime,
  getTodayLocalDate,
} from '../../utils/dateFormatting';
import { formatHours } from '../../utils/hoursFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { REQUEST_BOARD_PATH, requestPagePath } from '../event-requests/requestInbox';
import { toDateKey } from '../../modules/scheduling/utils/shiftBoard';
import OutreachCalendar from './OutreachCalendar';
import {
  ATTENTION_LIST_LIMIT,
  CLOSEOUT_LOOKBACK_DAYS,
  UPCOMING_DAYS,
  attentionRange,
  dateFromKey,
  fillLabels,
  isAwaitingCloseout,
  isShortStaffed,
  isUpcoming,
  itemsByDay,
  rangeFor,
  requestsAwaitingReply,
  stepDate,
  viewDays,
  type CalendarView,
} from './outreachOverview';

const IMPACT_PATH = '/events/admin?tab=community';

interface Loadable<T> {
  data: T;
  error: string | null;
}

interface AttentionCardProps {
  id: string;
  icon: React.ElementType;
  title: string;
  hint: string;
  count: number | null;
  error: string | null;
  empty: string;
  viewAll?: { to: string; label: string } | undefined;
  children: React.ReactNode;
}

const AttentionCard: React.FC<AttentionCardProps> = ({
  id,
  icon: Icon,
  title,
  hint,
  count,
  error,
  empty,
  viewAll,
  children,
}) => (
  <section className="card flex flex-col p-4" aria-labelledby={id}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 id={id} className="text-theme-text-primary flex items-center gap-2 font-semibold">
          <Icon className="h-4 w-4 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
          {title}
        </h3>
        <p className="text-theme-text-muted mt-0.5 text-sm">{hint}</p>
      </div>
      {count !== null && (
        <span className="text-theme-text-primary text-2xl font-bold tabular-nums" aria-label={`${count} ${title}`}>
          {formatNumber(count)}
        </span>
      )}
    </div>
    <div className="mt-3 flex-1">
      {error ? (
        <p className="text-theme-text-secondary text-sm" role="alert">
          {error}
        </p>
      ) : count === 0 ? (
        <p className="text-theme-text-muted text-sm">{empty}</p>
      ) : (
        children
      )}
    </div>
    {viewAll && !error && count !== null && count > ATTENTION_LIST_LIMIT && (
      <Link
        to={viewAll.to}
        className="text-theme-text-secondary focus-visible:ring-theme-focus-ring touch:min-h-11 mt-3 inline-flex items-center text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
      >
        {viewAll.label}
      </Link>
    )}
  </section>
);

const rowLinkClass =
  'hover:bg-theme-surface-hover focus-visible:ring-theme-focus-ring -mx-2 flex min-h-11 flex-col justify-center rounded-md px-2 py-1.5 focus-visible:ring-2 focus-visible:outline-none';

const EventRow: React.FC<{ item: OutreachCalendarItem; timezone: string; detail: string }> = ({
  item,
  timezone,
  detail,
}) => (
  <li>
    <Link to={`/events/${item.event_id}`} className={rowLinkClass}>
      <span className="text-theme-text-primary text-sm font-medium break-words">{item.title}</span>
      <span className="text-theme-text-muted text-sm">
        {formatDate(item.start_datetime, timezone)} · {formatTime(item.start_datetime, timezone)} · {detail}
      </span>
    </Link>
  </li>
);

const Tile: React.FC<{ icon: React.ElementType; label: string; value: string; sub: string }> = ({
  icon: Icon,
  label,
  value,
  sub,
}) => (
  <div className="card-secondary p-4" role="group" aria-label={label}>
    <div className="text-theme-text-muted mb-1 flex items-center gap-2 text-xs font-semibold tracking-wider uppercase">
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{label}</span>
    </div>
    <div className="text-theme-text-primary text-2xl font-bold tabular-nums">{value}</div>
    <div className="text-theme-text-muted mt-1 text-sm">{sub}</div>
  </div>
);

const OutreachOverviewTab: React.FC = () => {
  const tz = useTimezone();
  const compact = useMediaQuery('(max-width: 767px)');
  const todayKey = getTodayLocalDate(tz);
  const today = useMemo(() => dateFromKey(todayKey), [todayKey]);

  const [view, setView] = useState<CalendarView>('month');
  const [visibleDate, setVisibleDate] = useState<Date>(today);
  const [selectedDate, setSelectedDate] = useState<Date>(today);

  const [calendar, setCalendar] = useState<Loadable<OutreachCalendarItem[]>>({ data: [], error: null });
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [ahead, setAhead] = useState<Loadable<OutreachCalendarItem[]> | null>(null);
  const [requests, setRequests] = useState<Loadable<EventRequestListItem[]> | null>(null);
  const [impact, setImpact] = useState<Loadable<CommunityReachTotals | null> | null>(null);

  const days = useMemo(() => viewDays(view, visibleDate), [view, visibleDate]);

  useEffect(() => {
    let cancelled = false;
    const { start, end } = attentionRange(todayKey, tz);
    void Promise.allSettled([
      eventService.getOutreachCalendar(start, end),
      eventRequestService.listRequests(),
      dashboardService.getCommunityEngagement('year'),
    ]).then(([aheadResult, requestResult, impactResult]) => {
      if (cancelled) return;
      setAhead(
        aheadResult.status === 'fulfilled'
          ? { data: aheadResult.value, error: null }
          : { data: [], error: getErrorMessage(aheadResult.reason, 'Outreach events could not be loaded.') }
      );
      setRequests(
        requestResult.status === 'fulfilled'
          ? { data: requestResult.value, error: null }
          : { data: [], error: getErrorMessage(requestResult.reason, 'Requests could not be loaded.') }
      );
      setImpact(
        impactResult.status === 'fulfilled'
          ? { data: impactResult.value.current, error: null }
          : { data: null, error: getErrorMessage(impactResult.reason, 'Outreach Impact could not be loaded.') }
      );
    });
    return () => {
      cancelled = true;
    };
  }, [todayKey, tz]);

  const loadCalendar = useCallback(async (shown: Date[], timezone: string, isCurrent: () => boolean) => {
    setCalendarLoading(true);
    try {
      const { start, end } = rangeFor(shown, timezone);
      const data = await eventService.getOutreachCalendar(start, end);
      if (isCurrent()) setCalendar({ data, error: null });
    } catch (err: unknown) {
      if (isCurrent()) setCalendar({ data: [], error: getErrorMessage(err, 'The calendar could not be loaded.') });
    } finally {
      if (isCurrent()) setCalendarLoading(false);
    }
  }, []);

  useEffect(() => {
    let current = true;
    void loadCalendar(days, tz, () => current);
    return () => {
      current = false;
    };
  }, [days, tz, loadCalendar]);

  const byDay = useMemo(() => itemsByDay(calendar.data, tz), [calendar.data, tz]);

  const now = new Date();
  const aheadItems = ahead?.data ?? [];
  const shortStaffed = aheadItems.filter((item) => isShortStaffed(item, now));
  // Most recent first: yesterday's event is the one people still remember.
  const awaitingCloseout = aheadItems.filter((item) => isAwaitingCloseout(item, now)).reverse();
  const upcomingCount = aheadItems.filter((item) => isUpcoming(item, now)).length;
  const awaitingReply = requestsAwaitingReply(requests?.data ?? []);

  const calendarTitle =
    view === 'month'
      ? formatCalendarDate(toDateKey(new Date(visibleDate.getFullYear(), visibleDate.getMonth(), 1)), {
          month: 'long',
          year: 'numeric',
        })
      : `Week of ${formatCalendarDate(toDateKey(days[0] ?? visibleDate), { month: 'long', day: 'numeric' })}`;

  const step = (direction: -1 | 1) => {
    const next = stepDate(view, visibleDate, direction);
    setVisibleDate(next);
    setSelectedDate(next);
  };

  const goToday = () => {
    setVisibleDate(today);
    setSelectedDate(today);
  };

  return (
    <div className="space-y-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-theme-text-primary flex items-center gap-2 text-lg font-bold">
            <CalendarDays className="h-5 w-5 text-red-700 dark:text-red-400" aria-hidden="true" />
            Overview
          </h2>
          <p className="text-theme-text-muted mt-1 text-sm">
            {ahead && !ahead.error
              ? `${formatNumber(upcomingCount)} outreach ${upcomingCount === 1 ? 'event' : 'events'} in the next ${UPCOMING_DAYS} days.`
              : 'What needs you now, and what is coming up.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/events/new" className="btn-primary flex items-center gap-2">
            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
            New outreach event
          </Link>
          <Link to={`${REQUEST_BOARD_PATH}&new=1`} className="btn-secondary flex items-center gap-2">
            <Phone className="h-4 w-4" aria-hidden="true" />
            Log a request
          </Link>
          <Link to="/events/crr-activities?new=1" className="btn-secondary flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Log a CRR activity
          </Link>
          <Link to="/events/admin?tab=apparatus_events" className="btn-secondary flex items-center gap-2">
            <Truck className="h-4 w-4" aria-hidden="true" />
            Apparatus nights
          </Link>
        </div>
      </div>

      <section aria-labelledby="outreach-attention-heading">
        <h2 id="outreach-attention-heading" className="text-theme-text-primary mb-3 text-lg font-semibold">
          Needs attention
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <AttentionCard
            id="attention-reply"
            icon={Inbox}
            title="Waiting for a reply"
            hint="New requests nobody has started on"
            count={requests ? awaitingReply.length : null}
            error={requests?.error ?? null}
            empty="Every request has a reply."
            viewAll={{ to: REQUEST_BOARD_PATH, label: 'All requests' }}
          >
            <ul className="space-y-1">
              {awaitingReply.slice(0, ATTENTION_LIST_LIMIT).map((request) => (
                <li key={request.id}>
                  <Link to={requestPagePath(request.id)} className={rowLinkClass}>
                    <span className="text-theme-text-primary text-sm font-medium break-words">
                      {request.organization_name || request.contact_name}
                    </span>
                    <span className="text-theme-text-muted text-sm">
                      Received {formatDate(request.created_at, tz)}
                      {request.assignee_name ? ` · ${request.assignee_name}` : ' · Unassigned'}
                      {request.short_notice ? ' · Short notice' : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </AttentionCard>

          <AttentionCard
            id="attention-short"
            icon={Users}
            title="Short of people"
            hint={`Volunteer or crew seats still open, next ${UPCOMING_DAYS} days`}
            count={ahead ? shortStaffed.length : null}
            error={ahead?.error ?? null}
            empty="Every signup sheet and crew is full."
          >
            <ul className="space-y-1">
              {shortStaffed.slice(0, ATTENTION_LIST_LIMIT).map((item) => (
                <EventRow
                  key={item.event_id}
                  item={item}
                  timezone={tz}
                  detail={fillLabels(item)
                    .filter((label) => label.short)
                    .map((label) => label.text)
                    .join(', ')}
                />
              ))}
            </ul>
          </AttentionCard>

          <AttentionCard
            id="attention-closeout"
            icon={ClipboardCheck}
            title="Waiting to be closed out"
            hint={`Over, with attendance not finalized, last ${CLOSEOUT_LOOKBACK_DAYS} days`}
            count={ahead ? awaitingCloseout.length : null}
            error={ahead?.error ?? null}
            empty="Every recent event is closed out."
          >
            <ul className="space-y-1">
              {awaitingCloseout.slice(0, ATTENTION_LIST_LIMIT).map((item) => (
                <EventRow key={item.event_id} item={item} timezone={tz} detail="Finalize attendance" />
              ))}
            </ul>
          </AttentionCard>
        </div>
      </section>

      <OutreachCalendar
        view={view}
        onViewChange={setView}
        days={days}
        visibleMonth={visibleDate.getMonth()}
        title={calendarTitle}
        itemsByDay={byDay}
        selectedDate={selectedDate}
        today={today}
        timezone={tz}
        compact={compact}
        loading={calendarLoading}
        error={calendar.error}
        onSelect={setSelectedDate}
        onStep={step}
        onToday={goToday}
      />

      <section aria-labelledby="outreach-glance-heading">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="outreach-glance-heading" className="text-theme-text-primary text-lg font-semibold">
            This year at a glance
          </h2>
          <Link
            to={IMPACT_PATH}
            className="text-theme-text-secondary focus-visible:ring-theme-focus-ring touch:min-h-11 inline-flex items-center text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            Full Outreach Impact report
          </Link>
        </div>
        {impact?.error ? (
          <p className="alert-warning flex items-center gap-2 text-sm" role="alert">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {impact.error}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy={!impact}>
            <Tile
              icon={CalendarDays}
              label="Events held"
              value={impact?.data ? formatNumber(impact.data.events_held) : '—'}
              sub="Outreach events that happened"
            />
            <Tile
              icon={Users}
              label="People reached"
              value={impact?.data ? formatNumber(impact.data.people_reached) : '—'}
              sub={
                impact?.data
                  ? `${formatNumber(impact.data.counted)} counted · ${formatNumber(impact.data.estimated)} estimated`
                  : 'Counted and estimated'
              }
            />
            <Tile
              icon={Clock}
              label="Member hours"
              value={impact?.data ? formatHours(impact.data.member_hours) : '—'}
              sub="Given to outreach"
            />
            <Tile
              icon={Inbox}
              label="Requests completed"
              value={impact?.data ? formatNumber(impact.data.requests_completed) : '—'}
              sub={impact?.data ? `${formatNumber(impact.data.requests_received)} received` : 'Of those received'}
            />
          </div>
        )}
      </section>
    </div>
  );
};

export default OutreachOverviewTab;
