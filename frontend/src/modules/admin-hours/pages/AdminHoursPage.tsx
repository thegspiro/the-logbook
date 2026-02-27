/**
 * Admin Hours Page
 *
 * Personal view for members to see their logged admin hours,
 * active session, and manually submit hours.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Clock, Plus, Timer } from 'lucide-react';
import { useAdminHoursStore } from '../store/adminHoursStore';
import type { AdminHoursEntryCreate } from '../types';
import toast from 'react-hot-toast';

const AdminHoursPage: React.FC = () => {
  const {
    categories,
    myEntries,
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
  const [manualData, setManualData] = useState<AdminHoursEntryCreate>({
    category_id: '',
    clock_in_at: '',
    clock_out_at: '',
    description: '',
  });

  const loadData = useCallback(() => {
    void fetchCategories();
    void fetchMyEntries();
    void fetchActiveSession();
    void fetchSummary();
  }, [fetchCategories, fetchMyEntries, fetchActiveSession, fetchSummary]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Refresh active session timer
  useEffect(() => {
    if (!activeSession) return;
    const interval = setInterval(() => {
      void fetchActiveSession();
    }, 60000);
    return () => clearInterval(interval);
  }, [activeSession, fetchActiveSession]);

  useEffect(() => {
    if (error) {
      toast.error(error);
      clearError();
    }
  }, [error, clearError]);

  const handleClockOut = async () => {
    if (!activeSession) return;
    try {
      await clockOut(activeSession.id);
      toast.success('Clocked out successfully');
    } catch {
      // error handled by store
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { adminHoursEntryService } = await import('../services/api');
    try {
      await adminHoursEntryService.createManual(manualData);
      toast.success('Hours submitted');
      setShowManualForm(false);
      setManualData({ category_id: '', clock_in_at: '', clock_out_at: '', description: '' });
      void fetchMyEntries();
      void fetchSummary();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit hours');
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

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-theme-text-primary">My Admin Hours</h1>
        <p className="text-theme-text-secondary mt-1">Track and view your administrative hours</p>
      </div>

      {/* Active Session Banner */}
      {!activeSessionLoading && activeSession && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Timer className="w-6 h-6 text-blue-400" />
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-pulse" />
              </div>
              <div>
                <p className="font-semibold text-blue-300">Currently clocked in</p>
                <p className="text-sm text-blue-400">
                  {activeSession.categoryName} - {formatDuration(activeSession.elapsedMinutes)} elapsed
                </p>
              </div>
            </div>
            <button
              onClick={() => { void handleClockOut(); }}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-medium"
            >
              Clock Out
            </button>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-theme-surface rounded-lg shadow-md p-4">
            <p className="text-xs text-theme-text-muted uppercase">Total Hours</p>
            <p className="text-2xl font-bold text-theme-text-primary">{summary.totalHours}</p>
          </div>
          <div className="bg-theme-surface rounded-lg shadow-md p-4">
            <p className="text-xs text-theme-text-muted uppercase">Entries</p>
            <p className="text-2xl font-bold text-theme-text-primary">{summary.totalEntries}</p>
          </div>
          {summary.byCategory.slice(0, 2).map((cat) => (
            <div key={cat.category_id} className="bg-theme-surface rounded-lg shadow-md p-4">
              <p className="text-xs text-theme-text-muted uppercase truncate">{cat.category_name}</p>
              <p className="text-2xl font-bold text-theme-text-primary">{cat.total_hours}h</p>
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
          <form onSubmit={handleManualSubmit} className="space-y-4">
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
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Start Time *</label>
                <input
                  type="datetime-local"
                  value={manualData.clock_in_at}
                  onChange={(e) => setManualData({ ...manualData, clock_in_at: e.target.value })}
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
                  required
                  className="w-full px-3 py-2 bg-theme-surface-secondary border border-theme-surface-border rounded-lg text-theme-text-primary focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
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
              <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                Submit
              </button>
              <button type="button" onClick={() => setShowManualForm(false)} className="px-4 py-2 bg-theme-surface-secondary text-theme-text-secondary rounded-lg hover:bg-theme-surface-hover transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Entries List */}
      <div className="bg-theme-surface rounded-lg shadow-md">
        <div className="px-4 py-3 border-b border-theme-surface-border">
          <h2 className="font-semibold text-theme-text-primary">Recent Hours</h2>
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
          <div className="divide-y divide-theme-surface-border">
            {myEntries.map((entry) => (
              <div key={entry.id} className="px-4 py-3 flex items-center gap-3">
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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminHoursPage;
