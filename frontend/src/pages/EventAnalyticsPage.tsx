/**
 * Event Analytics Page (#44, #46, #47)
 *
 * Attendance trends dashboard with summary cards, event type
 * distribution chart, monthly trend chart, and top events table.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router';
import { BarChart3, Calendar, CheckCircle, Clock, TrendingUp, Users, ArrowLeft } from 'lucide-react';
import { eventService } from '../services/api';
import { getEventTypeLabel } from '../utils/eventHelpers';
import { formatDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { Breadcrumbs, SkeletonPage } from '../components/ux';
import { DateRangePicker } from '../components/ux';

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

interface EventTypeDistribution {
  eventType: string;
  count: number;
}

interface MonthlyEventCount {
  month: string;
  count: number;
}

interface TopEventByAttendance {
  eventId: string;
  title: string;
  eventType: string;
  startDatetime: string;
  goingCount: number;
  checkedInCount: number;
  attendanceRate: number;
}

interface AnalyticsSummary {
  totalEvents: number;
  totalRsvps: number;
  totalCheckedIn: number;
  avgAttendanceRate: number;
  checkInRate: number;
  avgCheckinMinutesBefore: number | null;
  eventTypeDistribution: EventTypeDistribution[];
  monthlyEventCounts: MonthlyEventCount[];
  topEvents: TopEventByAttendance[];
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

// Snake-case API response shape
interface RawDistItem {
  event_type?: string;
  eventType?: string;
  count?: number;
}

interface RawMonthItem {
  month?: string;
  count?: number;
}

interface RawTopItem {
  event_id?: string;
  eventId?: string;
  title?: string;
  event_type?: string;
  eventType?: string;
  start_datetime?: string;
  startDatetime?: string;
  going_count?: number;
  goingCount?: number;
  checked_in_count?: number;
  checkedInCount?: number;
  attendance_rate?: number;
  attendanceRate?: number;
}

interface RawAnalyticsSummary {
  total_events?: number;
  totalEvents?: number;
  total_rsvps?: number;
  totalRsvps?: number;
  total_checked_in?: number;
  totalCheckedIn?: number;
  avg_attendance_rate?: number;
  avgAttendanceRate?: number;
  check_in_rate?: number;
  checkInRate?: number;
  avg_checkin_minutes_before?: number | null;
  avgCheckinMinutesBefore?: number | null;
  event_type_distribution?: RawDistItem[];
  eventTypeDistribution?: RawDistItem[];
  monthly_event_counts?: RawMonthItem[];
  monthlyEventCounts?: RawMonthItem[];
  top_events?: RawTopItem[];
  topEvents?: RawTopItem[];
}

/** Map snake_case API keys to camelCase. */
function mapSummary(raw: RawAnalyticsSummary): AnalyticsSummary {
  const dist = raw.event_type_distribution ?? raw.eventTypeDistribution ?? [];
  const monthly = raw.monthly_event_counts ?? raw.monthlyEventCounts ?? [];
  const top = raw.top_events ?? raw.topEvents ?? [];

  return {
    totalEvents: raw.total_events ?? raw.totalEvents ?? 0,
    totalRsvps: raw.total_rsvps ?? raw.totalRsvps ?? 0,
    totalCheckedIn: raw.total_checked_in ?? raw.totalCheckedIn ?? 0,
    avgAttendanceRate: raw.avg_attendance_rate ?? raw.avgAttendanceRate ?? 0,
    checkInRate: raw.check_in_rate ?? raw.checkInRate ?? 0,
    avgCheckinMinutesBefore:
      raw.avg_checkin_minutes_before != null
        ? raw.avg_checkin_minutes_before
        : raw.avgCheckinMinutesBefore != null
          ? raw.avgCheckinMinutesBefore
          : null,
    eventTypeDistribution: dist.map((d) => ({
      eventType: d.event_type ?? d.eventType ?? '',
      count: d.count ?? 0,
    })),
    monthlyEventCounts: monthly.map((m) => ({
      month: m.month ?? '',
      count: m.count ?? 0,
    })),
    topEvents: top.map((t) => ({
      eventId: t.event_id ?? t.eventId ?? '',
      title: t.title ?? '',
      eventType: t.event_type ?? t.eventType ?? '',
      startDatetime: t.start_datetime ?? t.startDatetime ?? '',
      goingCount: t.going_count ?? t.goingCount ?? 0,
      checkedInCount: t.checked_in_count ?? t.checkedInCount ?? 0,
      attendanceRate: t.attendance_rate ?? t.attendanceRate ?? 0,
    })),
  };
}

