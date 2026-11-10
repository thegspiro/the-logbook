import React, { useState, useEffect } from 'react';
import { useDialog } from '../../../hooks/useDialog';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { placeApiError, useFieldErrors, type FieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
import { FormField, FIELD_ERROR_CLASS } from '../../../components/ux/FormField';
import { formatTimeOfDay } from '../../../utils/dateFormatting';
import { formCoercions } from '../../../utils/formValues';
import { X } from 'lucide-react';
import { Link } from 'react-router';
import type { PatternFormData, ShiftTemplate } from './shiftTemplateTypes';
import { PATTERN_TYPES, emptyPatternForm } from './shiftTemplateTypes';
import PatternTemplateInactiveNotice from './PatternTemplateInactiveNotice';

// Weekly and custom patterns are generated from schedule_config (weekdays, or
// a list of dates), which this form has no fields for: saved from here they
// generate no shifts at all. The Patterns tab builds that config.
const CONFIG_DRIVEN_TYPES = new Set(['weekly', 'custom']);

type PatternField =
  | 'name'
  | 'description'
  | 'pattern_type'
  | 'template_id'
  | 'rotation_days'
  | 'days_on'
  | 'days_off'
  | 'start_date'
  | 'end_date';

const PATTERN_FIELDS: FieldSpecs<PatternField> = {
  name: { id: 'pattern-name', label: 'Name' },
  description: { id: 'pattern-description', label: 'Description' },
  pattern_type: { id: 'pattern-type', label: 'Pattern type' },
  template_id: { id: 'pattern-template', label: 'Shift template' },
  rotation_days: { id: 'pattern-rotation', label: 'Rotation days' },
  days_on: { id: 'pattern-days-on', label: 'Days on' },
  days_off: { id: 'pattern-days-off', label: 'Days off' },
  start_date: { id: 'pattern-start-date', label: 'Start date' },
  end_date: { id: 'pattern-end-date', label: 'End date' },
};

const WHOLE_DAYS_MESSAGE = 'Enter a whole number of 1 or more.';

/** What stops a save, checked before anything is sent (forms review F-3). */
function checkPattern(form: PatternFormData, showsRotation: boolean): FieldErrors<PatternField> {
  const errors: FieldErrors<PatternField> = {};
  if (!form.name.trim()) errors.name = 'Enter a name for the pattern.';
  if (!form.start_date) errors.start_date = 'Choose the date the pattern starts.';
  // ISO dates compare correctly as strings.
  if (form.start_date && form.end_date && form.end_date < form.start_date) {
    errors.end_date = 'The end date must be on or after the start date.';
  }
  if (showsRotation) {
    for (const key of ['rotation_days', 'days_on', 'days_off'] as const) {
      const raw = form[key];
      if (raw !== '' && !(Number.isInteger(Number(raw)) && Number(raw) >= 1)) errors[key] = WHOLE_DAYS_MESSAGE;
    }
  }
  return errors;
}

interface PatternFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * `keepOpen` marks a save that left a refused field out (edit only): the
   * caller saves what it was given and leaves the dialog open.
   */
  onSubmit: (data: Record<string, unknown>, options?: { keepOpen?: boolean }) => Promise<void>;
  initialData?: PatternFormData | undefined;
  title: string;
  templates: ShiftTemplate[];
}

