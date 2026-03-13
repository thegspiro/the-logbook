/**
 * Event Analytics Page (#44, #46, #47)
 *
 * Attendance trends dashboard with summary cards, event type
 * distribution chart, monthly trend chart, and top events table.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3,
  Calendar,
  CheckCircle,
  Clock,
  TrendingUp,
  Users,
  ArrowLeft,
} from 'lucide-react';
import { eventService } from '../services/api';
import { getEventTypeLabel } from '../utils/eventHelpers';
import { formatDate } from '../utils/dateFormatting';
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
      setData(mapSummary(resp as RawAnalyticsSummary));
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumbs />
        <SkeletonPage />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumbs />
        <div
          className="bg-red-500/10 border border-red-500/30 rounded-lg p-4"
          role="alert"
        >
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={() => { void fetchData(); }}
            className="mt-2 text-sm underline text-red-600 dark:text-red-400"
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumbs />

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6">
          <div className="flex items-center gap-3">
            <Link
              to="/events"
              className="text-theme-text-secondary hover:text-theme-text-primary"
              title="Back to Events"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-theme-text-primary flex items-center gap-2">
                <BarChart3 className="h-7 w-7" />
                Attendance Trends
              </h1>
              <p className="mt-1 text-sm text-theme-text-secondary">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
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
          <div className="mb-8 bg-theme-surface border border-theme-surface-border rounded-lg p-4 flex items-center gap-3">
            <Clock className="h-5 w-5 text-theme-text-muted" />
            <span className="text-sm text-theme-text-secondary">
              Members check in on average{' '}
              <strong className="text-theme-text-primary">
                {Math.abs(data.avgCheckinMinutesBefore).toFixed(0)} min
              </strong>{' '}
              {data.avgCheckinMinutesBefore >= 0 ? 'before' : 'after'} event start
            </span>
          </div>
        )}

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Event Type Distribution (#46) */}
          <div className="bg-theme-surface border border-theme-surface-border rounded-lg p-5">
            <h2 className="text-lg font-semibold text-theme-text-primary mb-4">
              Event Type Distribution
            </h2>
            {data.eventTypeDistribution.length === 0 ? (
              <p className="text-sm text-theme-text-muted">No event data available.</p>
            ) : (
              <div className="space-y-3">
                {data.eventTypeDistribution.map((d) => (
                  <div key={d.eventType}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-theme-text-secondary">
                        {getEventTypeLabel(d.eventType)}
                      </span>
                      <span className="text-theme-text-primary font-medium">
                        {d.count}
                      </span>
                    </div>
                    <div className="w-full bg-theme-surface-hover rounded-full h-3">
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
          <div className="bg-theme-surface border border-theme-surface-border rounded-lg p-5">
            <h2 className="text-lg font-semibold text-theme-text-primary mb-4">
              Monthly Event Trend
            </h2>
            {data.monthlyEventCounts.length === 0 ? (
              <p className="text-sm text-theme-text-muted">No event data available.</p>
            ) : (
              <div className="flex items-end gap-2 h-48">
                {data.monthlyEventCounts.map((m) => {
                  const heightPct = Math.max(
                    Math.round((m.count / maxMonthlyCount) * 100),
                    4,
                  );
                  return (
                    <div
                      key={m.month}
                      className="flex-1 flex flex-col items-center justify-end h-full"
                    >
                      <span className="text-xs text-theme-text-primary font-medium mb-1">
                        {m.count}
                      </span>
                      <div
                        className="w-full bg-blue-500 rounded-t transition-all"
                        style={{ height: `${heightPct}%` }}
                        title={`${monthLabel(m.month)}: ${m.count} events`}
                      />
                      <span className="text-[10px] text-theme-text-muted mt-1 truncate w-full text-center">
                        {monthLabel(m.month)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Top Events by Attendance (#47) */}
        <div className="bg-theme-surface border border-theme-surface-border rounded-lg p-5">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-4">
            Top Events by Attendance
          </h2>
          {data.topEvents.length === 0 ? (
            <p className="text-sm text-theme-text-muted">No attendance data available.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-theme-surface-border text-left text-theme-text-secondary">
                    <th className="pb-2 pr-4">Event</th>
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2 pr-4">Date</th>
                    <th className="pb-2 pr-4 text-right">RSVPs</th>
                    <th className="pb-2 pr-4 text-right">Checked In</th>
                    <th className="pb-2 text-right">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topEvents.map((e) => (
                    <tr
                      key={e.eventId}
                      className="border-b border-theme-surface-border/50 last:border-0"
                    >
                      <td className="py-2 pr-4">
                        <Link
                          to={`/events/${e.eventId}`}
                          className="text-theme-text-primary hover:underline font-medium"
                        >
                          {e.title}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-theme-text-secondary">
                        {getEventTypeLabel(e.eventType)}
                      </td>
                      <td className="py-2 pr-4 text-theme-text-secondary">
                        {formatDate(e.startDatetime)}
                      </td>
                      <td className="py-2 pr-4 text-right text-theme-text-primary">
                        {e.goingCount}
                      </td>
                      <td className="py-2 pr-4 text-right text-theme-text-primary">
                        {e.checkedInCount}
                      </td>
                      <td className="py-2 text-right">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
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
  <div className="bg-theme-surface border border-theme-surface-border rounded-lg p-4 flex items-center gap-4">
    <div className="p-2 rounded-lg bg-theme-surface-hover">{icon}</div>
    <div>
      <p className="text-sm text-theme-text-secondary">{label}</p>
      <p className="text-2xl font-bold text-theme-text-primary">{value}</p>
    </div>
  </div>
);

export default EventAnalyticsPage;
