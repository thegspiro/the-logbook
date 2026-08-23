/**
 * Admin Hours Page
 *
 * Personal view for members to see their logged admin hours, their progress
 * against the department's requirements, their active session, and to submit
 * hours manually.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ListChecks,
  LogOut,
  Plus,
  Target,
  Timer,
} from 'lucide-react';
import { useAdminHoursStore } from '../store/adminHoursStore';
import type { AdminHoursComplianceItem, AdminHoursEntryCreate } from '../types';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import { addCalendarDays, formatDate, formatTime, getTodayLocalDate, localToUTC } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { useAuthStore } from '../../../stores/authStore';
import DateTimeQuarterHour from '../../../components/ux/DateTimeQuarterHour';
import { NfcTapButton } from '../../../components/nfc/NfcTapButton';
import { formatDuration } from '../utils/formatDuration';
import { endOfReportingDayUTC, startOfReportingDayUTC } from '../utils/reportingRange';

const PAGE_SIZE = 20;

// `phrase` reads as a trailing clause ("No hours logged <phrase>"), which is
// the only form that stays grammatical across a named window and all time.
const PERIOD_OPTIONS = [
  { value: 'all', label: 'All time', phrase: 'yet' },
  { value: 'month', label: 'This month', phrase: 'this month' },
  { value: '30-days', label: 'Last 30 days', phrase: 'in the last 30 days' },
  { value: 'year', label: 'This year', phrase: 'this year' },
] as const;

type ReportingPeriod = (typeof PERIOD_OPTIONS)[number]['value'];

/**
 * Reporting periods are derived from the department's calendar date rather
 * than the browser's: a member in a station west of the browser's timezone
 * would otherwise see "this month" start a day early on the first of a month.
 */
const reportingDaysFor = (period: ReportingPeriod, timezone: string): { start: string; end: string } | null => {
  if (period === 'all') return null;
  const today = getTodayLocalDate(timezone);
  if (period === 'year') return { start: `${today.slice(0, 4)}-01-01`, end: today };
  if (period === 'month') return { start: `${today.slice(0, 7)}-01`, end: today };
  return { start: addCalendarDays(today, -29), end: today };
};

const pluralEntries = (count: number): string => `${count} ${count === 1 ? 'entry' : 'entries'}`;

const complianceStatusStyle = (status: string): { label: string; badge: string; bar: string } => {
  switch (status) {
    case 'compliant':
      return {
        label: 'On track',
        badge: 'bg-green-500/20 text-green-700 dark:text-green-400',
        bar: 'bg-green-500',
      };
    case 'at_risk':
      return {
        label: 'At risk',
        badge: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
        bar: 'bg-amber-500',
      };
    default:
      return {
        label: 'Behind',
        badge: 'bg-red-500/20 text-red-700 dark:text-red-400',
        bar: 'bg-red-500',
      };
  }
};

