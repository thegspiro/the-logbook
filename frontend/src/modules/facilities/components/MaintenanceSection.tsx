/**
 * MaintenanceSection — Maintenance records for a single facility.
 */

import {
  Wrench,
  Plus,
  Search,
  Loader2,
  X,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Calendar,
  DollarSign,
  Pencil,
  RotateCcw,
} from 'lucide-react';
import { inputCls, labelCls } from '../constants';
import { useMaintenanceForm } from '../hooks/useMaintenanceForm';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, formatNumber } from '../../../utils/dateFormatting';

interface Props {
  facilityId: string;
  canManage: boolean;
}

export default function MaintenanceSection({ facilityId, canManage }: Props) {
  const tz = useTimezone();
  const {
    records: filtered,
    maintenanceTypes,
    isLoading,
    loadError,
    reload,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    showModal,
    setShowModal,
    editingRecord,
    isSaving,
    formData,
    setFormData,
    openCreate,
    openEdit,
    handleSave,
    handleComplete,
    handleDelete,
  } = useMaintenanceForm({ facilityId });

  return (
    <div className="bg-theme-surface border-theme-surface-border rounded-xl border">
      <div className="border-theme-surface-border flex items-center justify-between border-b p-5">
        <h2 className="text-theme-text-primary text-sm font-semibold">Maintenance Records</h2>
        {canManage && (
          <button
            onClick={() => openCreate()}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
          >
            <Plus className="h-3.5 w-3.5" /> New Record
          </button>
        )}
      </div>

      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-xs flex-1">
            <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search records..."
              placeholder="Search records..."
              className={inputCls + ' pl-9'}
            />
          </div>
          <div className="border-theme-surface-border flex items-center overflow-hidden rounded-lg border">
            {(['all', 'pending', 'completed', 'overdue'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${statusFilter === s ? 'bg-red-500/10 text-red-700 dark:text-red-400' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
          </div>
        ) : loadError ? (
          <div className="py-8 text-center">
            <Wrench className="text-theme-text-muted mx-auto mb-2 h-8 w-8" />
            <p className="text-theme-text-muted mb-3 text-sm">Failed to load maintenance records.</p>
            <button
              onClick={() => {
                void reload();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center">
            <Wrench className="text-theme-text-muted mx-auto mb-2 h-8 w-8" />
            <p className="text-theme-text-muted text-sm">
              {searchQuery || statusFilter !== 'all' ? 'No records match your filters.' : 'No maintenance records yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((record) => (
              <div key={record.id} className="bg-theme-surface-hover/30 group flex items-center gap-3 rounded-lg p-3">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    record.isCompleted
                      ? 'bg-emerald-500/10 text-emerald-500'
                      : record.isOverdue
                        ? 'bg-red-500/10 text-red-500'
                        : 'bg-amber-500/10 text-amber-500'
                  }`}
                >
                  {record.isCompleted ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : record.isOverdue ? (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  ) : (
                    <Clock className="h-3.5 w-3.5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-2">
                    <p className="text-theme-text-primary truncate text-sm font-medium">
                      {record.description || 'Untitled'}
                    </p>
                    {record.maintenanceType && (
                      <span className="bg-theme-surface-hover text-theme-text-muted shrink-0 rounded-full px-2 py-0.5 text-xs">
                        {record.maintenanceType.name}
                      </span>
                    )}
                  </div>
                  <div className="text-theme-text-muted flex items-center gap-3 text-xs">
                    {record.scheduledDate && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(record.scheduledDate, tz)}
                      </span>
                    )}
                    {record.vendor && <span>{record.vendor}</span>}
                    {record.cost != null && record.cost > 0 && (
                      <span className="flex items-center gap-1">
                        <DollarSign className="h-3 w-3" />${formatNumber(record.cost)}
                      </span>
                    )}
                    {record.workOrderNumber && <span>WO# {record.workOrderNumber}</span>}
                  </div>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                    {!record.isCompleted && (
                      <button
                        onClick={() => {
                          void handleComplete(record);
                        }}
                        title="Mark completed"
                        aria-label="Mark completed"
                        className="rounded-lg p-1.5 text-emerald-600 transition-colors hover:bg-emerald-500/10"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => openEdit(record)}
                      title="Edit"
                      aria-label="Edit record"
                      className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-1.5 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        void handleDelete(record);
                      }}
                      title="Delete"
                      aria-label="Delete record"
                      className="text-theme-text-muted rounded-lg p-1.5 transition-colors hover:bg-red-500/10 hover:text-red-500"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {canManage && showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowModal(false);
          }}
        >
          <div className="bg-theme-surface-modal border-theme-surface-border max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border">
            <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
              <h2 className="text-theme-text-primary text-lg font-bold">
                {editingRecord ? 'Edit Record' : 'New Maintenance Record'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-theme-text-muted hover:text-theme-text-primary"
                aria-label="Close dialog"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className={labelCls}>Description *</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                  rows={3}
                  className={inputCls + ' resize-none'}
                  placeholder="Describe the maintenance work..."
                />
              </div>
              {maintenanceTypes.length > 0 && (
                <div>
                  <label className={labelCls}>Maintenance Type</label>
                  <select
                    value={formData.maintenance_type_id}
                    onChange={(e) => setFormData((p) => ({ ...p, maintenance_type_id: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">Select type...</option>
                    {maintenanceTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Scheduled Date</label>
                  <input
                    type="date"
                    value={formData.scheduled_date}
                    onChange={(e) => setFormData((p) => ({ ...p, scheduled_date: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Due Date</label>
                  <input
                    type="date"
                    value={formData.due_date}
                    onChange={(e) => setFormData((p) => ({ ...p, due_date: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Performed By</label>
                  <input
                    type="text"
                    value={formData.performed_by}
                    onChange={(e) => setFormData((p) => ({ ...p, performed_by: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Vendor</label>
                  <input
                    type="text"
                    value={formData.vendor}
                    onChange={(e) => setFormData((p) => ({ ...p, vendor: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Cost ($)</label>
                  <input
                    type="number"
                    value={formData.cost}
                    onChange={(e) => setFormData((p) => ({ ...p, cost: e.target.value }))}
                    className={inputCls}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className={labelCls}>Work Order #</label>
                  <input
                    type="text"
                    value={formData.work_order_number}
                    onChange={(e) => setFormData((p) => ({ ...p, work_order_number: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))}
                  rows={2}
                  className={inputCls + ' resize-none'}
                />
              </div>
            </div>
            <div className="border-theme-surface-border flex items-center justify-end gap-3 border-t p-6">
              <button
                onClick={() => setShowModal(false)}
                className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleSave();
                }}
                disabled={isSaving}
                className="btn-primary flex items-center gap-2 px-5 text-sm"
              >
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingRecord ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
