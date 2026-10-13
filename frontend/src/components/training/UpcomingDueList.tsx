/**
 * "Upcoming expirations & due dates" for the My Training landing tab: what the
 * member has to do in the next six months, soonest first. See
 * `utils/trainingUpcoming.ts` for what counts.
 */

import React from 'react';
import { AlertTriangle, Award, CalendarClock, CalendarPlus, CheckCircle2, Clock } from 'lucide-react';
import { formatCalendarDate } from '../../utils/dateFormatting';
import { UPCOMING_WINDOW_DAYS, type UpcomingItem, type UpcomingUrgency } from '../../utils/trainingUpcoming';

const PILL: Record<UpcomingUrgency, string> = {
  overdue: 'bg-red-500/10 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  soon: 'bg-yellow-500/10 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300',
  later: 'bg-theme-surface-secondary text-theme-text-secondary',
};

const BORDER: Record<UpcomingUrgency, string> = {
  overdue: 'border-red-500/40',
  soon: 'border-yellow-500/30',
  later: 'border-theme-surface-border',
};

const ICON_FOR = (item: UpcomingItem): React.ElementType => {
  if (item.urgency === 'overdue') return AlertTriangle;
  if (item.kind === 'certification') return Award;
  if (item.kind === 'window') return CalendarPlus;
  return item.urgency === 'soon' ? Clock : CalendarClock;
};

const describe = (item: UpcomingItem): string => {
  const date = formatCalendarDate(item.date);
  if (item.kind === 'window') {
    return item.days <= 0 ? `Open since ${date}` : `Opens ${date} · ${item.days} ${item.days === 1 ? 'day' : 'days'}`;
  }
  const verb = item.kind === 'certification' ? 'Expires' : 'Due';
  if (item.days < 0) {
    const late = Math.abs(item.days);
    return `${item.kind === 'certification' ? 'Expired' : 'Overdue'} ${late} ${late === 1 ? 'day' : 'days'} ago`;
  }
  if (item.days === 0) return `${verb} today`;
  return `${verb} ${date} · ${item.days} ${item.days === 1 ? 'day' : 'days'}`;
};

export const UpcomingDueList: React.FC<{ items: UpcomingItem[] }> = ({ items }) => {
  const months = Math.round(UPCOMING_WINDOW_DAYS / 30.5);
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 py-1">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-green-700 dark:text-green-400" aria-hidden="true" />
        <p className="text-theme-text-secondary text-sm">Nothing is due or expiring in the next {months} months.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const Icon = ICON_FOR(item);
        return (
          <li key={item.key} className={`card flex items-center justify-between gap-3 p-3 ${BORDER[item.urgency]}`}>
            <div className="flex min-w-0 items-center gap-3">
              <Icon className="text-theme-text-muted h-5 w-5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-theme-text-primary text-sm font-medium">{item.title}</p>
                <p className="text-theme-text-muted text-xs">{item.detail}</p>
              </div>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${PILL[item.urgency]}`}>
              {describe(item)}
            </span>
          </li>
        );
      })}
    </ul>
  );
};
