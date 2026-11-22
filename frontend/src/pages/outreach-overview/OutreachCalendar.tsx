/**
 * The Outreach Overview's planning calendar: week and month, the way Shift
 * Scheduling draws them (owner decision, 2026-11-21), with the selected day's
 * events listed beside the grid.
 *
 * Read-only. Each event opens on its own page, where its signup sheet, crew
 * and close-out already live; nothing is edited here.
 */

import React from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight, Truck, Users } from 'lucide-react';
import type { OutreachCalendarItem } from '../../types/event';
import { formatCalendarDate, formatTime } from '../../utils/dateFormatting';
import { isSameDay, toDateKey, weeksOf } from '../../modules/scheduling/utils/shiftBoard';
import { requestPagePath } from '../event-requests/requestInbox';
import { getEventTypeLabel } from '../../utils/eventHelpers';
import { fillLabels, openSeats, type CalendarView } from './outreachOverview';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Chips beyond this are summarised, so a busy day cannot blow the row open. */
const MAX_CHIPS = 2;

const SHORT_TONE = 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200';
const FULL_TONE = 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200';
const NEUTRAL_TONE = 'bg-theme-surface-secondary text-theme-text-secondary';

const chipTone = (item: OutreachCalendarItem): string => {
  if (fillLabels(item).length === 0) return NEUTRAL_TONE;
  return openSeats(item) > 0 ? SHORT_TONE : FULL_TONE;
};

const dayLabel = (key: string): string => formatCalendarDate(key, { weekday: 'long', month: 'long', day: 'numeric' });

const countLabel = (count: number): string =>
  count === 0 ? 'no outreach' : `${count} outreach event${count === 1 ? '' : 's'}`;

export interface OutreachCalendarProps {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  days: Date[];
  /** The month a month view shows, so the grid's padding days are left blank. */
  visibleMonth: number;
  title: string;
  itemsByDay: Map<string, OutreachCalendarItem[]>;
  selectedDate: Date;
  today: Date;
  timezone: string;
  /** Narrow screens get a compact month grid and a day list for the week. */
  compact: boolean;
  loading: boolean;
  error: string | null;
  onSelect: (date: Date) => void;
  onStep: (direction: -1 | 1) => void;
  onToday: () => void;
}

