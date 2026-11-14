/**
 * InspectionsSection — Inspection records for a single facility.
 */

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
import ListPager from './ListPager';
import { enumLabel } from '../types';
import { inputCls } from '../constants';
import { useInspectionForm } from '../hooks/useInspectionForm';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import InspectionRecordDialog from './InspectionRecordDialog';
import { DialogPortal } from '../../../components/DialogPortal';

interface Props {
  facilityId: string;
  canEdit: boolean;
  canDelete: boolean;
}

export default function InspectionsSection({ facilityId, canEdit, canDelete }: Props) {
  const tz = useTimezone();
  const form = useInspectionForm({ facilityId });
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

  return (
    <div className="card">
      <div className="border-theme-surface-border flex items-center justify-between border-b p-4">
        <h2 className="text-theme-text-primary text-sm font-semibold">Inspections</h2>
        {canEdit && (
          <button
            onClick={() => openCreate()}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
          >
            <Plus className="h-3.5 w-3.5" /> New Inspection
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
              aria-label="Search inspections"
              placeholder="Search inspections..."
              className={inputCls + ' pl-9'}
            />
          </div>
          <div className="border-theme-surface-border flex items-center overflow-hidden rounded-lg border">
            {(['all', 'passed', 'failed', 'pending'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setResultFilter(s)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${resultFilter === s ? 'bg-red-500/10 text-red-700 dark:text-red-400' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
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
            <ClipboardCheck className="text-theme-text-muted mx-auto mb-2 h-8 w-8" />
            <p className="text-theme-text-muted mb-3 text-sm">Failed to load inspections.</p>
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
            <ClipboardCheck className="text-theme-text-muted mx-auto mb-2 h-8 w-8" />
            <p className="text-theme-text-muted text-sm">
              {searchQuery || resultFilter !== 'all'
                ? 'No inspections match your filters.'
                : 'No inspections recorded yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((insp) => (
              <div key={insp.id} className="bg-theme-surface-hover/30 group flex items-center gap-3 rounded-lg p-3">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    insp.passed === true
                      ? 'bg-emerald-500/10 text-emerald-500'
                      : insp.passed === false
                        ? 'bg-red-500/10 text-red-500'
                        : 'bg-theme-surface-secondary text-theme-text-muted'
                  }`}
                >
                  {insp.passed === true ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : insp.passed === false ? (
                    <XCircle className="h-3.5 w-3.5" />
                  ) : (
                    <MinusCircle className="h-3.5 w-3.5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-2">
                    <p className="text-theme-text-primary truncate text-sm font-medium">{insp.title}</p>
                    <span className="bg-theme-surface-hover text-theme-text-muted shrink-0 rounded-full px-2 py-0.5 text-xs">
                      {enumLabel(insp.inspectionType)}
                    </span>
                  </div>
                  <div className="text-theme-text-muted flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(insp.inspectionDate, tz)}
                    </span>
                    {/* Same as the cross-facility list: the organization is
                        collected and searchable, so it belongs on the row. */}
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
                        <Pencil className="h-3.5 w-3.5" />
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
          <InspectionRecordDialog form={form} titleId="facility-inspection-dialog-title" />
        </DialogPortal>
      )}
    </div>
  );
}
