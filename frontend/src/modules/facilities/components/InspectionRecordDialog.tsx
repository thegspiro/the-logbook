/**
 * The inspection dialog, shared by a facility's Inspections section and the
 * cross-facility Inspections page so the two cannot drift. The page also asks
 * which facility the inspection is for; the section already knows.
 */

import { Loader2, X } from 'lucide-react';
import { DialogPanel } from '../../../components/ux/DialogPanel';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { INSPECTION_TYPE_OPTIONS, inputCls, labelCls } from '../constants';
import { enumLabel } from '../types';
import { INSPECTION_LIMITS, type InspectionField, type useInspectionForm } from '../hooks/useInspectionForm';

type InspectionForm = ReturnType<typeof useInspectionForm>;

interface Props {
  form: InspectionForm;
  titleId: string;
  /** Offered as a Facility picker when given; omitted inside one facility. */
  facilities?: ReadonlyArray<{ id: string; name: string; isArchived?: boolean | undefined }> | undefined;
}

export default function InspectionRecordDialog({ form, titleId, facilities }: Props) {
  const {
    editingInspection,
    isSaving,
    formData,
    setField,
    setShowModal,
    handleSave,
    fieldSpecs,
    errors,
    formError,
    isDirty,
  } = form;
  // Escape, the X and Cancel all ask before throwing typed changes away
  // (forms review F-6); DialogPanel is handed the guarded close, not isDirty,
  // so the question is asked once.
  const requestClose = useDiscardGuard({ isDirty, onClose: () => setShowModal(false) });
  const field = (name: InspectionField) => ({
    id: fieldSpecs[name].id,
    error: errors[name],
    labelClassName: labelCls,
  });
  const textArea = (name: 'description' | 'findings' | 'corrective_actions' | 'notes', label: string) => (
    <FormField {...field(name)} label={label}>
      {(control) => (
        <textarea
          {...control}
          value={formData[name]}
          onChange={(e) => setField({ [name]: e.target.value })}
          rows={2}
          className={inputCls + ' resize-none'}
        />
      )}
    </FormField>
  );
  const textInput = (name: 'inspector_name' | 'inspector_organization', label: string) => (
    <FormField {...field(name)} label={label} maxLength={INSPECTION_LIMITS[name]} count={formData[name].length}>
      {(control) => (
        <input
          {...control}
          type="text"
          value={formData[name]}
          onChange={(e) => setField({ [name]: e.target.value })}
          className={inputCls}
        />
      )}
    </FormField>
  );
  const dateInput = (
    name: 'inspection_date' | 'next_inspection_date' | 'corrective_action_deadline',
    label: string,
    required = false
  ) => (
    <FormField {...field(name)} label={label} required={required}>
      {(control) => (
        <input
          {...control}
          type="date"
          value={formData[name]}
          onChange={(e) => setField({ [name]: e.target.value })}
          className={inputCls}
        />
      )}
    </FormField>
  );

  return (
    <div
      className="modal-overlay z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-labelledby={titleId}
      aria-modal="true"
    >
      <DialogPanel onClose={requestClose} className="max-h-[90dvh] w-full max-w-lg overflow-y-auto">
        <form onSubmit={(e) => void handleSave(e)} noValidate>
          <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
            <h2 id={titleId} className="text-theme-text-primary text-lg font-bold">
              {editingInspection ? 'Edit Inspection' : 'New Inspection'}
            </h2>
            <button
              type="button"
              data-dialog-close
              onClick={requestClose}
              className="text-theme-text-muted hover:text-theme-text-primary"
              aria-label="Close dialog"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-4 p-6">
            {formError && (
              <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
                {formError}
              </p>
            )}
            {facilities && (
              <FormField {...field('facility_id')} label="Facility" required>
                {(control) => (
                  <select
                    {...control}
                    value={formData.facility_id}
                    onChange={(e) => setField({ facility_id: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">Select facility...</option>
                    {facilities
                      .filter((f) => !f.isArchived)
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                  </select>
                )}
              </FormField>
            )}
            <FormField
              {...field('title')}
              label="Title"
              required
              maxLength={INSPECTION_LIMITS.title}
              count={formData.title.length}
            >
              {(control) => (
                <input
                  {...control}
                  type="text"
                  value={formData.title}
                  onChange={(e) => setField({ title: e.target.value })}
                  className={inputCls}
                  placeholder="e.g., Annual Fire Inspection 2026"
                />
              )}
            </FormField>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField {...field('inspection_type')} label="Type">
                {(control) => (
                  <select
                    {...control}
                    value={formData.inspection_type}
                    onChange={(e) => setField({ inspection_type: e.target.value })}
                    className={inputCls}
                  >
                    {INSPECTION_TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {enumLabel(t)}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField {...field('passed')} label="Result">
                {(control) => (
                  <select
                    {...control}
                    value={formData.passed}
                    onChange={(e) => setField({ passed: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">Pending</option>
                    <option value="true">Passed</option>
                    <option value="false">Failed</option>
                  </select>
                )}
              </FormField>
              {dateInput('inspection_date', 'Inspection Date', true)}
              {dateInput('next_inspection_date', 'Next Inspection Date')}
              {textInput('inspector_name', 'Inspector Name')}
              {textInput('inspector_organization', 'Inspector Organization')}
            </div>
            {textArea('description', 'Description')}
            {textArea('findings', 'Findings')}
            {textArea('corrective_actions', 'Corrective Actions')}
            {formData.corrective_actions && dateInput('corrective_action_deadline', 'Corrective Action Deadline')}
            {textArea('notes', 'Notes')}
          </div>
          <div className="border-theme-surface-border flex items-center justify-end gap-3 border-t p-6">
            <button
              type="button"
              onClick={requestClose}
              className="text-theme-text-secondary hover:text-theme-text-primary touch:min-h-11 px-4 py-2 text-sm transition-colors"
            >
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="btn-primary flex items-center gap-2 px-4 text-sm">
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingInspection ? 'Save Changes' : 'Create Inspection'}
            </button>
          </div>
        </form>
      </DialogPanel>
    </div>
  );
}