export const OutreachDayList: React.FC<{ items: OutreachCalendarItem[]; timezone: string }> = ({ items, timezone }) => {
  if (items.length === 0) {
    return <p className="text-theme-text-muted px-4 py-6 text-sm">No outreach on this day.</p>;
  }
  return (
    <ul className="divide-theme-surface-border divide-y">
      {items.map((item) => (
        <li key={item.event_id} className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/events/${item.event_id}`}
              className="text-theme-text-primary focus-visible:ring-theme-focus-ring touch:min-h-11 inline-flex min-w-0 items-center font-semibold break-words hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              {item.title}
            </Link>
            {item.is_draft && <span className={`badge ${NEUTRAL_TONE}`}>Draft</span>}
          </div>
          <p className="text-theme-text-secondary mt-0.5 text-sm">
            {formatTime(item.start_datetime, timezone)} – {formatTime(item.end_datetime, timezone)} ·{' '}
            {getEventTypeLabel(item.event_type)}
          </p>
          {item.location && <p className="text-theme-text-muted text-sm break-words">{item.location}</p>}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {fillLabels(item).map((label) => (
              <span
                key={label.text}
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${label.short ? SHORT_TONE : FULL_TONE}`}
              >
                {label.text}
              </span>
            ))}
            {item.unit_numbers.length > 0 && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${NEUTRAL_TONE}`}
              >
                <Truck className="h-3 w-3" aria-hidden="true" />
                {item.unit_numbers.join(' + ')}
              </span>
            )}
          </div>
          {item.request_id && (
            <Link
              to={requestPagePath(item.request_id)}
              className="text-theme-text-secondary focus-visible:ring-theme-focus-ring touch:min-h-11 mt-1 inline-flex items-center gap-1 text-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              Request{item.request_organization ? ` from ${item.request_organization}` : ''}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
};

export const OutreachCalendar: React.FC<OutreachCalendarProps> = ({
  view,
  onViewChange,
  days,
  visibleMonth,
  title,
  itemsByDay,
  selectedDate,
  today,
  timezone,
  compact,
  loading,
  error,
  onSelect,
  onStep,
  onToday,
}) => {
  const selectedKey = toDateKey(selectedDate);
  const selectedItems = itemsByDay.get(selectedKey) ?? [];
  const stepNoun = view === 'week' ? 'week' : 'month';

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onStep(-1)} className="btn-icon" aria-label={`Previous ${stepNoun}`}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={onToday} className="btn-secondary touch:min-h-11 px-3 py-1.5 text-sm">
          Today
        </button>
        <button type="button" onClick={() => onStep(1)} className="btn-icon" aria-label={`Next ${stepNoun}`}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <h3 className="text-theme-text-primary ml-2 font-semibold" aria-live="polite">
          {title}
        </h3>
      </div>
      <div className="segmented-group flex gap-1" role="group" aria-label="Calendar view">
        {(['week', 'month'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onViewChange(option)}
            aria-pressed={view === option}
            className={`touch:min-h-11 rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
              view === option
                ? 'bg-red-800 text-white'
                : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );

  const dayCell = (day: Date) => {
    const key = toDateKey(day);
    if (view === 'month' && day.getMonth() !== visibleMonth) {
      // An empty cell, not a hidden one: a last row of nothing but next
      // month's days would otherwise leave a row with no cells in it.
      return <div key={key} role="gridcell" />;
    }
    const items = itemsByDay.get(key) ?? [];
    const selected = isSameDay(day, selectedDate);
    const isToday = isSameDay(day, today);
    const shortCount = items.filter((item) => openSeats(item) > 0).length;
    return (
      <button
        key={key}
        type="button"
        role="gridcell"
        aria-selected={selected}
        aria-current={isToday ? 'date' : undefined}
        onClick={() => onSelect(day)}
        className={`card focus-visible:ring-theme-focus-ring flex cursor-pointer flex-col gap-1 overflow-hidden p-1.5 text-left focus-visible:ring-2 focus-visible:outline-none ${
          compact ? 'min-h-11 items-center' : view === 'week' ? 'min-h-40' : 'min-h-24'
        } ${selected ? 'border-2 border-red-700 dark:border-red-500' : ''}`}
      >
        <span
          className={`font-mono text-sm font-bold ${
            isToday
              ? 'flex h-6 w-6 items-center justify-center rounded-full bg-red-800 text-white'
              : 'text-theme-text-primary'
          }`}
        >
          {day.getDate()}
        </span>
        <span className="sr-only">
          {dayLabel(key)}, {countLabel(items.length)}
          {shortCount > 0 ? `, ${shortCount} short of people` : ''}
        </span>
        {compact
          ? items.length > 0 && (
              <span
                aria-hidden="true"
                className={`rounded-full px-1.5 text-xs font-semibold ${shortCount > 0 ? SHORT_TONE : FULL_TONE}`}
              >
                {items.length}
              </span>
            )
          : (view === 'week' ? items : items.slice(0, MAX_CHIPS)).map((item) => (
              <span
                key={item.event_id}
                aria-hidden="true"
                className={`block w-full truncate rounded-md px-1.5 py-0.5 text-xs font-medium ${chipTone(item)}`}
              >
                {formatTime(item.start_datetime, timezone)} {item.title}
              </span>
            ))}
        {!compact && view === 'month' && items.length > MAX_CHIPS && (
          <span aria-hidden="true" className="text-theme-text-muted text-xs">
            +{items.length - MAX_CHIPS} more
          </span>
        )}
      </button>
    );
  };

  // A phone's week is a list of days, not seven slivers.
  const weekList = (
    <ul className="space-y-2" aria-label="Week">
      {days.map((day) => {
        const key = toDateKey(day);
        const items = itemsByDay.get(key) ?? [];
        const selected = isSameDay(day, selectedDate);
        return (
          <li key={key}>
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(day)}
              className={`card focus-visible:ring-theme-focus-ring flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left focus-visible:ring-2 focus-visible:outline-none ${
                selected ? 'border-2 border-red-700 dark:border-red-500' : ''
              }`}
            >
              <span className="text-theme-text-primary text-sm font-semibold">{dayLabel(key)}</span>
              <span className="text-theme-text-secondary text-sm">{countLabel(items.length)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  const grid = (
    <div>
      <div className={`mb-1.5 grid grid-cols-7 ${compact ? 'gap-0' : 'gap-1.5'}`} aria-hidden="true">
        {WEEKDAYS.map((day) => (
          <div key={day} className="text-theme-text-muted text-center text-xs font-bold tracking-wider uppercase">
            {compact ? day.charAt(0) : day}
          </div>
        ))}
      </div>
      <div
        className={`grid grid-cols-7 ${compact ? 'gap-0' : 'gap-1.5'}`}
        role="grid"
        aria-label={`${title}, outreach calendar`}
      >
        {weeksOf(days).map((week, index) => (
          <div key={`week-${index}`} role="row" className="contents">
            {week.map(dayCell)}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <section className="card p-2 sm:p-4" aria-labelledby="outreach-calendar-heading" aria-busy={loading}>
      <h2 id="outreach-calendar-heading" className="text-theme-text-primary mb-3 text-lg font-semibold">
        Planning calendar
      </h2>
      {toolbar}
      {error && (
        <p className="alert-danger mt-3 text-sm" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {compact && view === 'week' ? weekList : grid}
        <section className="card-secondary overflow-hidden" aria-labelledby="outreach-day-heading">
          <h3
            id="outreach-day-heading"
            className="text-theme-text-primary border-theme-surface-border border-b px-4 py-3 font-semibold"
          >
            {dayLabel(selectedKey)}
          </h3>
          <OutreachDayList items={selectedItems} timezone={timezone} />
        </section>
      </div>
    </section>
  );
};

export default OutreachCalendar;
