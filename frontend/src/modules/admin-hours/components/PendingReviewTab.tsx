/**
 * PendingReviewTab Component
 *
 * Pending entry review with inline edit and bulk approve. Includes
 * approve/reject/edit functionality per entry and bulk selection.
 */

import React, { useState, useEffect } from 'react';
import { Check, X, Pencil, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAdminHoursStore } from '../store/adminHoursStore';
import { formatDuration } from '../utils/formatDuration';
import { DEFAULT_PAGE_SIZE } from '../../../constants/config';
import type { AdminHoursEntryEdit } from '../types';
import { formatDate, formatForDateTimeInput, localToUTC } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import DateTimeQuarterHour from '../../../components/ux/DateTimeQuarterHour';
import toast from 'react-hot-toast';

const PendingReviewTab: React.FC = () => {
  const tz = useTimezone();
  const allEntries = useAdminHoursStore((s) => s.allEntries);
  const allEntriesTotal = useAdminHoursStore((s) => s.allEntriesTotal);
  const entriesLoading = useAdminHoursStore((s) => s.entriesLoading);
  const categories = useAdminHoursStore((s) => s.categories);
  const fetchAllEntries = useAdminHoursStore((s) => s.fetchAllEntries);
  const editEntry = useAdminHoursStore((s) => s.editEntry);
  const reviewEntry = useAdminHoursStore((s) => s.reviewEntry);
  const bulkApprove = useAdminHoursStore((s) => s.bulkApprove);

  const [pendingPage, setPendingPage] = useState(0);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [rejectingEntryId, setRejectingEntryId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editData, setEditData] = useState<AdminHoursEntryEdit>({});
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Fetch pending entries when page changes
  useEffect(() => {
    void fetchAllEntries({ status: 'pending', skip: pendingPage * DEFAULT_PAGE_SIZE, limit: DEFAULT_PAGE_SIZE });
  }, [fetchAllEntries, pendingPage]);

  // Clear selections when page changes
  useEffect(() => {
    setSelectedEntryIds(new Set());
  }, [pendingPage]);

  const handleApprove = async (entryId: string) => {
    try {
      await reviewEntry(entryId, 'approve');
      toast.success('Entry approved');
    } catch {
      // error handled by store
    }
  };

  const handleReject = async (entryId: string) => {
    if (!rejectionReason.trim()) {
      toast.error('Please provide a rejection reason');
      return;
    }
    try {
      await reviewEntry(entryId, 'reject', rejectionReason);
      toast.success('Entry rejected');
      setRejectingEntryId(null);
      setRejectionReason('');
    } catch {
      // error handled by store
    }
  };

  const handleBulkApprove = async () => {
    if (selectedEntryIds.size === 0) return;
    try {
      const count = await bulkApprove(Array.from(selectedEntryIds));
      toast.success(`${count} entries approved`);
      setSelectedEntryIds(new Set());
    } catch {
      // error handled by store
    }
  };

  const startEditEntry = (entry: {
    id: string;
    clockInAt: string;
    clockOutAt: string | null;
    description: string | null;
    categoryId: string;
  }) => {
    setEditingEntryId(entry.id);
    setRejectingEntryId(null);
    // Convert ISO dates to datetime-local format in org timezone
    const toLocalInput = (iso: string) => formatForDateTimeInput(iso, tz);
    setEditData({
      clock_in_at: toLocalInput(entry.clockInAt),
      clock_out_at: entry.clockOutAt ? toLocalInput(entry.clockOutAt) : undefined,
      description: entry.description ?? '',
      category_id: entry.categoryId,
    });
  };

  const handleSaveEdit = async () => {
    if (!editingEntryId || isSavingEdit) return;
    setIsSavingEdit(true);
    try {
      await editEntry(editingEntryId, editData);
      toast.success('Entry updated');
      setEditingEntryId(null);
      setEditData({});
    } catch {
      // error handled by store
    } finally {
      setIsSavingEdit(false);
    }
  };

  const editDurationMinutes = (() => {
    if (!editData.clock_in_at || !editData.clock_out_at) return null;
    const start = new Date(localToUTC(editData.clock_in_at, tz)).getTime();
    const end = new Date(localToUTC(editData.clock_out_at, tz)).getTime();
    if (isNaN(start) || isNaN(end) || end <= start) return null;
    return Math.floor((end - start) / 60000);
  })();

  const toggleEntrySelection = (entryId: string) => {
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedEntryIds.size === allEntries.length) {
      setSelectedEntryIds(new Set());
    } else {
      setSelectedEntryIds(new Set(allEntries.map((e) => e.id)));
    }
  };

  const pendingTotalPages = Math.ceil(allEntriesTotal / DEFAULT_PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-theme-text-primary text-xl font-semibold">Pending Review</h2>
        {allEntries.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-theme-text-secondary flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedEntryIds.size === allEntries.length && allEntries.length > 0}
                onChange={toggleSelectAll}
                className="border-theme-input-border h-4 w-4 rounded-sm"
              />
              Select All
            </label>
            {selectedEntryIds.size > 0 && (
              <button
                onClick={() => {
                  void handleBulkApprove();
                }}
                className="btn-success flex items-center gap-1 px-3 py-1.5 text-sm transition"
              >
                <Check className="h-4 w-4" /> Approve {selectedEntryIds.size} Selected
              </button>
            )}
          </div>
        )}
      </div>
      {entriesLoading ? (
        <div className="text-theme-text-secondary py-8 text-center">Loading...</div>
      ) : allEntries.length === 0 ? (
        <div className="bg-theme-surface rounded-lg py-12 text-center">
          <Check className="mx-auto mb-3 h-12 w-12 text-green-500" />
          <p className="text-theme-text-secondary">No entries pending review</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {allEntries.map((entry) => (
              <div key={entry.id} className="bg-theme-surface rounded-lg p-4 shadow-md">
                {editingEntryId === entry.id ? (
                  /* Inline Edit Form */
                  <div className="space-y-3">
                    <div className="mb-2 flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: entry.categoryColor ?? '#6B7280' }}
                      />
                      <span className="text-theme-text-primary font-semibold">{entry.userName ?? 'Unknown'}</span>
                      <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-700 dark:text-yellow-400">
                        Editing
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div>
                        <label className="text-theme-text-muted mb-1 block text-xs font-medium">Category</label>
                        <select
                          value={editData.category_id ?? entry.categoryId}
                          onChange={(e) => setEditData({ ...editData, category_id: e.target.value })}
                          className="card-secondary focus:ring-theme-focus-ring text-theme-text-primary w-full px-2 py-1.5 text-sm focus:ring-2"
                        >
                          {categories.map((cat) => (
                            <option key={cat.id} value={cat.id}>
                              {cat.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-theme-text-muted mb-1 block text-xs font-medium">Start Time</label>
                        <DateTimeQuarterHour
                          value={editData.clock_in_at ?? ''}
                          onChange={(val) => setEditData({ ...editData, clock_in_at: val })}
                          className="card-secondary focus:ring-theme-focus-ring text-theme-text-primary w-full px-2 py-1.5 text-sm focus:ring-2"
                        />
                      </div>
                      <div>
                        <label className="text-theme-text-muted mb-1 block text-xs font-medium">End Time</label>
                        <DateTimeQuarterHour
                          value={editData.clock_out_at ?? ''}
                          onChange={(val) => setEditData({ ...editData, clock_out_at: val })}
                          className="card-secondary focus:ring-theme-focus-ring text-theme-text-primary w-full px-2 py-1.5 text-sm focus:ring-2"
                        />
                      </div>
                    </div>
                    {editDurationMinutes !== null && (
                      <p className="text-theme-text-secondary text-xs">
                        Duration:{' '}
                        <span className="text-theme-text-primary font-medium">
                          {formatDuration(editDurationMinutes)}
                        </span>
                      </p>
                    )}
                    <div>
                      <label className="text-theme-text-muted mb-1 block text-xs font-medium">Description</label>
                      <input
                        type="text"
                        value={editData.description ?? ''}
                        onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                        className="card-secondary focus:ring-theme-focus-ring text-theme-text-primary w-full px-2 py-1.5 text-sm focus:ring-2"
                        placeholder="Optional description"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          void handleSaveEdit();
                        }}
                        disabled={isSavingEdit}
                        className="btn-info flex items-center gap-1 px-3 py-1.5 text-sm transition disabled:opacity-50"
                      >
                        <Check className="h-4 w-4" /> {isSavingEdit ? 'Saving...' : 'Save Changes'}
                      </button>
                      <button
                        onClick={() => {
                          setEditingEntryId(null);
                          setEditData({});
                        }}
                        className="text-theme-text-muted hover:text-theme-text-primary px-3 py-1.5 text-sm transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Normal Review View */
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedEntryIds.has(entry.id)}
                        onChange={() => toggleEntrySelection(entry.id)}
                        className="border-theme-input-border mt-1 h-4 w-4 rounded-sm"
                      />
                      <div>
                        <div className="mb-1 flex items-center gap-2">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: entry.categoryColor ?? '#6B7280' }}
                          />
                          <span className="text-theme-text-primary font-semibold">{entry.userName ?? 'Unknown'}</span>
                          <span className="text-theme-text-muted text-sm">-</span>
                          <span className="text-theme-text-secondary text-sm">{entry.categoryName}</span>
                        </div>
                        <div className="text-theme-text-secondary text-sm">
                          <span>{formatDate(entry.clockInAt, tz)}</span>
                          <span className="mx-2">|</span>
                          <span>{formatDuration(entry.durationMinutes)}</span>
                          <span className="mx-2">|</span>
                          <span className="capitalize">{entry.entryMethod.replace('_', ' ')}</span>
                        </div>
                        {entry.description && <p className="text-theme-text-muted mt-1 text-sm">{entry.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {rejectingEntryId === entry.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            placeholder="Reason..."
                            className="bg-theme-surface-secondary border-theme-surface-border text-theme-text-primary rounded-sm border px-2 py-1 text-sm"
                          />
                          <button
                            onClick={() => {
                              void handleReject(entry.id);
                            }}
                            className="btn-primary rounded-sm px-3 py-1 text-sm"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => {
                              setRejectingEntryId(null);
                              setRejectionReason('');
                            }}
                            className="text-theme-text-muted text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => startEditEntry(entry)}
                            className="text-theme-text-secondary bg-theme-surface-secondary hover:bg-theme-surface-hover border-theme-surface-border flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm transition"
                          >
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </button>
                          <button
                            onClick={() => {
                              void handleApprove(entry.id);
                            }}
                            className="btn-success flex items-center gap-1 px-3 py-1.5 text-sm transition"
                          >
                            <Check className="h-4 w-4" /> Approve
                          </button>
                          <button
                            onClick={() => setRejectingEntryId(entry.id)}
                            className="btn-primary flex items-center gap-1 px-3 py-1.5 text-sm transition"
                          >
                            <X className="h-4 w-4" /> Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pending Pagination */}
          {pendingTotalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-4">
              <button
                onClick={() => setPendingPage((p) => Math.max(0, p - 1))}
                disabled={pendingPage === 0}
                className="text-theme-text-secondary hover:text-theme-text-primary flex items-center gap-1 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              <span className="text-theme-text-muted text-sm">
                Page {pendingPage + 1} of {pendingTotalPages}
              </span>
              <button
                onClick={() => setPendingPage((p) => Math.min(pendingTotalPages - 1, p + 1))}
                disabled={pendingPage >= pendingTotalPages - 1}
                className="text-theme-text-secondary hover:text-theme-text-primary flex items-center gap-1 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PendingReviewTab;
