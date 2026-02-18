/**
 * Shift Attendance Page
 *
 * Displays and manages attendance records for a specific shift.
 * Can be used standalone via URL (/:shiftId) or embedded as a component.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Users,
  Pencil,
  Trash2,
  RefreshCw,
  Clock,
  X,
} from 'lucide-react';
import { schedulingService } from '../services/api';
import type { ShiftAttendanceRecord } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';

interface ShiftAttendancePageProps {
  /** If provided as a prop, uses this shift ID instead of URL param */
  shiftId?: string;
}

interface EditModalState {
  open: boolean;
  record: ShiftAttendanceRecord | null;
}

const STATUS_LABELS: Record<string, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  excused: 'Excused',
};

export const ShiftAttendancePage: React.FC<ShiftAttendancePageProps> = ({ shiftId: propShiftId }) => {
  const { shiftId: paramShiftId } = useParams<{ shiftId: string }>();
  const shiftId = propShiftId || paramShiftId;

  const [attendance, setAttendance] = useState<ShiftAttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit modal
  const [editModal, setEditModal] = useState<EditModalState>({ open: false, record: null });
  const [editCheckedInAt, setEditCheckedInAt] = useState('');
  const [editCheckedOutAt, setEditCheckedOutAt] = useState('');
  const [editDurationMinutes, setEditDurationMinutes] = useState('');
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchAttendance = useCallback(async () => {
    if (!shiftId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await schedulingService.getShiftAttendance(shiftId);
      setAttendance(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load attendance records'));
    } finally {
      setLoading(false);
    }
  }, [shiftId]);

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  const openEditModal = (record: ShiftAttendanceRecord) => {
    setEditModal({ open: true, record });
    setEditCheckedInAt(record.checked_in_at ? formatDateTimeForInput(record.checked_in_at) : '');
    setEditCheckedOutAt(record.checked_out_at ? formatDateTimeForInput(record.checked_out_at) : '');
    setEditDurationMinutes(record.duration_minutes != null ? String(record.duration_minutes) : '');
  };

  const closeEditModal = () => {
    setEditModal({ open: false, record: null });
    setEditCheckedInAt('');
    setEditCheckedOutAt('');
    setEditDurationMinutes('');
  };

  const handleSaveEdit = async () => {
    if (!editModal.record) return;
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      if (editCheckedInAt) updates.checked_in_at = new Date(editCheckedInAt).toISOString();
      if (editCheckedOutAt) updates.checked_out_at = new Date(editCheckedOutAt).toISOString();
      if (editDurationMinutes) updates.duration_minutes = parseInt(editDurationMinutes);

      await schedulingService.updateAttendance(editModal.record.id, updates);
      toast.success('Attendance record updated');
      closeEditModal();
      await fetchAttendance();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update attendance'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (attendanceId: string) => {
    setDeleting(true);
    try {
      await schedulingService.deleteAttendance(attendanceId);
      toast.success('Attendance record removed');
      setDeleteConfirm(null);
      await fetchAttendance();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to remove attendance record'));
    } finally {
      setDeleting(false);
    }
  };

  const formatDateTime = (dateString: string) =>
    new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  const formatDateTimeForInput = (dateString: string) => {
    const d = new Date(dateString);
    return d.toISOString().slice(0, 16);
  };

  if (!shiftId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-theme-text-muted">No shift ID provided.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4" role="status">
          <RefreshCw className="w-10 h-10 text-theme-text-muted animate-spin" aria-hidden="true" />
          <p className="text-theme-text-secondary text-sm">Loading attendance records...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="bg-emerald-600 rounded-lg p-2">
              <Users className="w-6 h-6 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-theme-text-primary">Shift Attendance</h1>
              <p className="text-theme-text-secondary text-sm">
                Manage attendance records for this shift
              </p>
            </div>
          </div>
          <button
            onClick={fetchAttendance}
            className="flex items-center space-x-2 px-4 py-2 bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary rounded-lg border border-theme-surface-border transition-colors"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
            <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Content */}
        {attendance.length === 0 ? (
          <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-8 text-center">
            <Users className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-theme-text-primary mb-2">No Attendance Records</h3>
            <p className="text-theme-text-muted">
              No one has been recorded for this shift yet.
            </p>
          </div>
        ) : (
          <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-theme-surface-border bg-theme-surface">
                    <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Member</th>
                    <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Check-in</th>
                    <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Check-out</th>
                    <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Duration</th>
                    <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.map((record) => (
                    <tr key={record.id} className="border-b border-theme-surface-border hover:bg-theme-surface-hover">
                      <td className="p-3">
                        <p className="text-theme-text-primary font-medium">
                          {record.user_name || 'Unknown'}
                        </p>
                      </td>
                      <td className="p-3 text-theme-text-secondary">
                        {record.checked_in_at ? (
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-theme-text-muted" aria-hidden="true" />
                            {formatDateTime(record.checked_in_at)}
                          </span>
                        ) : (
                          <span className="text-theme-text-muted">--</span>
                        )}
                      </td>
                      <td className="p-3 text-theme-text-secondary">
                        {record.checked_out_at ? (
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-theme-text-muted" aria-hidden="true" />
                            {formatDateTime(record.checked_out_at)}
                          </span>
                        ) : (
                          <span className="text-theme-text-muted">--</span>
                        )}
                      </td>
                      <td className="p-3 text-theme-text-secondary">
                        {record.duration_minutes != null ? (
                          <span>{record.duration_minutes} min</span>
                        ) : (
                          <span className="text-theme-text-muted">--</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEditModal(record)}
                            className="p-1.5 text-theme-text-muted hover:text-blue-600 dark:hover:text-blue-400 transition-colors rounded"
                            aria-label={`Edit attendance for ${record.user_name || 'member'}`}
                          >
                            <Pencil className="w-4 h-4" aria-hidden="true" />
                          </button>
                          {deleteConfirm === record.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDelete(record.id)}
                                disabled={deleting}
                                className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                              >
                                {deleting ? '...' : 'Confirm'}
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="text-xs px-2 py-1 text-theme-text-muted hover:text-theme-text-primary"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(record.id)}
                              className="p-1.5 text-theme-text-muted hover:text-red-600 dark:hover:text-red-400 transition-colors rounded"
                              aria-label={`Delete attendance for ${record.user_name || 'member'}`}
                            >
                              <Trash2 className="w-4 h-4" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-theme-surface-border text-xs text-theme-text-muted">
              {attendance.length} attendance record{attendance.length !== 1 ? 's' : ''}
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {editModal.open && editModal.record && (
          <div
            className="fixed inset-0 z-50 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-attendance-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeEditModal();
            }}
          >
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full border border-theme-surface-border">
                <div className="px-6 pt-5 pb-1 flex justify-between items-center">
                  <h3 id="edit-attendance-title" className="text-lg font-medium text-theme-text-primary">
                    Edit Attendance
                  </h3>
                  <button
                    onClick={closeEditModal}
                    className="text-theme-text-muted hover:text-theme-text-primary p-1"
                    aria-label="Close dialog"
                  >
                    <X className="w-5 h-5" aria-hidden="true" />
                  </button>
                </div>

                <div className="px-6 py-4 space-y-4">
                  <p className="text-sm text-theme-text-secondary">
                    Editing attendance for <strong className="text-theme-text-primary">{editModal.record.user_name || 'Member'}</strong>
                  </p>

                  <div>
                    <label htmlFor="edit-checkin" className="block text-sm font-medium text-theme-text-primary mb-1">
                      Check-in Time
                    </label>
                    <input
                      id="edit-checkin"
                      type="datetime-local"
                      value={editCheckedInAt}
                      onChange={(e) => setEditCheckedInAt(e.target.value)}
                      className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="edit-checkout" className="block text-sm font-medium text-theme-text-primary mb-1">
                      Check-out Time
                    </label>
                    <input
                      id="edit-checkout"
                      type="datetime-local"
                      value={editCheckedOutAt}
                      onChange={(e) => setEditCheckedOutAt(e.target.value)}
                      className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="edit-duration" className="block text-sm font-medium text-theme-text-primary mb-1">
                      Duration (minutes)
                    </label>
                    <input
                      id="edit-duration"
                      type="number"
                      min={0}
                      value={editDurationMinutes}
                      onChange={(e) => setEditDurationMinutes(e.target.value)}
                      placeholder="Auto-calculated if blank"
                      className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                <div className="bg-theme-input-bg px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                  <button
                    onClick={closeEditModal}
                    className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={saving}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50 inline-flex items-center space-x-2"
                  >
                    {saving && <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />}
                    <span>{saving ? 'Saving...' : 'Save Changes'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ShiftAttendancePage;
