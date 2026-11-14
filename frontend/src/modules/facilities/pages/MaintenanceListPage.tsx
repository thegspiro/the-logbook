/**
 * MaintenanceListPage — Cross-facility maintenance records view.
 *
 * Accessible at /facilities/maintenance. Shows all maintenance records
 * across facilities with filtering and CRUD capabilities.
 */

import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
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
  RotateCcw,
} from 'lucide-react';
import ListPager from '../components/ListPager';
import { MAINTENANCE_DUE_WINDOW_DAYS, MAINTENANCE_STATUS_FILTERS, type MaintenanceStatusFilter } from '../constants';
import { useMaintenanceForm } from '../hooks/useMaintenanceForm';
import MaintenanceDueLabel from '../components/MaintenanceDueLabel';
import MaintenanceRecordDialog from '../components/MaintenanceRecordDialog';
import { useFacilitiesStore } from '../store/facilitiesStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, formatNumber } from '../../../utils/dateFormatting';
import { useFacilitiesAccess } from '../hooks/useFacilitiesAccess';
import { OperationsPageHeader } from '../../../components/operations/OperationsPageHeader';

const STATUS_LABELS: Record<MaintenanceStatusFilter, string> = {
  all: 'All',
  pending: 'Pending',
  due: 'Due soon',
  completed: 'Completed',
  overdue: 'Overdue',
};

// The dashboard links here as ?status=overdue ("Urgent work orders") and
// ?status=due ("Maintenance due"). An unknown value opens the full list.
function parseStatus(value: string | null): MaintenanceStatusFilter {
  return MAINTENANCE_STATUS_FILTERS.find((s) => s === value) ?? 'all';
}

export default function MaintenanceListPage() {
  // Create/edit/complete accept facilities.maintenance or facilities.edit on
  // the backend; delete accepts facilities.delete or facilities.manage.
  const { canDelete, canMaintenance } = useFacilitiesAccess();
  const [searchParams] = useSearchParams();
  const tz = useTimezone();
  const { facilities, loadFacilities, loadLookupData } = useFacilitiesStore();

  useEffect(() => {
    void loadFacilities();
    void loadLookupData();
  }, [loadFacilities, loadLookupData]);

  const initialStatus = parseStatus(searchParams.get('status'));

  const form = useMaintenanceForm({ initialStatusFilter: initialStatus, idPrefix: 'maintenance-list' });
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

  const getFacilityName = (facilityId: string) =>
    facilities.find((f) => f.id === facilityId)?.name || 'Unknown facility';

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <OperationsPageHeader
        icon={Wrench}
        title="Maintenance Records"
        subtitle="Track and manage maintenance across all facilities"
        actions={
          canMaintenance && (
            <button onClick={() => openCreate()} className="btn-primary flex shrink-0 items-center gap-2">
              <Plus className="h-4 w-4" /> New Record
            </button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1">
          <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search maintenance records"
            placeholder="Search records..."
            className="form-input placeholder-theme-text-muted py-2.5 pr-4 pl-10"
          />
        </div>
        <div className="border-theme-surface-border flex items-center overflow-hidden rounded-lg border">
          {MAINTENANCE_STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              aria-pressed={statusFilter === s}
              className={`px-3 py-2 text-xs font-medium transition-colors ${statusFilter === s ? 'bg-red-500/10 text-red-700 dark:text-red-400' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {statusFilter === 'due' && (
        <p className="text-theme-text-secondary text-sm" role="status">
          Open work due in the next {MAINTENANCE_DUE_WINDOW_DAYS} days, today included, and not yet marked overdue, at
          facilities that are not archived. Overdue work is under Overdue.
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      ) : loadError ? (
        <div className="py-20 text-center">
          <Wrench className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <p className="text-theme-text-muted mb-3">Failed to load maintenance records.</p>
          <button
            onClick={() => {
              void reload();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
          >
            <RotateCcw className="h-4 w-4" /> Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center">
          <Wrench className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <p className="text-theme-text-muted">
            {searchQuery || statusFilter !== 'all' ? 'No records match your filters.' : 'No maintenance records yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((record) => (
            <div
              key={record.id}
              className="card hover:border-theme-surface-border group flex items-center gap-4 p-4 transition-all"
            >
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  record.isCompleted
                    ? 'bg-emerald-500/10 text-emerald-500'
                    : record.isOverdue
                      ? 'bg-red-500/10 text-red-500'
                      : 'bg-amber-500/10 text-amber-500'
                }`}
              >
                {record.isCompleted ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : record.isOverdue ? (
                  <AlertTriangle className="h-4 w-4" />
                ) : (
                  <Clock className="h-4 w-4" />
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
                  <span>{getFacilityName(record.facilityId)}</span>
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
              {canMaintenance && (
                <div className="flex items-center gap-1 transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100">
                  {!record.isCompleted && (
                    <button
                      onClick={() => {
                        void handleComplete(record);
                      }}
                      title="Mark completed"
                      aria-label="Mark completed"
                      className="rounded-lg p-1.5 text-emerald-700 transition-colors hover:bg-emerald-500/10 dark:text-emerald-600"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => openEdit(record)}
                    title="Edit"
                    aria-label="Edit record"
                    className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-1.5 transition-colors"
                  >
                    <Wrench className="h-4 w-4" />
                  </button>
                  {canDelete && (
                    <button
                      onClick={() => {
                        void handleDelete(record);
                      }}
                      title="Delete"
                      aria-label="Delete record"
                      className="text-theme-text-muted rounded-lg p-1.5 transition-colors hover:bg-red-500/10 hover:text-red-500"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <ListPager page={page} total={total} pageSize={pageSize} onPageChange={setPage} />

      {canMaintenance && showModal && (
        <MaintenanceRecordDialog form={form} titleId="maintenance-list-dialog-title" facilities={facilities} />
      )}
    </div>
  );
}