const AdminHoursPage: React.FC = () => {
  const tz = useTimezone();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const {
    categories,
    myEntries,
    myEntriesTotal,
    entriesLoading,
    activeSession,
    activeSessionLoading,
    mySummary,
    mySummaryLoading,
    error,
    fetchCategories,
    fetchMyEntries,
    fetchActiveSession,
    clockOut,
    fetchMySummary,
    clearError,
  } = useAdminHoursStore();

  const [showManualForm, setShowManualForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clockingOut, setClockingOut] = useState(false);
  const [manualData, setManualData] = useState<AdminHoursEntryCreate>({
    category_id: '',
    clock_in_at: '',
    clock_out_at: '',
    description: '',
  });

  // Filters
  const [period, setPeriod] = useState<ReportingPeriod>('all');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [page, setPage] = useState(0);

  const [compliance, setCompliance] = useState<AdminHoursComplianceItem[]>([]);

  // The period drives both the totals and the entry list, so they are always
  // describing the same window — a summary that disagreed with the list under
  // it is the reading people trust least.
  const dateBounds = useMemo(() => {
    const days = reportingDaysFor(period, tz);
    if (!days) return {};
    return {
      startDate: startOfReportingDayUTC(days.start, tz),
      endDate: endOfReportingDayUTC(days.end, tz),
    };
  }, [period, tz]);

  const periodOption = useMemo(
    () => PERIOD_OPTIONS.find((option) => option.value === period) ?? PERIOD_OPTIONS[0],
    [period]
  );

  const entryQuery = useMemo(
    () => ({
      status: statusFilter || undefined,
      categoryId: categoryFilter || undefined,
      ...dateBounds,
      skip: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    }),
    [statusFilter, categoryFilter, dateBounds, page]
  );

  const loadData = useCallback(() => {
    void fetchCategories();
    void fetchMyEntries(entryQuery);
    void fetchActiveSession();
    // The summary endpoint returns organization-wide totals when no user is
    // named, so a member holding admin_hours.manage saw the whole department's
    // hours under "My Admin Hours". Always scope this page to the signed-in
    // member.
    if (currentUserId) {
      void fetchMySummary({ userId: currentUserId, ...dateBounds });
    }
  }, [fetchCategories, fetchMyEntries, fetchActiveSession, fetchMySummary, entryQuery, dateBounds, currentUserId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;
    void (async () => {
      const { adminHoursComplianceService } = await import('../services/api');
      try {
        const items = await adminHoursComplianceService.getUserCompliance(currentUserId);
        if (!cancelled) setCompliance(items);
      } catch {
        // Requirements are supplementary context; a department that has not
        // configured a compliance profile is the common case, and the rest of
        // the page must still render.
        if (!cancelled) setCompliance([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  // Refresh active session timer using local state
  const [localElapsed, setLocalElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!activeSession) {
      setLocalElapsed(null);
      return;
    }
    setLocalElapsed(activeSession.elapsedMinutes);
    const interval = setInterval(() => {
      setLocalElapsed((prev) => (prev !== null ? prev + 1 : null));
    }, 60000);
    return () => clearInterval(interval);
  }, [activeSession]);

  useEffect(() => {
    if (error) {
      toast.error(error);
      clearError();
    }
  }, [error, clearError]);

  const handleClockOut = async () => {
    if (!activeSession || clockingOut) return;
    setClockingOut(true);
    try {
      await clockOut(activeSession.id);
      toast.success('Clocked out successfully');
    } catch {
      // error handled by store
    } finally {
      setClockingOut(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    const { adminHoursEntryService } = await import('../services/api');
    try {
      // DateTimeQuarterHour emits local wall-clock strings; the API stores UTC
      // instants, so convert exactly once here on submit. Sending the bare
      // string would record the hours shifted by the org's UTC offset.
      await adminHoursEntryService.createManual({
        ...manualData,
        clock_in_at: localToUTC(manualData.clock_in_at, tz),
        clock_out_at: localToUTC(manualData.clock_out_at, tz),
        description: manualData.description?.trim() || undefined,
      });
      toast.success('Hours submitted');
      setShowManualForm(false);
      setManualData({ category_id: '', clock_in_at: '', clock_out_at: '', description: '' });
      void fetchMyEntries(entryQuery);
      if (currentUserId) {
        void fetchMySummary({ userId: currentUserId, ...dateBounds });
      }
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to submit hours'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-green-500/20 text-green-700 dark:text-green-400';
      case 'pending':
        return 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400';
      case 'rejected':
        return 'bg-red-500/20 text-red-700 dark:text-red-400';
      case 'active':
        return 'bg-blue-500/20 text-blue-700 dark:text-blue-400';
      default:
        return 'bg-theme-surface-hover text-theme-text-muted';
    }
  };

  // Duration preview for manual entry form
  const manualDurationMinutes = useMemo(() => {
    if (!manualData.clock_in_at || !manualData.clock_out_at) return null;
    const start = new Date(localToUTC(manualData.clock_in_at, tz)).getTime();
    const end = new Date(localToUTC(manualData.clock_out_at, tz)).getTime();
    if (isNaN(start) || isNaN(end) || end <= start) return null;
    return Math.floor((end - start) / 60000);
  }, [manualData.clock_in_at, manualData.clock_out_at, tz]);

  const manualFormValid = useMemo(() => {
    if (!manualData.category_id || !manualData.clock_in_at || !manualData.clock_out_at) return false;
    const start = new Date(localToUTC(manualData.clock_in_at, tz)).getTime();
    const end = new Date(localToUTC(manualData.clock_out_at, tz)).getTime();
    return !isNaN(start) && !isNaN(end) && end > start;
  }, [manualData, tz]);

  // Stale session warning
  const isSessionNearLimit = useMemo(() => {
    if (!activeSession?.maxSessionMinutes || localElapsed === null) return false;
    return localElapsed >= activeSession.maxSessionMinutes * 0.8;
  }, [activeSession, localElapsed]);

  const loggedCategories = useMemo(
    () => [...(mySummary?.byCategory ?? [])].sort((a, b) => b.totalMinutes - a.totalMinutes),
    [mySummary]
  );

  const loggedMinutesTotal = useMemo(
    () => loggedCategories.reduce((total, category) => total + category.totalMinutes, 0),
    [loggedCategories]
  );

  // Named rather than tiled: an empty category is worth one muted line telling
  // a member where they have logged nothing, not a stat box reading zero.
  const untouchedCategoryNames = useMemo(() => {
    const logged = new Set(loggedCategories.map((category) => category.categoryId));
    return categories.filter((category) => !logged.has(category.id)).map((category) => category.name);
  }, [categories, loggedCategories]);

  const hasAnyHours = (mySummary?.totalEntries ?? 0) > 0;
  const totalPages = Math.ceil(myEntriesTotal / PAGE_SIZE);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-theme-text-primary text-3xl font-bold">My Admin Hours</h1>
          <p className="text-theme-text-secondary mt-1">Track and view your administrative hours</p>
        </div>
        <NfcTapButton />
      </div>

      {/* Active Session Card */}
      {!activeSessionLoading && activeSession && (
        <div
          className={`mb-6 rounded-xl border p-6 ${isSessionNearLimit ? 'border-orange-500/30 bg-orange-500/10' : 'border-blue-500/30 bg-blue-500/10'}`}
        >
          <div className="flex flex-col gap-5 md:flex-row md:items-center">
            {/* Left: icon + info */}
            <div className="flex min-w-0 flex-1 items-start gap-4">
              <div className="relative shrink-0">
                <div
                  className={`flex h-14 w-14 items-center justify-center rounded-full ${isSessionNearLimit ? 'bg-orange-500/20' : 'bg-blue-500/20'}`}
                >
                  <Timer
                    className={`h-7 w-7 ${isSessionNearLimit ? 'text-orange-700 dark:text-orange-400' : 'text-blue-700 dark:text-blue-400'}`}
                  />
                </div>
                <span className="border-theme-surface-secondary absolute top-0 right-0 h-3.5 w-3.5 animate-pulse rounded-full border-2 bg-green-500" />
              </div>
              <div className="min-w-0">
                <p
                  className={`text-lg font-bold ${isSessionNearLimit ? 'text-orange-700 dark:text-orange-300' : 'text-blue-700 dark:text-blue-300'}`}
                >
                  Currently Clocked In
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <div
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: activeSession.categoryColor ?? '#6B7280' }}
                  />
                  <span className="text-theme-text-primary truncate font-medium">{activeSession.categoryName}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span
                    className={
                      isSessionNearLimit ? 'text-orange-700 dark:text-orange-400' : 'text-blue-700 dark:text-blue-400'
                    }
                  >
                    <span className="font-medium">Elapsed:</span>{' '}
                    <span className="text-lg font-bold">
                      {formatDuration(localElapsed ?? activeSession.elapsedMinutes)}
                    </span>
                  </span>
                  <span className="text-theme-text-muted">Started at {formatTime(activeSession.clockInAt, tz)}</span>
                  {activeSession.maxSessionMinutes && (
                    <span className="text-theme-text-muted">
                      Limit: {formatDuration(activeSession.maxSessionMinutes)}
                    </span>
                  )}
                </div>
                {isSessionNearLimit && (
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-orange-700 dark:text-orange-300">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Approaching session limit &mdash; please clock out soon
                  </p>
                )}
              </div>
            </div>

            {/* Right: clock-out button */}
            <button
              onClick={() => {
                void handleClockOut();
              }}
              disabled={clockingOut}
              className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl px-8 py-4 text-lg font-semibold transition focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
            >
              <LogOut className="h-5 w-5" />
              {clockingOut ? 'Clocking Out...' : 'Clock Out'}
            </button>
          </div>
        </div>
      )}

      {/* Requirements progress — only departments that configured admin hours
          requirements for this member's profile get this section. */}
      {compliance.length > 0 && (
        <section className="card mb-6 p-5">
          <div className="flex items-start gap-2">
            <Target className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            <div>
              <h2 className="text-theme-text-primary font-semibold">My requirements</h2>
              <p className="text-theme-text-secondary mt-0.5 text-sm">
                Approved hours counted against the requirements set for you. Hours awaiting review do not count yet.
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-5">
            {compliance.map((item) => {
              const style = complianceStatusStyle(item.status);
              const exactProgress =
                item.requiredHours > 0 ? Math.min(100, (item.loggedHours / item.requiredHours) * 100) : 100;
              const progress = Math.round(exactProgress);
              const remaining = Math.max(0, Math.round((item.requiredHours - item.loggedHours) * 100) / 100);
              return (
                <div key={`${item.categoryId}-${item.frequency}`}>
                  <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-theme-text-primary flex items-center gap-2 text-sm font-medium">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: item.categoryColor ?? '#6B7280' }}
                      />
                      {item.categoryName}
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style.badge}`}>
                        {style.label}
                      </span>
                    </span>
                    <span className="text-theme-text-primary text-sm font-semibold">
                      {item.loggedHours} / {item.requiredHours} hrs{' '}
                      <span className="text-theme-text-muted font-normal">
                        · {item.frequency === 'quarterly' ? 'this quarter' : 'this year'}
                      </span>
                    </span>
                  </div>
                  <div
                    className="bg-theme-surface-hover h-2 overflow-hidden rounded-full"
                    role="progressbar"
                    aria-label={`${item.categoryName}: ${progress}% of required hours`}
                    aria-valuenow={progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${exactProgress}%` }} />
                  </div>
                  <p className="text-theme-text-muted mt-1 text-xs">
                    {remaining > 0 ? `${remaining} hrs still needed` : 'Requirement met'} · period ends{' '}
                    {formatDate(item.periodEnd, tz)}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Reporting period */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-theme-text-secondary flex items-center gap-2 text-sm font-medium">
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          <span>Showing</span>
          <select
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value as ReportingPeriod);
              setPage(0);
            }}
            className="form-input min-w-40 px-3 py-1.5 text-sm max-md:min-h-[44px]"
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Summary */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <article className="card p-4">
          <div className="flex items-center justify-between">
            <p className="text-theme-text-secondary text-sm font-medium">Approved</p>
            <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden="true" />
          </div>
          <p className="mt-2 text-3xl font-bold text-green-700 dark:text-green-400">
            {mySummary?.approvedHours ?? 0}
            <span className="ml-1 text-base font-medium">hrs</span>
          </p>
          <p className="text-theme-text-muted mt-1 text-xs">
            {pluralEntries(mySummary?.approvedEntries ?? 0)} credited
          </p>
        </article>
        <article className="card p-4">
          <div className="flex items-center justify-between">
            <p className="text-theme-text-secondary text-sm font-medium">Awaiting review</p>
            <ListChecks className="h-5 w-5 text-amber-600" aria-hidden="true" />
          </div>
          <p className="mt-2 text-3xl font-bold text-amber-700 dark:text-amber-400">
            {mySummary?.pendingHours ?? 0}
            <span className="ml-1 text-base font-medium">hrs</span>
          </p>
          <p className="text-theme-text-muted mt-1 text-xs">
            {(mySummary?.pendingEntries ?? 0) === 0
              ? 'Nothing waiting on an approver'
              : `${pluralEntries(mySummary?.pendingEntries ?? 0)} with an approver`}
          </p>
        </article>
        <article className="card p-4">
          <div className="flex items-center justify-between">
            <p className="text-theme-text-secondary text-sm font-medium">
              Logged &mdash; {periodOption.label.toLowerCase()}
            </p>
            <Clock className="h-5 w-5 text-blue-500" aria-hidden="true" />
          </div>
          <p className="text-theme-text-primary mt-2 text-3xl font-bold">
            {mySummary?.totalHours ?? 0}
            <span className="ml-1 text-base font-medium">hrs</span>
          </p>
          <p className="text-theme-text-muted mt-1 text-xs">
            {pluralEntries(mySummary?.totalEntries ?? 0)}, approved and pending
          </p>
        </article>
      </div>

      {/* Category breakdown */}
      {hasAnyHours && (
        <section className="card mb-6 p-5">
          <h2 className="text-theme-text-primary font-semibold">Where my hours went</h2>
          <p className="text-theme-text-secondary mt-0.5 text-sm">
            Approved and pending hours combined, ranked by category.
          </p>
          <div className="mt-5 space-y-4">
            {loggedCategories.map((category) => {
              // Shares divide exact minutes, not the independently rounded
              // totalHours: with small totals the rounded basis is materially
              // wrong (two 1-minute categories each showed as 67%).
              const exactShare = loggedMinutesTotal > 0 ? (category.totalMinutes / loggedMinutesTotal) * 100 : 0;
              const share = Math.round(exactShare);
              return (
                <div key={category.categoryId}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-4">
                    <span className="text-theme-text-primary flex items-center gap-2 text-sm font-medium">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: category.categoryColor ?? '#6B7280' }}
                      />
                      {category.categoryName}
                    </span>
                    <span className="text-theme-text-primary text-sm font-semibold">
                      {category.totalHours} hrs{' '}
                      <span className="text-theme-text-muted font-normal">
                        · {category.entryCount} entries · {share}%
                      </span>
                    </span>
                  </div>
                  <div
                    className="bg-theme-surface-hover h-2 overflow-hidden rounded-full"
                    role="progressbar"
                    aria-label={`${category.categoryName}: ${share}% of my logged hours`}
                    aria-valuenow={share}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${exactShare}%`, backgroundColor: category.categoryColor ?? '#6B7280' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {untouchedCategoryNames.length > 0 && (
            <p className="text-theme-text-muted mt-5 text-xs">
              No hours {periodOption.phrase} for: {untouchedCategoryNames.join(', ')}
            </p>
          )}
        </section>
      )}

      {!hasAnyHours && !mySummaryLoading && (
        <div className="card mb-6 px-4 py-10 text-center">
          <Clock className="text-theme-text-muted mx-auto mb-3 h-10 w-10" aria-hidden="true" />
          <p className="text-theme-text-secondary">No hours logged {periodOption.phrase}</p>
          <p className="text-theme-text-muted mt-1 text-sm">
            Scan a category QR code to clock in, or log hours manually below.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="mb-6 flex gap-3">
        <button
          onClick={() => setShowManualForm(!showManualForm)}
          className="btn-secondary flex items-center gap-2 transition max-md:min-h-[44px]"
        >
          <Plus className="h-4 w-4" />
          Log Hours Manually
        </button>
      </div>

      {/* Manual Entry Form */}
      {showManualForm && (
        <div className="bg-theme-surface mb-6 rounded-lg p-6 shadow-md">
          <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">Log Hours Manually</h3>
          <form
            onSubmit={(e) => {
              void handleManualSubmit(e);
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Category *</label>
                <select
                  value={manualData.category_id}
                  onChange={(e) => setManualData({ ...manualData, category_id: e.target.value })}
                  required
                  className="form-input md:max-w-sm"
                >
                  <option value="">Select category...</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                      {cat.maxHoursPerSession ? ` (max ${cat.maxHoursPerSession}h)` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Start Time *</label>
                <DateTimeQuarterHour
                  value={manualData.clock_in_at}
                  onChange={(val) => setManualData({ ...manualData, clock_in_at: val })}
                  required
                  className="form-input"
                />
              </div>
              <div>
                <label className="text-theme-text-secondary mb-1 block text-sm font-medium">End Time *</label>
                <DateTimeQuarterHour
                  value={manualData.clock_out_at}
                  onChange={(val) => setManualData({ ...manualData, clock_out_at: val })}
                  required
                  className="form-input"
                />
              </div>
            </div>

            {/* Duration preview */}
            {manualDurationMinutes !== null && (
              <div className="text-theme-text-secondary text-sm">
                Duration:{' '}
                <span className="text-theme-text-primary font-medium">{formatDuration(manualDurationMinutes)}</span>
                {manualData.clock_out_at && manualData.clock_out_at <= manualData.clock_in_at && (
                  <span className="ml-2 text-red-700 dark:text-red-400">End time must be after start time</span>
                )}
              </div>
            )}

            <div>
              <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Description</label>
              <input
                type="text"
                value={manualData.description ?? ''}
                onChange={(e) => setManualData({ ...manualData, description: e.target.value })}
                className="form-input"
                placeholder="What did you work on?"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={!manualFormValid || isSubmitting}
                className="btn-info transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? 'Submitting...' : 'Submit'}
              </button>
              <button
                type="button"
                onClick={() => setShowManualForm(false)}
                className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg px-4 py-2 transition"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
          }}
          className="form-input px-3 py-1.5 text-sm max-md:min-h-[44px]"
        >
          <option value="">All Statuses</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="rejected">Rejected</option>
          <option value="active">Active</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(0);
          }}
          className="form-input px-3 py-1.5 text-sm max-md:min-h-[44px]"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
        {myEntriesTotal > 0 && (
          <span className="text-theme-text-muted ml-auto text-xs">
            Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, myEntriesTotal)} of {myEntriesTotal}
          </span>
        )}
      </div>

      {/* Entries List */}
      <div className="bg-theme-surface rounded-lg shadow-md">
        <div className="border-theme-surface-border flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-theme-text-primary font-semibold">My Hours</h2>
          <span className="text-theme-text-muted text-xs">{periodOption.label}</span>
        </div>
        {entriesLoading ? (
          <div className="text-theme-text-secondary py-8 text-center">Loading...</div>
        ) : myEntries.length === 0 ? (
          <div className="py-12 text-center">
            <Clock className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
            <p className="text-theme-text-secondary">No hours match these filters</p>
            <p className="text-theme-text-muted mt-1 text-sm">
              Try a wider reporting period, or clear the status and category filters.
            </p>
          </div>
        ) : (
          <>
            <div className="divide-theme-surface-border divide-y">
              {myEntries.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex items-center gap-3 px-4 py-3 ${entry.status === 'rejected' ? 'bg-red-500/5' : ''}`}
                >
                  <div
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: entry.categoryColor ?? '#6B7280' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-theme-text-primary font-medium">{entry.categoryName}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(entry.status)}`}>
                        {entry.status}
                      </span>
                    </div>
                    <div className="text-theme-text-muted text-sm">
                      {formatDate(entry.clockInAt, tz)} | {formatDuration(entry.durationMinutes)} |{' '}
                      {entry.entryMethod.replace('_', ' ')}
                    </div>
                    {entry.description && <p className="text-theme-text-muted truncate text-sm">{entry.description}</p>}
                    {entry.rejectionReason && (
                      <p className="mt-0.5 text-sm text-red-700 dark:text-red-400">Rejected: {entry.rejectionReason}</p>
                    )}
                    {entry.approverName && entry.status !== 'active' && entry.status !== 'pending' && (
                      <p className="text-theme-text-muted mt-0.5 text-xs">
                        {entry.status === 'approved' ? 'Approved' : 'Reviewed'} by {entry.approverName}
                        {entry.approvedAt && ` on ${formatDate(entry.approvedAt, tz)}`}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="border-theme-surface-border flex items-center justify-center gap-4 border-t px-4 py-3">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="text-theme-text-secondary hover:text-theme-text-primary flex items-center gap-1 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </button>
                <span className="text-theme-text-muted text-sm">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="text-theme-text-secondary hover:text-theme-text-primary flex items-center gap-1 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AdminHoursPage;
