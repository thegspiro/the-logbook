/**
 * Admin Hours Management Page
 *
 * Admin interface for managing admin hours categories, reviewing
 * pending entries, and viewing organization-wide summaries.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, QrCode, Check, X, Clock, Download, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { useAdminHoursStore } from '../store/adminHoursStore';
import { adminHoursEntryService } from '../services/api';
import type { AdminHoursCategoryCreate, AdminHoursCategoryUpdate, AdminHoursCategory } from '../types';
import toast from 'react-hot-toast';

const DEFAULT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];
const PAGE_SIZE = 20;

const AdminHoursManagePage: React.FC = () => {
  const {
    categories,
    categoriesLoading,
    allEntries,
    allEntriesTotal,
    entriesLoading,
    summary,
    pendingCount,
    error,
    fetchCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    fetchAllEntries,
    reviewEntry,
    bulkApprove,
    fetchSummary,
    fetchPendingCount,
    clearError,
  } = useAdminHoursStore();

  const [activeTab, setActiveTab] = useState<'categories' | 'pending' | 'all' | 'summary'>('categories');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<AdminHoursCategory | null>(null);
  const [formData, setFormData] = useState<AdminHoursCategoryCreate>({
    name: '',
    description: '',
    color: DEFAULT_COLORS[0],
    require_approval: true,
    auto_approve_under_hours: null,
    max_hours_per_session: 12,
    sort_order: 0,
  });
  const [rejectingEntryId, setRejectingEntryId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  // All entries tab filters
  const [allStatusFilter, setAllStatusFilter] = useState<string>('');
  const [allCategoryFilter, setAllCategoryFilter] = useState<string>('');
  const [allPage, setAllPage] = useState(0);

  // Bulk select
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());

  // Pending page
  const [pendingPage, setPendingPage] = useState(0);

  const loadData = useCallback(() => {
    void fetchCategories(true);
    void fetchPendingCount();
    if (activeTab === 'pending') {
      void fetchAllEntries({ status: 'pending', skip: pendingPage * PAGE_SIZE, limit: PAGE_SIZE });
    } else if (activeTab === 'all') {
      void fetchAllEntries({
        status: allStatusFilter || undefined,
        categoryId: allCategoryFilter || undefined,
        skip: allPage * PAGE_SIZE,
        limit: PAGE_SIZE,
      });
    } else if (activeTab === 'summary') {
      void fetchSummary();
    }
  }, [activeTab, fetchCategories, fetchAllEntries, fetchSummary, fetchPendingCount, allStatusFilter, allCategoryFilter, allPage, pendingPage]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (error) {
      toast.error(error);
      clearError();
    }
  }, [error, clearError]);

  // Clear bulk selections when changing tabs or filters
  useEffect(() => {
    setSelectedEntryIds(new Set());
  }, [activeTab, allStatusFilter, allCategoryFilter, allPage, pendingPage]);

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      color: DEFAULT_COLORS[categories.length % DEFAULT_COLORS.length],
      require_approval: true,
      auto_approve_under_hours: null,
      max_hours_per_session: 12,
      sort_order: categories.length,
    });
    setShowCreateForm(false);
    setEditingCategory(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createCategory(formData);
      toast.success('Category created');
      resetForm();
    } catch {
      // error handled by store
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory) return;
    const updateData: AdminHoursCategoryUpdate = {
      name: formData.name,
      description: formData.description || null,
      color: formData.color || undefined,
      require_approval: formData.require_approval,
      auto_approve_under_hours: formData.auto_approve_under_hours,
      max_hours_per_session: formData.max_hours_per_session,
      sort_order: formData.sort_order,
    };
    try {
      await updateCategory(editingCategory.id, updateData);
      toast.success('Category updated');
      resetForm();
    } catch {
      // error handled by store
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to deactivate this category?')) return;
    try {
      await deleteCategory(id);
      toast.success('Category deactivated');
    } catch {
      // error handled by store
    }
  };

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

  const handleCloseStaleSessions = async () => {
    try {
      const result = await adminHoursEntryService.closeStaleSessions();
      if (result.closedCount > 0) {
        toast.success(`${result.closedCount} stale sessions closed`);
        loadData();
      } else {
        toast.success('No stale sessions found');
      }
    } catch {
      toast.error('Failed to close stale sessions');
    }
  };

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

  const startEdit = (cat: AdminHoursCategory) => {
    setEditingCategory(cat);
    setFormData({
      name: cat.name,
      description: cat.description ?? '',
      color: cat.color ?? DEFAULT_COLORS[0],
      require_approval: cat.requireApproval,
      auto_approve_under_hours: cat.autoApproveUnderHours,
      max_hours_per_session: cat.maxHoursPerSession,
      sort_order: cat.sortOrder,
    });
    setShowCreateForm(true);
  };

  const formatDuration = (minutes: number | null) => {
    if (minutes === null || minutes === undefined) return '-';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const handleExportCSV = () => {
    const token = localStorage.getItem('access_token');
    const url = adminHoursEntryService.getExportUrl({
      status: allStatusFilter || undefined,
      categoryId: allCategoryFilter || undefined,
    });
    // Open in a new tab; auth is via cookie/token
    const a = document.createElement('a');
    a.href = url;
    if (token) {
      // For bearer-auth APIs, fetch with token instead
      void (async () => {
        try {
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          a.href = blobUrl;
          a.download = 'admin_hours_export.csv';
          a.click();
          URL.revokeObjectURL(blobUrl);
        } catch {
          toast.error('Failed to export CSV');
        }
      })();
      return;
    }
    a.download = 'admin_hours_export.csv';
    a.click();
  };

  const pendingTotalPages = Math.ceil(allEntriesTotal / PAGE_SIZE);
  const allTotalPages = Math.ceil(allEntriesTotal / PAGE_SIZE);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-theme-text-primary">Admin Hours Management</h1>
        <p className="text-theme-text-secondary mt-1">Manage categories, review entries, and view summaries</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-theme-surface rounded-lg p-1">
        {(['categories', 'pending', 'all', 'summary'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition relative ${
              activeTab === tab
                ? 'bg-blue-600 text-white'
                : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            {tab === 'categories' ? 'Categories' : tab === 'pending' ? 'Pending Review' : tab === 'all' ? 'All Entries' : 'Summary'}
            {tab === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none bg-red-500 text-white rounded-full">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Categories Tab */}
      {activeTab === 'categories' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-theme-text-primary">Hour Categories</h2>
            <div className="flex gap-2">
              <button
                onClick={() => { void handleCloseStaleSessions(); }}
                className="flex items-center gap-2 px-3 py-2 bg-theme-surface text-theme-text-secondary rounded-lg border border-theme-surface-border hover:bg-theme-surface-hover transition text-sm"
                title="Auto-close any sessions that exceeded their max hours limit"
              >
                <AlertTriangle className="w-4 h-4" />
                Close Stale Sessions
              </button>
              <button
                onClick={() => { resetForm(); setShowCreateForm(true); }}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                <Plus className="w-4 h-4" />
                Add Category
              </button>
            </div>
          </div>

          {/* Create/Edit Form */}
          {showCreateForm && (
            <div className="bg-theme-surface rounded-lg shadow-md p-6 mb-6">
              <h3 className="text-lg font-semibold text-theme-text-primary mb-4">
                {editingCategory ? 'Edit Category' : 'New Category'}
              </h3>
              <form onSubmit={editingCategory ? (e) => { void handleUpdate(e); } : (e) => { void handleCreate(e); }} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">Name *</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 bg-theme-surface-secondary border border-theme-surface-border rounded-lg text-theme-text-primary focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required
                      placeholder="e.g., Building Maintenance"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">Color</label>
                    <div className="flex gap-2 items-center">
                      {DEFAULT_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setFormData({ ...formData, color: c })}
                          className={`w-8 h-8 rounded-full border-2 transition ${formData.color === c ? 'border-white scale-110 ring-2 ring-blue-500' : 'border-transparent'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Description</label>
                  <textarea
                    value={formData.description ?? ''}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 bg-theme-surface-secondary border border-theme-surface-border rounded-lg text-theme-text-primary focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Brief description of this type of admin work"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.require_approval ?? true}
                      onChange={(e) => setFormData({ ...formData, require_approval: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <span className="text-sm text-theme-text-secondary">Require approval</span>
                  </label>

                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">Auto-approve under (hours)</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={formData.auto_approve_under_hours ?? ''}
                      onChange={(e) => setFormData({ ...formData, auto_approve_under_hours: e.target.value ? parseFloat(e.target.value) : null })}
                      className="w-full px-3 py-2 bg-theme-surface-secondary border border-theme-surface-border rounded-lg text-theme-text-primary focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="e.g., 4"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">Max hours per session</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      value={formData.max_hours_per_session ?? ''}
                      onChange={(e) => setFormData({ ...formData, max_hours_per_session: e.target.value ? parseFloat(e.target.value) : null })}
                      className="w-full px-3 py-2 bg-theme-surface-secondary border border-theme-surface-border rounded-lg text-theme-text-primary focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="e.g., 12"
                    />
                  </div>
                </div>

                <div className="flex gap-3">
                  <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                    {editingCategory ? 'Update' : 'Create'}
                  </button>
                  <button type="button" onClick={resetForm} className="px-4 py-2 bg-theme-surface-secondary text-theme-text-secondary rounded-lg hover:bg-theme-surface-hover transition">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Categories List */}
          {categoriesLoading ? (
            <div className="text-center py-8 text-theme-text-secondary">Loading categories...</div>
          ) : categories.length === 0 ? (
            <div className="text-center py-12 bg-theme-surface rounded-lg">
              <Clock className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
              <p className="text-theme-text-secondary">No categories yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {categories.map((cat) => (
                <div key={cat.id} className="bg-theme-surface rounded-lg shadow-md p-4 flex items-center gap-4">
                  <div
                    className="w-4 h-4 rounded-full flex-shrink-0"
                    style={{ backgroundColor: cat.color ?? '#6B7280' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-theme-text-primary">{cat.name}</h3>
                      {!cat.isActive && (
                        <span className="text-xs px-2 py-0.5 bg-red-500/20 text-red-400 rounded-full">Inactive</span>
                      )}
                    </div>
                    {cat.description && (
                      <p className="text-sm text-theme-text-secondary mt-0.5 truncate">{cat.description}</p>
                    )}
                    <div className="flex gap-4 text-xs text-theme-text-muted mt-1">
                      <span>Approval: {cat.requireApproval ? 'Required' : 'Auto-approve'}</span>
                      {cat.autoApproveUnderHours && (
                        <span>Auto-approve under {cat.autoApproveUnderHours}h</span>
                      )}
                      {cat.maxHoursPerSession && (
                        <span>Max {cat.maxHoursPerSession}h/session</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/admin-hours/categories/${cat.id}/qr-code`}
                      className="p-2 text-theme-text-secondary hover:text-blue-500 transition"
                      title="View QR Code"
                    >
                      <QrCode className="w-5 h-5" />
                    </Link>
                    <button
                      onClick={() => startEdit(cat)}
                      className="p-2 text-theme-text-secondary hover:text-blue-500 transition"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    {cat.isActive && (
                      <button
                        onClick={() => { void handleDelete(cat.id); }}
                        className="p-2 text-theme-text-secondary hover:text-red-500 transition"
                        title="Deactivate"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pending Review Tab */}
      {activeTab === 'pending' && (
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
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  Select All
                </label>
                {selectedEntryIds.size > 0 && (
                  <button
                    onClick={() => { void handleBulkApprove(); }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition"
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
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selectedEntryIds.has(entry.id)}
                          onChange={() => toggleEntrySelection(entry.id)}
                          className="w-4 h-4 rounded border-gray-300 mt-1"
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
                            <span>{new Date(entry.clockInAt).toLocaleDateString()}</span>
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
                              className="px-2 py-1 bg-theme-surface-secondary border border-theme-surface-border rounded text-sm text-theme-text-primary"
                            />
                            <button
                              onClick={() => { void handleReject(entry.id); }}
                              className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
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
                              onClick={() => { void handleApprove(entry.id); }}
                              className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition"
                            >
                              <Check className="w-4 h-4" /> Approve
                            </button>
                            <button
                              onClick={() => setRejectingEntryId(entry.id)}
                              className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition"
                            >
                              <X className="w-4 h-4" /> Reject
                            </button>
                          </>
                        )}
                      </div>
                    </div>
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
      )}

      {/* All Entries Tab */}
      {activeTab === 'all' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-theme-text-primary">All Entries</h2>
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-3 py-2 bg-theme-surface text-theme-text-secondary rounded-lg border border-theme-surface-border hover:bg-theme-surface-hover transition text-sm"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <select
              value={allStatusFilter}
              onChange={(e) => { setAllStatusFilter(e.target.value); setAllPage(0); }}
              className="px-3 py-1.5 bg-theme-surface border border-theme-surface-border rounded-lg text-sm text-theme-text-primary"
            >
              <option value="">All Statuses</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
              <option value="active">Active</option>
            </select>
            <select
              value={allCategoryFilter}
              onChange={(e) => { setAllCategoryFilter(e.target.value); setAllPage(0); }}
              className="px-3 py-1.5 bg-theme-surface border border-theme-surface-border rounded-lg text-sm text-theme-text-primary"
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
            {allEntriesTotal > 0 && (
              <span className="text-xs text-theme-text-muted ml-auto">
                Showing {allPage * PAGE_SIZE + 1}-{Math.min((allPage + 1) * PAGE_SIZE, allEntriesTotal)} of {allEntriesTotal}
              </span>
            )}
          </div>

          {entriesLoading ? (
            <div className="text-center py-8 text-theme-text-secondary">Loading...</div>
          ) : allEntries.length === 0 ? (
            <div className="text-center py-12 bg-theme-surface rounded-lg">
              <p className="text-theme-text-secondary">No entries found</p>
            </div>
          ) : (
            <>
              <div className="bg-theme-surface rounded-lg shadow-md overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-theme-surface-border">
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">Member</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">Category</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">Duration</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">Method</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">Reviewed By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-theme-surface-border">
                    {allEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-4 py-3 text-sm text-theme-text-primary">{entry.userName ?? '-'}</td>
                        <td className="px-4 py-3 text-sm">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.categoryColor ?? '#6B7280' }} />
                            <span className="text-theme-text-primary">{entry.categoryName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-theme-text-secondary">{new Date(entry.clockInAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3 text-sm text-theme-text-secondary">{formatDuration(entry.durationMinutes)}</td>
                        <td className="px-4 py-3 text-sm text-theme-text-secondary capitalize">{entry.entryMethod.replace('_', ' ')}</td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            entry.status === 'approved' ? 'bg-green-500/20 text-green-400' :
                            entry.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                            entry.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>
                            {entry.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-theme-text-muted">{entry.approverName ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* All Entries Pagination */}
              {allTotalPages > 1 && (
                <div className="flex items-center justify-center gap-4 mt-4">
                  <button
                    onClick={() => setAllPage((p) => Math.max(0, p - 1))}
                    disabled={allPage === 0}
                    className="flex items-center gap-1 px-3 py-1 text-sm text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </button>
                  <span className="text-sm text-theme-text-muted">
                    Page {allPage + 1} of {allTotalPages}
                  </span>
                  <button
                    onClick={() => setAllPage((p) => Math.min(allTotalPages - 1, p + 1))}
                    disabled={allPage >= allTotalPages - 1}
                    className="flex items-center gap-1 px-3 py-1 text-sm text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Summary Tab */}
      {activeTab === 'summary' && (
        <div>
          <h2 className="text-xl font-semibold text-theme-text-primary mb-4">Hours Summary</h2>
          {!summary ? (
            <div className="text-center py-8 text-theme-text-secondary">Loading summary...</div>
          ) : (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-theme-surface rounded-lg shadow-md p-6">
                  <p className="text-sm text-theme-text-muted">Total Hours</p>
                  <p className="text-3xl font-bold text-theme-text-primary">{summary.totalHours}</p>
                  <p className="text-xs text-theme-text-muted mt-1">{summary.totalEntries} entries</p>
                </div>
                <div className="bg-theme-surface rounded-lg shadow-md p-6">
                  <p className="text-sm text-green-400">Approved Hours</p>
                  <p className="text-3xl font-bold text-green-400">{summary.approvedHours}</p>
                  <p className="text-xs text-theme-text-muted mt-1">{summary.approvedEntries} entries</p>
                </div>
                <div className="bg-theme-surface rounded-lg shadow-md p-6">
                  <p className="text-sm text-yellow-400">Pending Hours</p>
                  <p className="text-3xl font-bold text-yellow-400">{summary.pendingHours}</p>
                  <p className="text-xs text-theme-text-muted mt-1">{summary.pendingEntries} entries</p>
                </div>
              </div>

              {summary.byCategory.length > 0 && (
                <div className="bg-theme-surface rounded-lg shadow-md p-6">
                  <h3 className="font-semibold text-theme-text-primary mb-4">By Category</h3>
                  <div className="space-y-3">
                    {summary.byCategory.map((cat) => (
                      <div key={cat.category_id} className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.category_color ?? '#6B7280' }} />
                        <span className="flex-1 text-theme-text-primary">{cat.category_name}</span>
                        <span className="text-theme-text-secondary">{cat.total_hours}h</span>
                        <span className="text-theme-text-muted text-sm">({cat.entry_count} entries)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminHoursManagePage;
