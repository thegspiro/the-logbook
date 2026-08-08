/**
 * Admin Hours Page
 *
 * Personal view for members to see their logged admin hours,
 * active session, and manually submit hours.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, LogOut, Plus, Timer } from 'lucide-react';
import { useAdminHoursStore } from '../store/adminHoursStore';
import type { AdminHoursEntryCreate } from '../types';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatDate, formatTime, localToUTC } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import DateTimeQuarterHour from '../../../components/ux/DateTimeQuarterHour';

const PAGE_SIZE = 20;

const AdminHoursPage: React.FC = () => {
  const tz = useTimezone();
  const {
    categories,
    myEntries,
    myEntriesTotal,
    entriesLoading,
    activeSession,
    activeSessionLoading,
    summary,
    error,
    fetchCategories,
    fetchMyEntries,
    fetchActiveSession,
    clockOut,
    fetchSummary,
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
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [page, setPage] = useState(0);

  const loadData = useCallback(() => {
    void fetchCategories();
    void fetchMyEntries({
      status: statusFilter || undefined,
      categoryId: categoryFilter || undefined,
      skip: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    });
    void fetchActiveSession();
    void fetchSummary();
  }, [fetchCategories, fetchMyEntries, fetchActiveSession, fetchSummary, statusFilter, categoryFilter, page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
      await adminHoursEntryService.createManual(manualData);
      toast.success('Hours submitted');
      setShowManualForm(false);
      setManualData({ category_id: '', clock_in_at: '', clock_out_at: '', description: '' });
      void fetchMyEntries({
        status: statusFilter || undefined,
        categoryId: categoryFilter || undefined,
        skip: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      });
      void fetchSummary();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to submit hours'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDuration = (minutes: number | null) => {
    if (minutes === null || minutes === undefined) return '-';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
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

  const totalPages = Math.ceil(myEntriesTotal / PAGE_SIZE);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-theme-text-primary text-3xl font-bold">My Admin Hours</h1>
        <p className="text-theme-text-secondary mt-1">Track and view your administrative hours</p>
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

      {/* Summary Cards */}
      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="bg-theme-surface rounded-lg p-4 shadow-md">
            <p className="text-theme-text-muted text-xs uppercase">Approved Hours</p>
            <p className="text-theme-text-primary text-2xl font-bold">{summary.approvedHours}</p>
          </div>
          <div className="bg-theme-surface rounded-lg p-4 shadow-md">
            <p className="text-theme-text-muted text-xs uppercase">Pending Hours</p>
            <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">{summary.pendingHours}</p>
          </div>
          <div className="bg-theme-surface rounded-lg p-4 shadow-md">
            <p className="text-theme-text-muted text-xs uppercase">Total Hours</p>
            <p className="text-theme-text-primary text-2xl font-bold">{summary.totalHours}</p>
          </div>
          <div className="bg-theme-surface rounded-lg p-4 shadow-md">
            <p className="text-theme-text-muted text-xs uppercase">Entries</p>
            <p className="text-theme-text-primary text-2xl font-bold">{summary.totalEntries}</p>
          </div>
          {summary.byCategory.map((cat) => (
            <div key={cat.categoryId} className="bg-theme-surface rounded-lg p-4 shadow-md">
              <p className="text-theme-text-muted truncate text-xs uppercase">{cat.categoryName}</p>
              <p className="text-theme-text-primary text-2xl font-bold">{cat.totalHours}h</p>
              <p className="text-theme-text-muted text-xs">{cat.entryCount} entries</p>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="mb-6 flex gap-3">
        <button
          onClick={() => setShowManualForm(!showManualForm)}
          className="bg-theme-surface text-theme-text-primary border-theme-surface-border hover:bg-theme-surface-hover flex items-center gap-2 rounded-lg border px-4 py-2 transition max-md:min-h-[44px]"
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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Category *</label>
                <select
                  value={manualData.category_id}
                  onChange={(e) => setManualData({ ...manualData, category_id: e.target.value })}
                  required
                  className="card-secondary focus:ring-theme-focus-ring text-theme-text-primary w-full px-3 py-2 focus:ring-2"
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
                  className="card-secondary focus:ring-theme-focus-ring text-theme-text-primary w-full px-3 py-2 focus:ring-2"
                />
              </div>
              <div>
                <label className="text-theme-text-secondary mb-1 block text-sm font-medium">End Time *</label>
                <DateTimeQuarterHour
                  value={manualData.clock_out_at}
                  onChange={(val) => setManualData({ ...manualData, clock_out_at: val })}
                  required
                  className="card-secondary focus:ring-theme-focus-ring text-theme-text-primary w-full px-3 py-2 focus:ring-2"
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
                className="card-secondary focus:ring-theme-focus-ring text-theme-text-primary w-full px-3 py-2 focus:ring-2"
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
          className="bg-theme-surface border-theme-surface-border text-theme-text-primary rounded-lg border px-3 py-1.5 text-sm max-md:min-h-[44px]"
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
          className="bg-theme-surface border-theme-surface-border text-theme-text-primary rounded-lg border px-3 py-1.5 text-sm max-md:min-h-[44px]"
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
        <div className="border-theme-surface-border border-b px-4 py-3">
          <h2 className="text-theme-text-primary font-semibold">My Hours</h2>
        </div>
        {entriesLoading ? (
          <div className="text-theme-text-secondary py-8 text-center">Loading...</div>
        ) : myEntries.length === 0 ? (
          <div className="py-12 text-center">
            <Clock className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
            <p className="text-theme-text-secondary">No hours logged yet</p>
            <p className="text-theme-text-muted mt-1 text-sm">Scan a QR code or log hours manually to get started</p>
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
