import React, { useState, useEffect } from 'react';
import { useDialog } from '../../../hooks/useDialog';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { FormField } from '../../../components/ux/FormField';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
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

/** ShiftPatternCreate / Update are snake_case and set no max_length on any of these. */
const PATTERN_FIELDS: Record<PatternField, ServerFieldSpec> = {
  name: { label: 'Name' },
  description: { label: 'Description' },
  pattern_type: { label: 'Pattern type' },
  template_id: { label: 'Shift template' },
  rotation_days: { label: 'Rotation days' },
  days_on: { label: 'Days on' },
  days_off: { label: 'Days off' },
  start_date: { label: 'Start date' },
  end_date: { label: 'End date' },
};

/** In the order they appear, so the first failing one takes focus. */
const PATTERN_FIELD_IDS: Record<PatternField, string> = {
  name: 'pattern-name',
  description: 'pattern-description',
  pattern_type: 'pattern-type',
  template_id: 'pattern-template',
  rotation_days: 'pattern-rotation',
  days_on: 'pattern-days-on',
  days_off: 'pattern-days-off',
  start_date: 'pattern-start-date',
  end_date: 'pattern-end-date',
};

interface PatternFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
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
  const [errors, setErrors] = useState<Partial<Record<PatternField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setFormData(initialData || emptyPatternForm);
    setErrors({});
    setFormError(null);
  }, [initialData, isOpen]);

  const update = <K extends PatternField>(field: K, value: PatternFormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  // Anything changed from what the dialog opened with is unsaved work, so
  // Escape, the X and Cancel ask first (forms review F-6).
  const isDirty = JSON.stringify(formData) !== JSON.stringify(initialData || emptyPatternForm);
  const requestClose = useDiscardGuard({ isDirty, onClose });
  const dialogRef = useDialog<HTMLDivElement>({ isOpen: isOpen, onClose: requestClose });

  const showErrors = (next: Partial<Record<PatternField, string>>) => {
    setErrors(next);
    const first = (Object.keys(PATTERN_FIELD_IDS) as PatternField[]).find((field) => next[field]);
    if (first) window.setTimeout(() => document.getElementById(PATTERN_FIELD_IDS[first])?.focus(), 0);
  };

  // A stored weekly/custom pattern keeps its own type on screen, so an edit
  // here cannot silently change it; it still cannot be switched to one.
  const patternTypeChoices = PATTERN_TYPES.filter(
    (pt) => !CONFIG_DRIVEN_TYPES.has(pt.value) || pt.value === initialData?.pattern_type
  );

  const selectedTemplate = templates.find((t) => t.id === formData.template_id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Checked here rather than by the browser, so the reason is shown on the
    // field (forms review F-3). Nothing is written until these are fixed —
    // on an edit too, because the page closes the dialog on any successful
    // update and a flag on a closed dialog would be lost.
    const missing: Partial<Record<PatternField, string>> = {};
    if (!formData.name.trim()) missing.name = 'Give the pattern a name.';
    if (!formData.start_date) missing.start_date = 'Choose the date the pattern starts.';
    if (Object.keys(missing).length > 0) {
      showErrors(missing);
      return;
    }
    setFormError(null);
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
      await onSubmit(payload);
      onClose();
    } catch (err) {
      // A refused field is shown on that field, in its own words (forms review F-2).
      const mapped = mapServerFieldErrors(err, PATTERN_FIELDS);
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
        showErrors(mapped.fieldErrors);
        setFormError(mapped.unmatched.length ? mapped.unmatched.join(' ') : null);
      } else {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Failed to save pattern'));
      }
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
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          noValidate
          className="space-y-4 p-6"
        >
          {formError && (
            <p role="alert" className="alert-danger text-theme-text-primary text-sm">
              {formError}
            </p>
          )}
          <FormField label="Name" required error={errors.name} id="pattern-name">
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

          <FormField label="Description" error={errors.description} id="pattern-description">
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
            label="Pattern Type"
            required
            error={errors.pattern_type}
            id="pattern-type"
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
            <FormField label="Shift Template" error={errors.template_id} id="pattern-template">
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

          {(formData.pattern_type === 'platoon' || formData.pattern_type === 'custom') && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="Rotation Days" error={errors.rotation_days} id="pattern-rotation">
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    inputMode="numeric"
                    value={formData.rotation_days}
                    onChange={(e) => update('rotation_days', e.target.value)}
                    className="form-input"
                    min="1"
                    placeholder="e.g., 3"
                  />
                )}
              </FormField>
              <FormField label="Days On" error={errors.days_on} id="pattern-days-on">
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    inputMode="numeric"
                    value={formData.days_on}
                    onChange={(e) => update('days_on', e.target.value)}
                    className="form-input"
                    min="1"
                    placeholder="e.g., 1"
                  />
                )}
              </FormField>
              <FormField label="Days Off" error={errors.days_off} id="pattern-days-off">
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    inputMode="numeric"
                    value={formData.days_off}
                    onChange={(e) => update('days_off', e.target.value)}
                    className="form-input"
                    min="1"
                    placeholder="e.g., 2"
                  />
                )}
              </FormField>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Start Date" required error={errors.start_date} id="pattern-start-date">
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
            <FormField label="End Date" error={errors.end_date} id="pattern-end-date">
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
