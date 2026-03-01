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

const PAGE_SIZE = 20;

const AdminHoursPage: React.FC = () => {
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
      toast.error(err instanceof Error ? err.message : 'Failed to submit hours');
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
      case 'approved': return 'bg-green-500/20 text-green-400';
      case 'pending': return 'bg-yellow-500/20 text-yellow-400';
      case 'rejected': return 'bg-red-500/20 text-red-400';
      case 'active': return 'bg-blue-500/20 text-blue-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  // Duration preview for manual entry form
  const manualDurationMinutes = useMemo(() => {
    if (!manualData.clock_in_at || !manualData.clock_out_at) return null;
    const start = new Date(manualData.clock_in_at).getTime();
    const end = new Date(manualData.clock_out_at).getTime();
    if (isNaN(start) || isNaN(end) || end <= start) return null;
    return Math.floor((end - start) / 60000);
  }, [manualData.clock_in_at, manualData.clock_out_at]);

  const manualFormValid = useMemo(() => {
    if (!manualData.category_id || !manualData.clock_in_at || !manualData.clock_out_at) return false;
    const start = new Date(manualData.clock_in_at).getTime();
    const end = new Date(manualData.clock_out_at).getTime();
    return !isNaN(start) && !isNaN(end) && end > start;
  }, [manualData]);

  // Max datetime for future date prevention
  const maxDatetime = useMemo(() => {
    return new Date().toISOString().slice(0, 16);
  }, []);

  // Stale session warning
  const isSessionNearLimit = useMemo(() => {
    if (!activeSession?.maxSessionMinutes || localElapsed === null) return false;
    return localElapsed >= activeSession.maxSessionMinutes * 0.8;
  }, [activeSession, localElapsed]);

  const totalPages = Math.ceil(myEntriesTotal / PAGE_SIZE);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-theme-text-primary">My Admin Hours</h1>
        <p className="text-theme-text-secondary mt-1">Track and view your administrative hours</p>
      </div>

      {/* Active Session Card */}
      {!activeSessionLoading && activeSession && (
        <div className={`border rounded-xl p-6 mb-6 ${isSessionNearLimit ? 'bg-orange-500/10 border-orange-500/30' : 'bg-blue-500/10 border-blue-500/30'}`}>
          <div className="flex flex-col md:flex-row md:items-center gap-5">
            {/* Left: icon + info */}
            <div className="flex items-start gap-4 flex-1 min-w-0">
              <div className="relative flex-shrink-0">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center ${isSessionNearLimit ? 'bg-orange-500/20' : 'bg-blue-500/20'}`}>
                  <Timer className={`w-7 h-7 ${isSessionNearLimit ? 'text-orange-400' : 'text-blue-400'}`} />
                </div>
                <span className="absolute top-0 right-0 w-3.5 h-3.5 bg-green-500 rounded-full animate-pulse border-2 border-theme-surface-secondary" />
              </div>
              <div className="min-w-0">
                <p className={`text-lg font-bold ${isSessionNearLimit ? 'text-orange-300' : 'text-blue-300'}`}>
                  Currently Clocked In
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: activeSession.categoryColor ?? '#6B7280' }}
                  />
                  <span className="text-theme-text-primary font-medium truncate">{activeSession.categoryName}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm">
                  <span className={isSessionNearLimit ? 'text-orange-400' : 'text-blue-400'}>
                    <span className="font-medium">Elapsed:</span>{' '}
                    <span className="text-lg font-bold">{formatDuration(localElapsed ?? activeSession.elapsedMinutes)}</span>
                  </span>
                  <span className="text-theme-text-muted">
                    Started at {new Date(activeSession.clockInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {activeSession.maxSessionMinutes && (
                    <span className="text-theme-text-muted">
                      Limit: {formatDuration(activeSession.maxSessionMinutes)}
                    </span>
                  )}
                </div>
                {isSessionNearLimit && (
                  <p className="text-sm text-orange-300 flex items-center gap-1.5 mt-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    Approaching session limit &mdash; please clock out soon
                  </p>
                )}
              </div>
            </div>

            {/* Right: clock-out button */}
            <button
              onClick={() => { void handleClockOut(); }}
              disabled={clockingOut}
              className="flex items-center justify-center gap-2 w-full md:w-auto px-8 py-4 bg-red-600 text-white text-lg font-semibold rounded-xl hover:bg-red-700 transition focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:bg-gray-500 disabled:cursor-not-allowed"
            >
              <LogOut className="w-5 h-5" />
              {clockingOut ? 'Clocking Out...' : 'Clock Out'}
            </button>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-theme-surface rounded-lg shadow-md p-4">
            <p className="text-xs text-theme-text-muted uppercase">Approved Hours</p>
            <p className="text-2xl font-bold text-theme-text-primary">{summary.approvedHours}</p>
          </div>
          <div className="bg-theme-surface rounded-lg shadow-md p-4">
            <p className="text-xs text-theme-text-muted uppercase">Pending Hours</p>
            <p className="text-2xl font-bold text-yellow-400">{summary.pendingHours}</p>
          </div>
          <div className="bg-theme-surface rounded-lg shadow-md p-4">
            <p className="text-xs text-theme-text-muted uppercase">Total Hours</p>
            <p className="text-2xl font-bold text-theme-text-primary">{summary.totalHours}</p>
          </div>
          <div className="bg-theme-surface rounded-lg shadow-md p-4">
            <p className="text-xs text-theme-text-muted uppercase">Entries</p>
            <p className="text-2xl font-bold text-theme-text-primary">{summary.totalEntries}</p>
          </div>
          {summary.byCategory.map((cat) => (
            <div key={cat.category_id} className="bg-theme-surface rounded-lg shadow-md p-4">
              <p className="text-xs text-theme-text-muted uppercase truncate">{cat.category_name}</p>
              <p className="text-2xl font-bold text-theme-text-primary">{cat.total_hours}h</p>
              <p className="text-xs text-theme-text-muted">{cat.entry_count} entries</p>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={() => setShowManualForm(!showManualForm)}
          className="flex items-center gap-2 px-4 py-2 bg-theme-surface text-theme-text-primary rounded-lg border border-theme-surface-border hover:bg-theme-surface-hover transition"
        >
          <Plus className="w-4 h-4" />
          Log Hours Manually
        </button>
      </div>

      {/* Manual Entry Form */}
      {showManualForm && (
        <div className="bg-theme-surface rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold text-theme-text-primary mb-4">Log Hours Manually</h3>
          <form onSubmit={(e) => { void handleManualSubmit(e); }} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Category *</label>
                <select
                  value={manualData.category_id}
                  onChange={(e) => setManualData({ ...manualData, category_id: e.target.value })}
                  required
                  className="w-full px-3 py-2 bg-theme-surface-secondary border border-theme-surface-border rounded-lg text-theme-text-primary focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select category...</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}{cat.maxHoursPerSession ? ` (max ${cat.maxHoursPerSession}h)` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Start Time *</label>
                <input
                  type="datetime-local"
                  value={manualData.clock_in_at}
                  onChange={(e) => setManualData({ ...manualData, clock_in_at: e.target.value })}
                  max={maxDatetime}
                  required
                  className="w-full px-3 py-2 bg-theme-surface-secondary border border-theme-surface-border rounded-lg text-theme-text-primary focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">End Time *</label>
                <input
                  type="datetime-local"
                  value={manualData.clock_out_at}
                  onChange={(e) => setManualData({ ...manualData, clock_out_at: e.target.value })}
                  max={maxDatetime}
                  min={manualData.clock_in_at || undefined}
                  required
                  className="w-full px-3 py-2 bg-theme-surface-secondary border border-theme-surface-border rounded-lg text-theme-text-primary focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Duration preview */}
            {manualDurationMinutes !== null && (
              <div className="text-sm text-theme-text-secondary">
                Duration: <span className="font-medium text-theme-text-primary">{formatDuration(manualDurationMinutes)}</span>
                {manualData.clock_out_at && new Date(manualData.clock_out_at) <= new Date(manualData.clock_in_at) && (
                  <span className="ml-2 text-red-400">End time must be after start time</span>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">Description</label>
              <input
                type="text"
                value={manualData.description ?? ''}
                onChange={(e) => setManualData({ ...manualData, description: e.target.value })}
                className="w-full px-3 py-2 bg-theme-surface-secondary border border-theme-surface-border rounded-lg text-theme-text-primary focus:ring-2 focus:ring-blue-500"
                placeholder="What did you work on?"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={!manualFormValid || isSubmitting}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:bg-gray-500 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Submitting...' : 'Submit'}
              </button>
              <button type="button" onClick={() => setShowManualForm(false)} className="px-4 py-2 bg-theme-surface-secondary text-theme-text-secondary rounded-lg hover:bg-theme-surface-hover transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          className="px-3 py-1.5 bg-theme-surface border border-theme-surface-border rounded-lg text-sm text-theme-text-primary"
        >
          <option value="">All Statuses</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="rejected">Rejected</option>
          <option value="active">Active</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }}
          className="px-3 py-1.5 bg-theme-surface border border-theme-surface-border rounded-lg text-sm text-theme-text-primary"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
        {myEntriesTotal > 0 && (
          <span className="text-xs text-theme-text-muted ml-auto">
            Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, myEntriesTotal)} of {myEntriesTotal}
          </span>
        )}
      </div>

      {/* Entries List */}
      <div className="bg-theme-surface rounded-lg shadow-md">
        <div className="px-4 py-3 border-b border-theme-surface-border">
          <h2 className="font-semibold text-theme-text-primary">My Hours</h2>
        </div>
        {entriesLoading ? (
          <div className="text-center py-8 text-theme-text-secondary">Loading...</div>
        ) : myEntries.length === 0 ? (
          <div className="text-center py-12">
            <Clock className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
            <p className="text-theme-text-secondary">No hours logged yet</p>
            <p className="text-sm text-theme-text-muted mt-1">Scan a QR code or log hours manually to get started</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-theme-surface-border">
              {myEntries.map((entry) => (
                <div key={entry.id} className={`px-4 py-3 flex items-center gap-3 ${entry.status === 'rejected' ? 'bg-red-500/5' : ''}`}>
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: entry.categoryColor ?? '#6B7280' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-theme-text-primary">{entry.categoryName}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(entry.status)}`}>
                        {entry.status}
                      </span>
                    </div>
                    <div className="text-sm text-theme-text-muted">
                      {new Date(entry.clockInAt).toLocaleDateString()} | {formatDuration(entry.durationMinutes)} | {entry.entryMethod.replace('_', ' ')}
                    </div>
                    {entry.description && (
                      <p className="text-sm text-theme-text-muted truncate">{entry.description}</p>
                    )}
                    {entry.rejectionReason && (
                      <p className="text-sm text-red-400 mt-0.5">Rejected: {entry.rejectionReason}</p>
                    )}
                    {entry.approverName && entry.status !== 'active' && entry.status !== 'pending' && (
                      <p className="text-xs text-theme-text-muted mt-0.5">
                        {entry.status === 'approved' ? 'Approved' : 'Reviewed'} by {entry.approverName}
                        {entry.approvedAt && ` on ${new Date(entry.approvedAt).toLocaleDateString()}`}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 px-4 py-3 border-t border-theme-surface-border">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="flex items-center gap-1 px-3 py-1 text-sm text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" /> Previous
                </button>
                <span className="text-sm text-theme-text-muted">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="flex items-center gap-1 px-3 py-1 text-sm text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next <ChevronRight className="w-4 h-4" />
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