const COLORS: Record<string, string> = {
  business_meeting: 'bg-blue-500',
  public_education: 'bg-green-500',
  training: 'bg-yellow-500',
  social: 'bg-purple-500',
  fundraiser: 'bg-pink-500',
  ceremony: 'bg-orange-500',
  other: 'bg-gray-500',
};

function barColor(eventType: string): string {
  return COLORS[eventType] ?? 'bg-gray-500';
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function monthLabel(yyyyMm: string): string {
  const parts = yyyyMm.split('-');
  const year = parts[0] ?? '';
  const monthNum = parseInt(parts[1] ?? '0', 10);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const name = names[monthNum - 1] ?? '';
  return `${name} ${year}`;
}

// ----------------------------------------------------------------
// Component
// ----------------------------------------------------------------

export const EventAnalyticsPage: React.FC = () => {
  const tz = useTimezone();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (startDate) params['start_date'] = new Date(startDate).toISOString();
      if (endDate) params['end_date'] = new Date(endDate).toISOString();

      const resp = await eventService.getAnalyticsSummary(params);
      setData(mapSummary(resp));
    } catch {
      setError('Failed to load analytics data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumbs />
        <SkeletonPage />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumbs />
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4" role="alert" aria-live="assertive">
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={() => {
              void fetchData();
            }}
            className="mt-2 text-sm text-red-600 underline dark:text-red-400"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const maxTypeCount = Math.max(...data.eventTypeDistribution.map((d) => d.count), 1);
  const maxMonthlyCount = Math.max(...data.monthlyEventCounts.map((m) => m.count), 1);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumbs />

        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/events"
              className="text-theme-text-secondary hover:text-theme-text-primary"
              title="Back to Events"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold sm:text-3xl">
                <BarChart3 className="h-7 w-7" />
                Attendance Trends
              </h1>
              <p className="text-theme-text-secondary mt-1 text-sm">
                Event analytics, attendance rates, and check-in insights
              </p>
            </div>
          </div>
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onChange={(s, e) => {
              setStartDate(s);
              setEndDate(e);
            }}
            label="Period"
          />
        </div>

        {/* Summary Cards */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            icon={<Calendar className="h-5 w-5 text-blue-500" />}
            label="Total Events"
            value={String(data.totalEvents)}
          />
          <SummaryCard
            icon={<TrendingUp className="h-5 w-5 text-green-500" />}
            label="Avg Attendance Rate"
            value={pct(data.avgAttendanceRate)}
          />
          <SummaryCard
            icon={<Users className="h-5 w-5 text-purple-500" />}
            label="Total RSVPs"
            value={String(data.totalRsvps)}
          />
          <SummaryCard
            icon={<CheckCircle className="h-5 w-5 text-emerald-500" />}
            label="Check-in Rate"
            value={pct(data.checkInRate)}
          />
        </div>

        {/* Avg check-in lead time */}
        {data.avgCheckinMinutesBefore != null && (
          <div className="bg-theme-surface border-theme-surface-border mb-8 flex items-center gap-3 rounded-lg border p-4">
            <Clock className="text-theme-text-muted h-5 w-5" />
            <span className="text-theme-text-secondary text-sm">
              Members check in on average{' '}
              <strong className="text-theme-text-primary">
                {Math.abs(data.avgCheckinMinutesBefore).toFixed(0)} min
              </strong>{' '}
              {data.avgCheckinMinutesBefore >= 0 ? 'before' : 'after'} event start
            </span>
          </div>
        )}

        {/* Charts Row */}
        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Event Type Distribution (#46) */}
          <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-5">
            <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Event Type Distribution</h2>
            {data.eventTypeDistribution.length === 0 ? (
              <p className="text-theme-text-muted text-sm">No event data available.</p>
            ) : (
              <div className="space-y-3">
                {data.eventTypeDistribution.map((d) => (
                  <div key={d.eventType}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-theme-text-secondary">{getEventTypeLabel(d.eventType)}</span>
                      <span className="text-theme-text-primary font-medium">{d.count}</span>
                    </div>
                    <div className="bg-theme-surface-hover h-3 w-full rounded-full">
                      <div
                        className={`h-3 rounded-full transition-all ${barColor(d.eventType)}`}
                        style={{
                          width: `${Math.round((d.count / maxTypeCount) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Monthly Trend (#44) */}
          <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-5">
            <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Monthly Event Trend</h2>
            {data.monthlyEventCounts.length === 0 ? (
              <p className="text-theme-text-muted text-sm">No event data available.</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="flex h-48 min-w-full items-end gap-2">
                  {data.monthlyEventCounts.map((m) => {
                    const heightPct = Math.max(Math.round((m.count / maxMonthlyCount) * 100), 4);
                    return (
                      <div key={m.month} className="flex h-full min-w-[36px] flex-1 flex-col items-center justify-end">
                        <span className="text-theme-text-primary mb-1 text-xs font-medium">{m.count}</span>
                        <div
                          className="w-full rounded-t bg-blue-500 transition-all"
                          style={{ height: `${heightPct}%` }}
                          title={`${monthLabel(m.month)}: ${m.count} events`}
                        />
                        <span className="text-theme-text-muted mt-1 w-full truncate text-center text-[10px]">
                          {monthLabel(m.month)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Top Events by Attendance (#47) */}
        <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-5">
          <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Top Events by Attendance</h2>
          {data.topEvents.length === 0 ? (
            <p className="text-theme-text-muted text-sm">No attendance data available.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-theme-surface-border text-theme-text-secondary border-b text-left">
                    <th scope="col" className="pr-4 pb-2">
                      Event
                    </th>
                    <th scope="col" className="pr-4 pb-2">
                      Type
                    </th>
                    <th scope="col" className="pr-4 pb-2">
                      Date
                    </th>
                    <th scope="col" className="pr-4 pb-2 text-right">
                      RSVPs
                    </th>
                    <th scope="col" className="pr-4 pb-2 text-right">
                      Checked In
                    </th>
                    <th scope="col" className="pb-2 text-right">
                      Rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.topEvents.map((e) => (
                    <tr key={e.eventId} className="border-theme-surface-border/50 border-b last:border-0">
                      <td className="py-2 pr-4">
                        <Link
                          to={`/events/${e.eventId}`}
                          className="text-theme-text-primary font-medium hover:underline"
                        >
                          {e.title}
                        </Link>
                      </td>
                      <td className="text-theme-text-secondary py-2 pr-4">{getEventTypeLabel(e.eventType)}</td>
                      <td className="text-theme-text-secondary py-2 pr-4">{formatDate(e.startDatetime, tz)}</td>
                      <td className="text-theme-text-primary py-2 pr-4 text-right">{e.goingCount}</td>
                      <td className="text-theme-text-primary py-2 pr-4 text-right">{e.checkedInCount}</td>
                      <td className="py-2 text-right">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            e.attendanceRate >= 0.8
                              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                              : e.attendanceRate >= 0.5
                                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                                : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                          }`}
                        >
                          {pct(e.attendanceRate)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------
// Summary Card
// ----------------------------------------------------------------

interface SummaryCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ icon, label, value }) => (
  <div className="bg-theme-surface border-theme-surface-border flex items-center gap-4 rounded-lg border p-4">
    <div className="bg-theme-surface-hover rounded-lg p-2">{icon}</div>
    <div>
      <p className="text-theme-text-secondary text-sm">{label}</p>
      <p className="text-theme-text-primary text-2xl font-bold">{value}</p>
    </div>
  </div>
);

export default EventAnalyticsPage;
