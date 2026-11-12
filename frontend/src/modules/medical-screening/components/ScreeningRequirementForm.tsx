/**
 * Screening Requirement Form
 *
 * Modal form for creating/editing screening requirements.
 */

import React, { useState } from 'react';
import { useDialog } from '../../../hooks/useDialog';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { X } from 'lucide-react';
import { ScreeningType, SCREENING_TYPE_LABELS } from '../types';
import type {
  ScreeningRequirement,
  ScreeningRequirementCreate,
  ScreeningRequirementUpdate,
  ScreeningSaveOptions,
} from '../types';
import { blankToNull } from '../../../utils/formValues';
import { getErrorMessage } from '../../../utils/errorHandling';
import { FormField } from '../../../components/ux/FormField';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';

interface ScreeningRequirementFormProps {
  requirement: ScreeningRequirement | null;
  /** Rejects with a 422 for the form to put on its fields; reports other failures itself. */
  onSave: (
    data: ScreeningRequirementCreate | ScreeningRequirementUpdate,
    options?: ScreeningSaveOptions
  ) => Promise<void>;
  onClose: () => void;
}

const inputClass = 'form-input';

type RequirementField =
  | 'name'
  | 'screening_type'
  | 'description'
  | 'frequency_months'
  | 'applies_to_roles'
  | 'grace_period_days'
  | 'is_active';

/** The requirement schema is snake_case (no alias generator), so the keys are the API's names. */
const REQUIREMENT_FIELDS: Record<RequirementField, ServerFieldSpec> = {
  name: { label: 'Name', maxLength: 255 },
  screening_type: { label: 'Screening type' },
  description: { label: 'Description' },
  frequency_months: { label: 'Frequency' },
  applies_to_roles: { label: 'Applies to positions' },
  grace_period_days: { label: 'Grace period' },
  is_active: { label: 'Active' },
};

/** In the order they appear, so the first failing one takes focus. */
const REQUIREMENT_FIELD_IDS: Record<RequirementField, string> = {
  name: 'req-name',
  screening_type: 'req-type',
  description: 'req-desc',
  frequency_months: 'req-frequency',
  applies_to_roles: 'req-roles',
  grace_period_days: 'req-grace',
  is_active: 'req-active',
};

