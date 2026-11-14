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
import ListPager from './ListPager';
import { inputCls } from '../constants';
import { useMaintenanceForm } from '../hooks/useMaintenanceForm';
import MaintenanceDueLabel from './MaintenanceDueLabel';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, formatNumber } from '../../../utils/dateFormatting';
import MaintenanceRecordDialog from './MaintenanceRecordDialog';
import { DialogPortal } from '../../../components/DialogPortal';

interface Props {
  facilityId: string;
  canEdit: boolean;
  canDelete: boolean;
}

export default function MaintenanceSection({ facilityId, canEdit, canDelete }: Props) {
  const tz = useTimezone();
  const form = useMaintenanceForm({ facilityId });
  const {
    records: filtered,
    page,
    setPage,
    total,
    pageSize,
    isLoading,
    loadError,
    reload,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    showModal,
    openCreate,
    openEdit,
    handleComplete,
    handleDelete,
  } = form;

  return (
    <div className="card">
      <div className="border-theme-surface-border flex items-center justify-between border-b p-4">
        <h2 className="text-theme-text-primary text-sm font-semibold">Maintenance Records</h2>
        {canEdit && (
          <button
            onClick={() => openCreate()}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
          >
            <Plus className="h-3.5 w-3.5" /> New Record
          </button>
        )}
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-xs flex-1">
            <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search maintenance records"
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
                  <div className="text-theme-text-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <MaintenanceDueLabel record={record} />
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
                {(canEdit || canDelete) && (
                  <div className="flex items-center gap-1 transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100">
                    {canEdit && !record.isCompleted && (
                      <button
                        onClick={() => {
                          void handleComplete(record);
                        }}
                        title="Mark completed"
                        aria-label="Mark completed"
                        className="rounded-lg p-1.5 text-emerald-700 transition-colors hover:bg-emerald-500/10 dark:text-emerald-600"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {canEdit && (
                      <button
                        onClick={() => openEdit(record)}
                        title="Edit"
                        aria-label="Edit record"
                        className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-1.5 transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {canDelete && (
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
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <ListPager page={page} total={total} pageSize={pageSize} onPageChange={setPage} />
      </div>

      {canEdit && showModal && (
        <DialogPortal>
          {/* Portalled: this section renders inside a `card`, whose backdrop
            blur makes the fixed overlay lay out inside the card, so the
            panel hung above the top of the screen. */}
          <MaintenanceRecordDialog form={form} titleId="facility-maintenance-dialog-title" />
        </DialogPortal>
      )}
    </div>
  );
}