const PatternFormModal: React.FC<PatternFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  title,
  templates,
}) => {
  const [formData, setFormData] = useState<PatternFormData>(initialData || emptyPatternForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fieldErrors = useFieldErrors(PATTERN_FIELDS);
  const clearErrors = fieldErrors.clear;
  const setFieldError = fieldErrors.setError;

  useEffect(() => {
    setFormData(initialData || emptyPatternForm);
    clearErrors();
  }, [initialData, isOpen, clearErrors]);

  /** Set one field, and drop the error it carried: editing it is the answer. */
  const update = <K extends keyof PatternFormData & PatternField>(key: K, value: PatternFormData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setFieldError(key, null);
  };

  // Anything changed from what the dialog opened with is unsaved work, so
  // Escape, the X and Cancel ask first (forms review F-6).
  const isDirty = JSON.stringify(formData) !== JSON.stringify(initialData || emptyPatternForm);
  const requestClose = useDiscardGuard({ isDirty, onClose });
  const dialogRef = useDialog<HTMLDivElement>({ isOpen: isOpen, onClose: requestClose });

  const showsRotation = formData.pattern_type === 'platoon' || formData.pattern_type === 'custom';

  // A stored weekly/custom pattern keeps its own type on screen, so an edit
  // here cannot silently change it; it still cannot be switched to one.
  const patternTypeChoices = PATTERN_TYPES.filter(
    (pt) => !CONFIG_DRIVEN_TYPES.has(pt.value) || pt.value === initialData?.pattern_type
  );

  const selectedTemplate = templates.find((t) => t.id === formData.template_id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problems = checkPattern(formData, showsRotation);
    fieldErrors.setFormError(null);
    if (Object.keys(problems).length > 0) {
      fieldErrors.setErrors(problems);
      fieldErrors.focusFirst(problems);
      return;
    }
    fieldErrors.setErrors({});
    setIsSubmitting(true);
    try {
      // The edit modal is the one handed a pattern to start from. On edit a
      // blank field is sent as null, because the update endpoint reads the
      // payload with exclude_unset and an omitted key keeps the stored value —
      // "No template" or an emptied end date would otherwise snap back
      // (CLAUDE.md pitfall #1). Generation falls back to 1 for a null
      // days_on / days_off, so clearing them is safe.
      const { text, pick, num } = formCoercions(initialData !== undefined);
      const payload: Record<string, unknown> = {
        name: formData.name,
        pattern_type: formData.pattern_type,
        start_date: formData.start_date,
        description: text(formData.description),
        template_id: pick(formData.template_id),
        rotation_days: num(formData.rotation_days),
        days_on: num(formData.days_on),
        days_off: num(formData.days_off),
        end_date: pick(formData.end_date),
      };
      try {
        await onSubmit(payload);
      } catch (err) {
        // On edit the rest still saves: resend without the refused fields,
        // which keep their stored values and stay flagged (owner rule,
        // 2026-11-05). A create creates nothing until every field is fixed.
        const placed = placeApiError(PATTERN_FIELDS, err);
        const refused = placed ? (Object.keys(placed.fieldErrors) as PatternField[]) : [];
        if (initialData === undefined || !placed || refused.length === 0 || placed.unmatched.length > 0) throw err;
        const rest = { ...payload };
        for (const field of refused) delete rest[field];
        await onSubmit(rest, { keepOpen: true });
        fieldErrors.setErrors(placed.fieldErrors);
        fieldErrors.focusFirst(placed.fieldErrors);
        return;
      }
      onClose();
    } catch (err) {
      // A refusal lands on the field it names; the dialog stays open with the
      // member's values in it.
      fieldErrors.focusFirst(fieldErrors.setFromApiError(err, 'Could not save the pattern. Try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pattern-modal-title"
    >
      <div ref={dialogRef} className="modal-panel max-h-[90dvh] w-full max-w-lg overflow-y-auto">
        <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
          <h2 id="pattern-modal-title" className="text-theme-text-primary text-xl font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            className="text-theme-text-muted hover:text-theme-text-primary"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form
          noValidate
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4 p-6"
        >
          <FormField id={PATTERN_FIELDS.name.id} label="Name" required error={fieldErrors.errors.name}>
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                value={formData.name}
                onChange={(e) => update('name', e.target.value)}
                className="form-input"
                placeholder="e.g., 24/48 Rotation"
              />
            )}
          </FormField>

          <FormField id={PATTERN_FIELDS.description.id} label="Description" error={fieldErrors.errors.description}>
            {(field) => (
              <textarea
                {...field}
                value={formData.description}
                onChange={(e) => update('description', e.target.value)}
                className="form-input"
                rows={2}
                placeholder="Optional description"
              />
            )}
          </FormField>

          <FormField
            id={PATTERN_FIELDS.pattern_type.id}
            label="Pattern Type"
            required
            error={fieldErrors.errors.pattern_type}
            hint={
              <>
                Weekly and custom patterns pick their days or dates, so create them from the{' '}
                <Link to="/scheduling/admin/planning/patterns" className="underline">
                  Patterns tab
                </Link>
                .
              </>
            }
          >
            {(field) => (
              <select
                {...field}
                value={formData.pattern_type}
                onChange={(e) => update('pattern_type', e.target.value as PatternFormData['pattern_type'])}
                className="form-input"
              >
                {patternTypeChoices.map((pt) => (
                  <option key={pt.value} value={pt.value}>
                    {pt.label} - {pt.description}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <div>
            <FormField id={PATTERN_FIELDS.template_id.id} label="Shift Template" error={fieldErrors.errors.template_id}>
              {(field) => (
                <select
                  {...field}
                  value={formData.template_id}
                  onChange={(e) => update('template_id', e.target.value)}
                  className="form-input"
                >
                  <option value="">No template</option>
                  {/* A deactivated template is kept for the shifts and patterns that
                      use it; it is offered only to a pattern that already names it. */}
                  {templates
                    .filter((t) => t.is_active !== false || t.id === formData.template_id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({formatTimeOfDay(t.start_time_of_day)} - {formatTimeOfDay(t.end_time_of_day)})
                        {t.is_active === false ? ' (inactive)' : ''}
                      </option>
                    ))}
                </select>
              )}
            </FormField>
            {/* The server holds a pattern whose template is inactive; saving
                another template here is how it resumes. */}
            {selectedTemplate?.is_active === false && (
              <div className="mt-2">
                <PatternTemplateInactiveNotice names={[selectedTemplate.name]} />
              </div>
            )}
          </div>

          {showsRotation && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {(
                [
                  ['rotation_days', 'Rotation Days', 'e.g., 3'],
                  ['days_on', 'Days On', 'e.g., 1'],
                  ['days_off', 'Days Off', 'e.g., 2'],
                ] as const
              ).map(([key, label, placeholder]) => (
                <FormField key={key} id={PATTERN_FIELDS[key].id} label={label} error={fieldErrors.errors[key]}>
                  {(field) => (
                    <input
                      {...field}
                      type="number"
                      inputMode="numeric"
                      value={formData[key]}
                      onChange={(e) => update(key, e.target.value)}
                      className="form-input"
                      min="1"
                      placeholder={placeholder}
                    />
                  )}
                </FormField>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              id={PATTERN_FIELDS.start_date.id}
              label="Start Date"
              required
              error={fieldErrors.errors.start_date}
            >
              {(field) => (
                <input
                  {...field}
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => update('start_date', e.target.value)}
                  className="form-input"
                />
              )}
            </FormField>
            <FormField id={PATTERN_FIELDS.end_date.id} label="End Date" error={fieldErrors.errors.end_date}>
              {(field) => (
                <input
                  {...field}
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => update('end_date', e.target.value)}
                  className="form-input"
                />
              )}
            </FormField>
          </div>

          {fieldErrors.formError && (
            <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
              {fieldErrors.formError}
            </p>
          )}

          <div className="border-theme-surface-border flex justify-end gap-3 border-t pt-4">
            <button
              type="button"
              onClick={requestClose}
              className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2"
            >
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="btn-primary px-6">
              {isSubmitting ? 'Saving...' : 'Save Pattern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PatternFormModal;
