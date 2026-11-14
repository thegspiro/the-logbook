/**
 * InspectionsListPage — Cross-facility inspections view.
 *
 * Accessible at /facilities/inspections. Shows all inspections across
 * facilities with filtering and CRUD capabilities.
 */

import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import InspectionRecordDialog from '../components/InspectionRecordDialog';

import {
  ClipboardCheck,
  Plus,
  Search,
  Loader2,
  X,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Calendar,
  AlertTriangle,
  Pencil,
  RotateCcw,
} from 'lucide-react';
import ListPager from '../components/ListPager';
import { enumLabel } from '../types';
import { useInspectionForm } from '../hooks/useInspectionForm';
import { useFacilitiesStore } from '../store/facilitiesStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import { useFacilitiesAccess } from '../hooks/useFacilitiesAccess';
import { OperationsPageHeader } from '../../../components/operations/OperationsPageHeader';

/** The endpoint's own bound on `due_within_days`; anything else is ignored. */
const MAX_DUE_WITHIN_DAYS = 366;

/**
 * The dashboard's "Upcoming inspections" tile links here as `?dueWithin=30`.
 * A value that is not a whole number of days in range degrades to the full
 * list rather than an error.
 */
function parseDueWithin(raw: string | null): number | undefined {
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const days = Number(raw);
  return days <= MAX_DUE_WITHIN_DAYS ? days : undefined;
}

export default function InspectionsListPage() {
  const { canEdit, canDelete } = useFacilitiesAccess();
  const tz = useTimezone();
  const [searchParams, setSearchParams] = useSearchParams();
  const dueWithinDays = parseDueWithin(searchParams.get('dueWithin'));
  const { facilities, loadFacilities } = useFacilitiesStore();

  useEffect(() => {
    void loadFacilities();
  }, [loadFacilities]);

  const form = useInspectionForm({ dueWithinDays, idPrefix: 'inspection-list' });
  const {
    inspections: filtered,
    page,
    setPage,
    total,
    pageSize,
    isLoading,
    loadError,
    reload,
    searchQuery,
    setSearchQuery,
    resultFilter,
    setResultFilter,
    showModal,
    openCreate,
    openEdit,
    handleDelete,
  } = form;

  const clearDueWithin = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('dueWithin');
    setSearchParams(next, { replace: true });
    setPage(1);
  };

  const getFacilityName = (facilityId: string) =>
    facilities.find((f) => f.id === facilityId)?.name || 'Unknown facility';

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <OperationsPageHeader
        icon={ClipboardCheck}
        title="Inspections"
        subtitle="Track and manage inspections across all facilities"
        actions={
          canEdit && (
            <button onClick={() => openCreate()} className="btn-primary flex shrink-0 items-center gap-2">
              <Plus className="h-4 w-4" /> New Inspection
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
            aria-label="Search inspections"
            placeholder="Search inspections..."
            className="form-input placeholder-theme-text-muted py-2.5 pr-4 pl-10"
          />
        </div>
        <div className="border-theme-surface-border flex items-center overflow-hidden rounded-lg border">
          {(['all', 'passed', 'failed', 'pending'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setResultFilter(s)}
              aria-pressed={resultFilter === s}
              className={`px-3 py-2 text-xs font-medium transition-colors ${resultFilter === s ? 'bg-red-500/10 text-red-700 dark:text-red-400' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {dueWithinDays !== undefined && (
        <div className="alert-warning flex flex-wrap items-center justify-between gap-2 text-sm" role="status">
          <span>
            Showing only inspections next due {dueWithinDays === 0 ? 'today' : `in the next ${dueWithinDays} days`}, at
            facilities that are not archived.
          </span>
          <button type="button" onClick={clearDueWithin} className="touch-target-phone font-medium underline">
            Show all inspections
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      ) : loadError ? (
        <div className="py-20 text-center">
          <ClipboardCheck className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <p className="text-theme-text-muted mb-3">Failed to load inspections.</p>
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
          <ClipboardCheck className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <p className="text-theme-text-muted">
            {searchQuery || resultFilter !== 'all' || dueWithinDays !== undefined
              ? 'No inspections match your filters.'
              : 'No inspections recorded yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((insp) => (
            <div
              key={insp.id}
              className="card hover:border-theme-surface-border group flex items-center gap-4 p-4 transition-all"
            >
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  insp.passed === true
                    ? 'bg-emerald-500/10 text-emerald-500'
                    : insp.passed === false
                      ? 'bg-red-500/10 text-red-500'
                      : 'bg-theme-surface-secondary text-theme-text-muted'
                }`}
              >
                {insp.passed === true ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : insp.passed === false ? (
                  <XCircle className="h-4 w-4" />
                ) : (
                  <MinusCircle className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-2">
                  <p className="text-theme-text-primary truncate text-sm font-medium">{insp.title}</p>
                  <span className="bg-theme-surface-hover text-theme-text-muted shrink-0 rounded-full px-2 py-0.5 text-xs">
                    {enumLabel(insp.inspectionType)}
                  </span>
                </div>
                <div className="text-theme-text-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span>{getFacilityName(insp.facilityId)}</span>
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {formatDate(insp.inspectionDate, tz)}
                  </span>
                  {/* Who inspected, and for whom. The organization is asked for
                      on the form and is one of the fields search matches, so
                      leaving it off every row meant you could find a record by
                      typing "Commonwealth Mutual" and then not see it named
                      anywhere on the result. */}
                  {insp.inspectorName && (
                    <span>
                      {insp.inspectorName}
                      {insp.inspectorOrganization ? ` · ${insp.inspectorOrganization}` : ''}
                    </span>
                  )}
                  {!insp.inspectorName && insp.inspectorOrganization && <span>{insp.inspectorOrganization}</span>}
                  {insp.nextInspectionDate && <span>Next: {formatDate(insp.nextInspectionDate, tz)}</span>}
                  {insp.correctiveActions && !insp.correctiveActionCompleted && (
                    <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" /> Corrective action needed
                    </span>
                  )}
                </div>
              </div>
              {(canEdit || canDelete) && (
                <div className="flex items-center gap-1 transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100">
                  {canEdit && (
                    <button
                      onClick={() => openEdit(insp)}
                      title="Edit"
                      aria-label="Edit inspection"
                      className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-1.5 transition-colors"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => {
                        void handleDelete(insp);
                      }}
                      title="Delete"
                      aria-label="Delete inspection"
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

      {canEdit && showModal && (
        <InspectionRecordDialog form={form} titleId="inspection-list-dialog-title" facilities={facilities} />
      )}
    </div>
  );
}
