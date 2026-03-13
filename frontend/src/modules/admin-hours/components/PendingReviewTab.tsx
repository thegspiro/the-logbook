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
import { formatDate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
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

  const startEditEntry = (entry: { id: string; clockInAt: string; clockOutAt: string | null; description: string | null; categoryId: string }) => {
    setEditingEntryId(entry.id);
    setRejectingEntryId(null);
    // Convert ISO dates to datetime-local format
    const toLocalInput = (iso: string) => {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
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
    const start = new Date(editData.clock_in_at).getTime();
    const end = new Date(editData.clock_out_at).getTime();
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
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-theme-text-primary">Pending Review</h2>
        {allEntries.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={selectedEntryIds.size === allEntries.length && allEntries.length > 0}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded-sm border-theme-input-border"
              />
              Select All
            </label>
            {selectedEntryIds.size > 0 && (
              <button
                onClick={() => { void handleBulkApprove(); }}
                className="btn-success flex gap-1 items-center px-3 py-1.5 text-sm transition"
              >
                <Check className="w-4 h-4" /> Approve {selectedEntryIds.size} Selected
              </button>
            )}
          </div>
        )}
      </div>
      {entriesLoading ? (
        <div className="text-center py-8 text-theme-text-secondary">Loading...</div>
      ) : allEntries.length === 0 ? (
        <div className="text-center py-12 bg-theme-surface rounded-lg">
          <Check className="w-12 h-12 text-green-500 mx-auto mb-3" />
          <p className="text-theme-text-secondary">No entries pending review</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {allEntries.map((entry) => (
              <div key={entry.id} className="bg-theme-surface rounded-lg shadow-md p-4">
                {editingEntryId === entry.id ? (
                  /* Inline Edit Form */
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: entry.categoryColor ?? '#6B7280' }}
                      />
                      <span className="font-semibold text-theme-text-primary">{entry.userName ?? 'Unknown'}</span>
                      <span className="text-xs px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded-full">Editing</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-theme-text-muted mb-1">Category</label>
                        <select
                          value={editData.category_id ?? entry.categoryId}
                          onChange={(e) => setEditData({ ...editData, category_id: e.target.value })}
                          className="card-secondary focus:ring-2 focus:ring-theme-focus-ring px-2 py-1.5 text-sm text-theme-text-primary w-full"
                        >
                          {categories.map((cat) => (
                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-theme-text-muted mb-1">Start Time</label>
                        <input
                          type="datetime-local"
                          value={editData.clock_in_at ?? ''}
                          onChange={(e) => setEditData({ ...editData, clock_in_at: e.target.value })}
                          className="card-secondary focus:ring-2 focus:ring-theme-focus-ring px-2 py-1.5 text-sm text-theme-text-primary w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-theme-text-muted mb-1">End Time</label>
                        <input
                          type="datetime-local"
                          value={editData.clock_out_at ?? ''}
                          onChange={(e) => setEditData({ ...editData, clock_out_at: e.target.value })}
                          min={editData.clock_in_at ?? undefined}
                          className="card-secondary focus:ring-2 focus:ring-theme-focus-ring px-2 py-1.5 text-sm text-theme-text-primary w-full"
                        />
                      </div>
                    </div>
                    {editDurationMinutes !== null && (
                      <p className="text-xs text-theme-text-secondary">
                        Duration: <span className="font-medium text-theme-text-primary">{formatDuration(editDurationMinutes)}</span>
                      </p>
                    )}
                    <div>
                      <label className="block text-xs font-medium text-theme-text-muted mb-1">Description</label>
                      <input
                        type="text"
                        value={editData.description ?? ''}
                        onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                        className="card-secondary focus:ring-2 focus:ring-theme-focus-ring px-2 py-1.5 text-sm text-theme-text-primary w-full"
                        placeholder="Optional description"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { void handleSaveEdit(); }}
                        disabled={isSavingEdit}
                        className="btn-info flex gap-1 items-center px-3 py-1.5 text-sm transition disabled:opacity-50"
                      >
                        <Check className="w-4 h-4" /> {isSavingEdit ? 'Saving...' : 'Save Changes'}
                      </button>
                      <button
                        onClick={() => { setEditingEntryId(null); setEditData({}); }}
                        className="px-3 py-1.5 text-sm text-theme-text-muted hover:text-theme-text-primary transition"
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
                        className="w-4 h-4 rounded-sm border-theme-input-border mt-1"
                      />
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: entry.categoryColor ?? '#6B7280' }}
                          />
                          <span className="font-semibold text-theme-text-primary">{entry.userName ?? 'Unknown'}</span>
                          <span className="text-sm text-theme-text-muted">-</span>
                          <span className="text-sm text-theme-text-secondary">{entry.categoryName}</span>
                        </div>
                        <div className="text-sm text-theme-text-secondary">
                          <span>{formatDate(entry.clockInAt, tz)}</span>
                          <span className="mx-2">|</span>
                          <span>{formatDuration(entry.durationMinutes)}</span>
                          <span className="mx-2">|</span>
                          <span className="capitalize">{entry.entryMethod.replace('_', ' ')}</span>
                        </div>
                        {entry.description && (
                          <p className="text-sm text-theme-text-muted mt-1">{entry.description}</p>
                        )}
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
                            className="px-2 py-1 bg-theme-surface-secondary border border-theme-surface-border rounded-sm text-sm text-theme-text-primary"
                          />
                          <button
                            onClick={() => { void handleReject(entry.id); }}
                            className="btn-primary rounded-sm px-3 py-1 text-sm"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => { setRejectingEntryId(null); setRejectionReason(''); }}
                            className="text-theme-text-muted text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => startEditEntry(entry)}
                            className="flex gap-1 items-center px-3 py-1.5 text-sm text-theme-text-secondary bg-theme-surface-secondary rounded-lg hover:bg-theme-surface-hover transition border border-theme-surface-border"
                          >
                            <Pencil className="w-3.5 h-3.5" /> Edit
                          </button>
                          <button
                            onClick={() => { void handleApprove(entry.id); }}
                            className="btn-success flex gap-1 items-center px-3 py-1.5 text-sm transition"
                          >
                            <Check className="w-4 h-4" /> Approve
                          </button>
                          <button
                            onClick={() => setRejectingEntryId(entry.id)}
                            className="btn-primary flex gap-1 items-center px-3 py-1.5 text-sm transition"
                          >
                            <X className="w-4 h-4" /> Reject
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
            <div className="flex items-center justify-center gap-4 mt-4">
              <button
                onClick={() => setPendingPage((p) => Math.max(0, p - 1))}
                disabled={pendingPage === 0}
                className="flex items-center gap-1 px-3 py-1 text-sm text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>
              <span className="text-sm text-theme-text-muted">
                Page {pendingPage + 1} of {pendingTotalPages}
              </span>
              <button
                onClick={() => setPendingPage((p) => Math.min(pendingTotalPages - 1, p + 1))}
                disabled={pendingPage >= pendingTotalPages - 1}
                className="flex items-center gap-1 px-3 py-1 text-sm text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PendingReviewTab;