export const ScreeningRequirementForm: React.FC<ScreeningRequirementFormProps> = ({ requirement, onSave, onClose }) => {
  const [name, setName] = useState(requirement?.name ?? '');
  const [screeningType, setScreeningType] = useState<string>(
    requirement?.screening_type ?? ScreeningType.PHYSICAL_EXAM
  );
  const [description, setDescription] = useState(requirement?.description ?? '');
  const [frequencyMonths, setFrequencyMonths] = useState<string>(requirement?.frequency_months?.toString() ?? '12');
  // W71b-5 (owner decision 2026-11-06): a new requirement starts recurring,
  // matching the 12 already in the frequency field. Starting it one-time let
  // an annual physical added in a hurry never fall due. An existing
  // requirement opens as it was saved.
  const [isOneTime, setIsOneTime] = useState(requirement ? !requirement.frequency_months : false);
  const [appliesTo, setAppliesTo] = useState(requirement?.applies_to_roles?.join(', ') ?? '');
  const [isActive, setIsActive] = useState(requirement?.is_active ?? true);
  const [gracePeriodDays, setGracePeriodDays] = useState<string>(requirement?.grace_period_days?.toString() ?? '30');
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<RequirementField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [savedExcept, setSavedExcept] = useState(false);
  const clearError = (field: RequirementField) => setErrors((prev) => ({ ...prev, [field]: undefined }));

  // Anything changed from what the dialog opened with is unsaved work, so
  // Escape, the X and Cancel ask first (forms review F-6).
  const snapshot = JSON.stringify([
    name,
    screeningType,
    description,
    frequencyMonths,
    isOneTime,
    appliesTo,
    isActive,
    gracePeriodDays,
  ]);
  const [initialSnapshot] = useState(snapshot);
  const requestClose = useDiscardGuard({ isDirty: snapshot !== initialSnapshot, onClose });
  const dialogRef = useDialog<HTMLDivElement>({ onClose: requestClose });

  const showErrors = (next: Partial<Record<RequirementField, string>>) => {
    setErrors(next);
    const first = (Object.keys(REQUIREMENT_FIELD_IDS) as RequirementField[]).find((field) => next[field]);
    if (first) window.setTimeout(() => document.getElementById(REQUIREMENT_FIELD_IDS[first])?.focus(), 0);
  };

  const validate = (): Partial<Record<RequirementField, string>> => {
    const newErrors: Partial<Record<RequirementField, string>> = {};
    if (!name.trim()) newErrors.name = 'Name is required';
    if (!isOneTime && (!frequencyMonths || Number(frequencyMonths) < 1)) {
      newErrors.frequency_months = 'Frequency must be at least 1 month';
    }
    // The column is NOT NULL, so a blank cannot be saved as "no grace period";
    // it used to be replaced with 30 behind the user's back. Ask instead.
    if (!gracePeriodDays.trim()) {
      newErrors.grace_period_days = 'Grace period is required (enter 0 for none)';
    } else if (!Number.isInteger(Number(gracePeriodDays)) || Number(gracePeriodDays) < 0) {
      newErrors.grace_period_days = 'Grace period must be a whole number of days, 0 or more';
    }
    return newErrors;
  };

  /**
   * Saves under the owner's rule of 2026-11-05. An edit is a single save: a
   * field this form or the server refuses is left out, so its stored value is
   * kept, the rest is written, and the dialog stays open with the field
   * flagged. A create puts each refusal on its field and creates nothing.
   */
  const save = async (
    data: ScreeningRequirementCreate | ScreeningRequirementUpdate,
    refusedHere: Partial<Record<RequirementField, string>>
  ) => {
    setFormError(null);
    setSavedExcept(false);
    let refused = refusedHere;
    let payload: Record<string, unknown> = { ...data };
    const omitRefused = () => {
      payload = { ...payload };
      for (const field of Object.keys(refused)) delete payload[field];
    };
    omitRefused();
    try {
      if (Object.keys(refused).length) await onSave(payload, { keepOpen: true });
      else await onSave(payload);
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, REQUIREMENT_FIELDS);
      if (!mapped) {
        showErrors(refused);
        setFormError(getErrorMessage(err, 'Failed to save requirement'));
        return;
      }
      refused = { ...refused, ...mapped.fieldErrors };
      showErrors(refused);
      setFormError(mapped.unmatched.length ? mapped.unmatched.join(' ') : null);
      if (!requirement || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) return;
      omitRefused();
      try {
        await onSave(payload, { keepOpen: true });
      } catch (retryErr: unknown) {
        setFormError(getErrorMessage(retryErr, 'Failed to save requirement'));
        return;
      }
    }
    if (Object.keys(refused).length) {
      showErrors(refused);
      setSavedExcept(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const refused = validate();
    // A create writes nothing until every field is acceptable.
    if (!requirement && Object.keys(refused).length > 0) {
      showErrors(refused);
      return;
    }
    setErrors({});
    setIsSaving(true);
    const roles = appliesTo
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);

    if (requirement) {
      // Edit path sends an explicit null for a blanked/cleared field. The
      // backend dumps update payloads with exclude_unset, so `undefined`
      // here means "leave this alone" — unchecking "recurring" or clearing
      // the roles list would otherwise silently leave the old value in
      // place behind the "Requirement updated" toast (CLAUDE.md pitfall #1).
      const data: ScreeningRequirementUpdate = {
        name: name.trim(),
        screening_type: screeningType as ScreeningRequirementUpdate['screening_type'],
        description: blankToNull(description),
        frequency_months: isOneTime ? null : Number(frequencyMonths),
        applies_to_roles: roles.length > 0 ? roles : null,
        is_active: isActive,
        grace_period_days: Number(gracePeriodDays),
      };
      await save(data, refused);
    } else {
      const data: ScreeningRequirementCreate = {
        name: name.trim(),
        screening_type: screeningType as ScreeningRequirementCreate['screening_type'],
        description: description.trim() || undefined,
        frequency_months: isOneTime ? undefined : Number(frequencyMonths),
        applies_to_roles: roles.length > 0 ? roles : undefined,
        is_active: isActive,
        grace_period_days: Number(gracePeriodDays),
      };
      await save(data, {});
    }
    setIsSaving(false);
  };

  return (
    <div
      className="modal-overlay z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="screening-requirement-dialog-title"
    >
      <div ref={dialogRef} className="modal-panel modal-body w-full max-w-lg">
        <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
          <h2 id="screening-requirement-dialog-title" className="text-theme-text-primary text-lg font-bold">
            {requirement ? 'Edit Screening Requirement' : 'Add Screening Requirement'}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            className="text-theme-text-muted hover:text-theme-text-primary"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4 p-6">
          {savedExcept && (
            <p role="status" className="alert-warning text-theme-text-primary text-sm">
              Saved, except the field flagged below, which keeps its stored value. Fix it and save again.
            </p>
          )}
          {formError && (
            <p role="alert" className="alert-danger text-theme-text-primary text-sm">
              {formError}
            </p>
          )}
          <FormField
            label="Name"
            required
            error={errors.name}
            id="req-name"
            maxLength={REQUIREMENT_FIELDS.name.maxLength}
            count={name.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearError('name');
                }}
                placeholder="e.g., Annual Physical Exam"
                className={inputClass}
              />
            )}
          </FormField>

          <FormField label="Screening Type" error={errors.screening_type} id="req-type">
            {(field) => (
              <select
                {...field}
                value={screeningType}
                onChange={(e) => {
                  setScreeningType(e.target.value);
                  clearError('screening_type');
                }}
                className={inputClass}
              >
                {Object.entries(SCREENING_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <FormField label="Description" error={errors.description} id="req-desc">
            {(field) => (
              <textarea
                {...field}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  clearError('description');
                }}
                placeholder="Describe the screening requirement..."
                rows={2}
                className={inputClass + ' resize-none'}
              />
            )}
          </FormField>

          <div>
            <label className="text-theme-text-secondary mb-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isOneTime}
                onChange={(e) => {
                  setIsOneTime(e.target.checked);
                  clearError('frequency_months');
                }}
                className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
              />
              One-time requirement (not recurring)
            </label>
            {!isOneTime && (
              // W71-1: grading falls back to this when a record has no expiration
              // date of its own (medical_screening_service._effective_expiration).
              <FormField
                label="Frequency (months)"
                error={errors.frequency_months}
                id="req-frequency"
                className="mt-2"
                hint="Fills in the expiration date when a record for this requirement is added. A record saved without an expiration date falls due this many months after it was completed."
              >
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={frequencyMonths}
                    onChange={(e) => {
                      setFrequencyMonths(e.target.value);
                      clearError('frequency_months');
                    }}
                    className={inputClass + ' w-32'}
                  />
                )}
              </FormField>
            )}
          </div>

          {/* Positions, by name or slug: the backend grades a member on this
              requirement only if they hold one (medical_screening_service,
              _applicable_requirements). The field is still stored as
              `applies_to_roles`; renaming the column would be a breaking API
              and schema change for no gain. */}
          <FormField
            label="Applies to Positions (comma-separated)"
            error={errors.applies_to_roles}
            id="req-roles"
            hint="Leave blank to apply to every member. Otherwise only members who hold one of these positions are screened for it. Applicants in the pipeline hold no positions and are always screened."
          >
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                value={appliesTo}
                onChange={(e) => {
                  setAppliesTo(e.target.value);
                  clearError('applies_to_roles');
                }}
                placeholder="e.g., Firefighter, Apparatus Manager"
                className={inputClass}
              />
            )}
          </FormField>

          {/* Grace Period: read by grading since 2026-11-04 (MS-16, owner
              decision 2026-11-01) — a member stays compliant this many days
              after a screening falls due, shown as past due meanwhile. */}
          <FormField
            label="Grace Period (days past expiration)"
            required
            error={errors.grace_period_days}
            id="req-grace"
            hint="Members stay compliant this many days after a screening falls due, shown as past due. Enter 0 to mark them non-compliant the day after."
          >
            {(field) => (
              <input
                {...field}
                type="number"
                inputMode="numeric"
                min={0}
                value={gracePeriodDays}
                onChange={(e) => {
                  setGracePeriodDays(e.target.value);
                  clearError('grace_period_days');
                }}
                className={inputClass + ' w-32'}
              />
            )}
          </FormField>

          <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <input
              id="req-active"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
            />
            Active
          </label>

          <div className="border-theme-surface-border flex justify-end gap-3 border-t pt-4">
            <button
              type="button"
              onClick={requestClose}
              className="text-theme-text-secondary hover:text-theme-text-primary touch:min-h-11 rounded-lg px-4 py-2 text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="touch:min-h-11 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : requirement ? 'Save Changes' : 'Add Requirement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
