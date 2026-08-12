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
import { enumLabel } from '../types';
import { inputCls, labelCls, INSPECTION_TYPE_OPTIONS } from '../constants';
import { useInspectionForm } from '../hooks/useInspectionForm';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';

interface Props {
  facilityId: string;
  canManage: boolean;
}

export default function InspectionsSection({ facilityId, canManage }: Props) {
  const tz = useTimezone();
  const {
    inspections: filtered,
    isLoading,
    loadError,
    reload,
    searchQuery,
    setSearchQuery,
    resultFilter,
    setResultFilter,
    showModal,
    setShowModal,
    editingInspection,
    isSaving,
    formData,
    setFormData,
    openCreate,
    openEdit,
    handleSave,
    handleDelete,
  } = useInspectionForm({ facilityId });

  return (
    <div className="bg-theme-surface border-theme-surface-border rounded-xl border">
      <div className="border-theme-surface-border flex items-center justify-between border-b p-5">
        <h2 className="text-theme-text-primary text-sm font-semibold">Inspections</h2>
        {canManage && (
          <button
            onClick={() => openCreate()}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
          >
            <Plus className="h-3.5 w-3.5" /> New Inspection
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
              aria-label="Search inspections..."
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
                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-3 w-3" /> Corrective action needed
                      </span>
                    )}
                  </div>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                    <button
                      onClick={() => openEdit(insp)}
                      title="Edit"
                      aria-label="Edit inspection"
                      className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-1.5 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
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
                {editingInspection ? 'Edit Inspection' : 'New Inspection'}
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
                <label className={labelCls}>Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData((p) => ({ ...p, title: e.target.value }))}
                  className={inputCls}
                  placeholder="e.g., Annual Fire Inspection 2026"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Type</label>
                  <select
                    value={formData.inspection_type}
                    onChange={(e) => setFormData((p) => ({ ...p, inspection_type: e.target.value }))}
                    className={inputCls}
                  >
                    {INSPECTION_TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {enumLabel(t)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Result</label>
                  <select
                    value={formData.passed}
                    onChange={(e) => setFormData((p) => ({ ...p, passed: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">Pending</option>
                    <option value="true">Passed</option>
                    <option value="false">Failed</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Inspection Date *</label>
                  <input
                    type="date"
                    value={formData.inspection_date}
                    onChange={(e) => setFormData((p) => ({ ...p, inspection_date: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Next Inspection Date</label>
                  <input
                    type="date"
                    value={formData.next_inspection_date}
                    onChange={(e) => setFormData((p) => ({ ...p, next_inspection_date: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Inspector Name</label>
                  <input
                    type="text"
                    value={formData.inspector_name}
                    onChange={(e) => setFormData((p) => ({ ...p, inspector_name: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Organization</label>
                  <input
                    type="text"
                    value={formData.inspector_organization}
                    onChange={(e) => setFormData((p) => ({ ...p, inspector_organization: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                  rows={2}
                  className={inputCls + ' resize-none'}
                />
              </div>
              <div>
                <label className={labelCls}>Findings</label>
                <textarea
                  value={formData.findings}
                  onChange={(e) => setFormData((p) => ({ ...p, findings: e.target.value }))}
                  rows={2}
                  className={inputCls + ' resize-none'}
                />
              </div>
              <div>
                <label className={labelCls}>Corrective Actions</label>
                <textarea
                  value={formData.corrective_actions}
                  onChange={(e) => setFormData((p) => ({ ...p, corrective_actions: e.target.value }))}
                  rows={2}
                  className={inputCls + ' resize-none'}
                />
              </div>
              {formData.corrective_actions && (
                <div>
                  <label className={labelCls}>Corrective Action Deadline</label>
                  <input
                    type="date"
                    value={formData.corrective_action_deadline}
                    onChange={(e) => setFormData((p) => ({ ...p, corrective_action_deadline: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              )}
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
                {editingInspection ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
