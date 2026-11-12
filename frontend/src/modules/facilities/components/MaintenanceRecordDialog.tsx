/**
 * The maintenance record dialog, shared by a facility's Maintenance section
 * and the cross-facility Maintenance page so the two cannot drift. The page
 * also asks which facility the record is for; the section already knows.
 */

import { Loader2, X } from 'lucide-react';
import { DialogPanel } from '../../../components/ux/DialogPanel';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { inputCls, labelCls } from '../constants';
import { MAINTENANCE_LIMITS, type useMaintenanceForm } from '../hooks/useMaintenanceForm';

type MaintenanceForm = ReturnType<typeof useMaintenanceForm>;

interface Props {
  form: MaintenanceForm;
  titleId: string;
  /** Offered as a Facility picker when given; omitted inside one facility. */
  facilities?: ReadonlyArray<{ id: string; name: string; isArchived?: boolean | undefined }> | undefined;
}

export default function MaintenanceRecordDialog({ form, titleId, facilities }: Props) {
  const {
    editingRecord,
    isSaving,
    formData,
    setField,
    setShowModal,
    maintenanceTypes,
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
  const field = (name: keyof typeof fieldSpecs) => ({
    id: fieldSpecs[name].id,
    error: errors[name],
    labelClassName: labelCls,
  });

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
              {editingRecord ? 'Edit Maintenance Record' : 'New Maintenance Record'}
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
            <FormField {...field('description')} label="Description" required>
              {(control) => (
                <textarea
                  {...control}
                  value={formData.description}
                  onChange={(e) => setField({ description: e.target.value })}
                  rows={3}
                  className={inputCls + ' resize-none'}
                  placeholder="Describe the maintenance work..."
                />
              )}
            </FormField>
            {maintenanceTypes.length > 0 && (
              <FormField {...field('maintenance_type_id')} label="Maintenance Type" required>
                {(control) => (
                  <select
                    {...control}
                    value={formData.maintenance_type_id}
                    onChange={(e) => setField({ maintenance_type_id: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">Select type...</option>
                    {maintenanceTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField {...field('scheduled_date')} label="Scheduled Date">
                {(control) => (
                  <input
                    {...control}
                    type="date"
                    value={formData.scheduled_date}
                    onChange={(e) => setField({ scheduled_date: e.target.value })}
                    className={inputCls}
                  />
                )}
              </FormField>
              <FormField {...field('due_date')} label="Due Date">
                {(control) => (
                  <input
                    {...control}
                    type="date"
                    value={formData.due_date}
                    onChange={(e) => setField({ due_date: e.target.value })}
                    className={inputCls}
                  />
                )}
              </FormField>
              <FormField
                {...field('performed_by')}
                label="Performed By"
                maxLength={MAINTENANCE_LIMITS.performed_by}
                count={formData.performed_by.length}
              >
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    value={formData.performed_by}
                    onChange={(e) => setField({ performed_by: e.target.value })}
                    className={inputCls}
                  />
                )}
              </FormField>
              <FormField
                {...field('vendor')}
                label="Vendor"
                maxLength={MAINTENANCE_LIMITS.vendor}
                count={formData.vendor.length}
              >
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    value={formData.vendor}
                    onChange={(e) => setField({ vendor: e.target.value })}
                    className={inputCls}
                  />
                )}
              </FormField>
              <FormField {...field('cost')} label="Cost ($)">
                {(control) => (
                  <input
                    {...control}
                    type="number"
                    min={0}
                    step="0.01"
                    value={formData.cost}
                    onChange={(e) => setField({ cost: e.target.value })}
                    className={inputCls}
                    placeholder="0.00"
                  />
                )}
              </FormField>
              <FormField
                {...field('work_order_number')}
                label="Work Order #"
                maxLength={MAINTENANCE_LIMITS.work_order_number}
                count={formData.work_order_number.length}
              >
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    value={formData.work_order_number}
                    onChange={(e) => setField({ work_order_number: e.target.value })}
                    className={inputCls}
                  />
                )}
              </FormField>
            </div>
            <FormField {...field('notes')} label="Notes">
              {(control) => (
                <textarea
                  {...control}
                  value={formData.notes}
                  onChange={(e) => setField({ notes: e.target.value })}
                  rows={2}
                  className={inputCls + ' resize-none'}
                />
              )}
            </FormField>
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
              {editingRecord ? 'Save Changes' : 'Create Record'}
            </button>
          </div>
        </form>
      </DialogPanel>
    </div>
  );
}
