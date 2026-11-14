/**
 * ComplianceSection — Compliance checklists for a single facility.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Plus, Trash2, Loader2, CheckCircle2, Circle, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../../services/api';
import type { ComplianceChecklist, ComplianceChecklistCreate } from '../../../services/facilitiesServices';
import { enumLabel } from '../types';
import { inputCls, labelCls, COMPLIANCE_TYPE_OPTIONS } from '../constants';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, isPastDate } from '../../../utils/dateFormatting';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useFieldErrors, type FieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { useConfirm } from '../../../contexts/ConfirmContext';

const EMPTY_FORM = { compliance_type: 'nfpa', checklist_name: '', description: '', due_date: '' };
type ChecklistForm = typeof EMPTY_FORM;
type ChecklistField = keyof ChecklistForm;

// Ordered as on screen, so the first refusal takes focus.
const CHECKLIST_FIELDS: FieldSpecs<ChecklistField> = {
  checklist_name: { id: 'compliance-checklist-name', label: 'Title' },
  compliance_type: { id: 'compliance-checklist-type', label: 'Type' },
  due_date: { id: 'compliance-checklist-due-date', label: 'Due date' },
  description: { id: 'compliance-checklist-description', label: 'Description' },
};
// Mirrors FacilityComplianceChecklistBase.checklist_name.
const CHECKLIST_NAME_LIMIT = 300;

interface Props {
  facilityId: string;
  canCreate: boolean;
  canDelete: boolean;
}

export default function ComplianceSection({ facilityId, canCreate, canDelete }: Props) {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [checklists, setChecklists] = useState<ComplianceChecklist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<ChecklistForm>(EMPTY_FORM);
  const checklistErrors = useFieldErrors(CHECKLIST_FIELDS);
  const set = (patch: Partial<ChecklistForm>) => {
    setFormData((p) => ({ ...p, ...patch }));
    for (const key of Object.keys(patch)) checklistErrors.setError(key as ChecklistField, null);
  };
  const closeForm = () => {
    setShowForm(false);
    setFormData(EMPTY_FORM);
    checklistErrors.clear();
  };
  // Cancel (and the header's Add Checklist, which toggles the form) asks
  // before throwing typed changes away (forms review F-6).
  const requestCancel = useDiscardGuard({
    isDirty: showForm && JSON.stringify(formData) !== JSON.stringify(EMPTY_FORM),
    onClose: closeForm,
  });

  const loadChecklists = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await facilitiesService.getComplianceChecklists({ facility_id: facilityId });
      setChecklists(data);
    } catch {
      toast.error('Failed to load compliance checklists');
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void loadChecklists();
  }, [loadChecklists]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    // Named on the field rather than in a toast that vanished (forms review F-3).
    const problems: FieldErrors<ChecklistField> = {};
    if (!formData.checklist_name.trim()) problems.checklist_name = 'Enter a title for the checklist.';
    checklistErrors.setFormError(null);
    checklistErrors.setErrors(problems);
    if (Object.keys(problems).length > 0) {
      checklistErrors.focusFirst(problems);
      return;
    }
    setIsSaving(true);
    try {
      const payload: ComplianceChecklistCreate = {
        facility_id: facilityId,
        compliance_type: formData.compliance_type,
        checklist_name: formData.checklist_name.trim(),
      };
      if (formData.description.trim()) payload.description = formData.description.trim();
      if (formData.due_date) payload.due_date = formData.due_date;

      await facilitiesService.createComplianceChecklist(payload);
      toast.success('Checklist created');
      closeForm();
      void loadChecklists();
    } catch (err: unknown) {
      // A refused field is flagged on that field (forms review F-2); anything
      // no field answers for is said in the form. Nothing is created until
      // it is fixed.
      const placed = checklistErrors.setFromApiError(err, 'Failed to create checklist');
      checklistErrors.focusFirst(placed);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (checklist: ComplianceChecklist) => {
    if (
      !(await confirm({
        title: 'Delete checklist',
        message: `Delete the compliance checklist "${checklist.checklistName}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    try {
      await facilitiesService.deleteComplianceChecklist(checklist.id);
      toast.success('Checklist deleted');
      void loadChecklists();
    } catch {
      toast.error('Failed to delete checklist');
    }
  };

  return (
    <div className="card">
      <div className="border-theme-surface-border flex items-center justify-between border-b p-4">
        <h2 className="text-theme-text-primary text-sm font-semibold">
          Compliance Checklists {!isLoading && `(${checklists.length})`}
        </h2>
        {canCreate && (
          <button
            onClick={() => (showForm ? requestCancel() : setShowForm(true))}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
          >
            <Plus className="h-3.5 w-3.5" /> Add Checklist
          </button>
        )}
      </div>

      <div className="p-4">
        {canCreate && showForm && (
          <form
            onSubmit={(e) => void handleCreate(e)}
            noValidate
            className="bg-theme-surface-hover/50 mb-5 space-y-3 rounded-lg p-4"
          >
            <h3 className="text-theme-text-primary text-sm font-medium">New Compliance Checklist</h3>
            {checklistErrors.formError && (
              <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
                {checklistErrors.formError}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <FormField
                id={CHECKLIST_FIELDS.checklist_name.id}
                label="Title"
                required
                error={checklistErrors.errors.checklist_name}
                labelClassName={labelCls}
                maxLength={CHECKLIST_NAME_LIMIT}
                count={formData.checklist_name.length}
              >
                {(field) => (
                  <input
                    {...field}
                    type="text"
                    value={formData.checklist_name}
                    onChange={(e) => set({ checklist_name: e.target.value })}
                    placeholder="e.g., NFPA 1500 Annual Review"
                    className={inputCls}
                    autoFocus
                  />
                )}
              </FormField>
              <FormField
                id={CHECKLIST_FIELDS.compliance_type.id}
                label="Type"
                error={checklistErrors.errors.compliance_type}
                labelClassName={labelCls}
              >
                {(field) => (
                  <select
                    {...field}
                    value={formData.compliance_type}
                    onChange={(e) => set({ compliance_type: e.target.value })}
                    className={inputCls}
                  >
                    {COMPLIANCE_TYPE_OPTIONS.map((ct) => (
                      <option key={ct} value={ct}>
                        {enumLabel(ct)}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField
                id={CHECKLIST_FIELDS.due_date.id}
                label="Due Date"
                error={checklistErrors.errors.due_date}
                labelClassName={labelCls}
              >
                {(field) => (
                  <input
                    {...field}
                    type="date"
                    value={formData.due_date}
                    onChange={(e) => set({ due_date: e.target.value })}
                    className={inputCls}
                  />
                )}
              </FormField>
              <FormField
                id={CHECKLIST_FIELDS.description.id}
                label="Description"
                error={checklistErrors.errors.description}
                labelClassName={labelCls}
              >
                {(field) => (
                  <input
                    {...field}
                    type="text"
                    value={formData.description}
                    onChange={(e) => set({ description: e.target.value })}
                    className={inputCls}
                  />
                )}
              </FormField>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={isSaving}
                className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create Checklist
              </button>
              <button
                type="button"
                onClick={requestCancel}
                className="text-theme-text-muted hover:text-theme-text-primary touch:min-h-11 px-3 py-1.5 text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {isLoading ? (
          <div className="flex justify-center py-8" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
          </div>
        ) : checklists.length === 0 ? (
          <div className="py-8 text-center">
            <ShieldCheck className="text-theme-text-muted mx-auto mb-2 h-8 w-8" />
            <p className="text-theme-text-muted text-sm">No compliance checklists yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {checklists.map((checklist) => (
              <div
                key={checklist.id}
                className="bg-theme-surface-hover/30 group flex items-center justify-between rounded-lg p-3"
              >
                <div className="flex items-center gap-3">
                  {checklist.isCompleted ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Circle className="text-theme-text-muted h-4 w-4" />
                  )}
                  <div>
                    <p className="text-theme-text-primary text-sm font-medium">{checklist.checklistName}</p>
                    <div className="text-theme-text-muted flex items-center gap-2 text-xs">
                      <span>{enumLabel(checklist.complianceType)}</span>
                      {checklist.dueDate && (
                        <span
                          className={`flex items-center gap-1 ${isPastDate(checklist.dueDate) && !checklist.isCompleted ? 'font-medium text-red-500' : ''}`}
                        >
                          <Calendar className="h-3 w-3" />
                          Due: {formatDate(checklist.dueDate, tz)}
                        </span>
                      )}
                      {checklist.isCompleted && checklist.completedDate && (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          Completed: {formatDate(checklist.completedDate, tz)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {canDelete && (
                  <button
                    onClick={() => {
                      void handleDelete(checklist);
                    }}
                    className="text-theme-text-muted rounded-lg p-1.5 transition-all hover:bg-red-500/10 hover:text-red-500 pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100"
                    aria-label={`Delete ${checklist.checklistName}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
