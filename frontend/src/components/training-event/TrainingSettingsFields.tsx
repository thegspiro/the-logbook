/**
 * How a training session's records are created and signed off: whether its
 * hours advance certificate requirements, whether check-in starts a record,
 * and whether records wait for the instructor's sign-off. Shown with the rest
 * of the session's fields on the Training Info step, so they share its locks.
 */

import React, { useId } from 'react';
import { FormField } from '../ux/FormField';
import type { TrainingDetailsForm, TrainingField } from './trainingDetailsModel';
import { TRAINING_FIELDS } from './trainingDetailsModel';

interface CheckRowProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
  disabled?: boolean | undefined;
}

/** A tick box named by its title alone, with the explanation as its description. */
const CheckRow: React.FC<CheckRowProps> = ({ id, checked, onChange, title, description, disabled }) => {
  const descriptionId = useId();
  return (
    <div>
      <label htmlFor={id} className="mobile-touch-target flex cursor-pointer items-center justify-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={descriptionId}
          className="form-checkbox shrink-0"
        />
        <span className="text-theme-text-primary text-sm font-semibold">{title}</span>
      </label>
      <p id={descriptionId} className="text-theme-text-muted pl-7 text-sm">
        {description}
      </p>
    </div>
  );
};

interface TrainingSettingsFieldsProps {
  value: TrainingDetailsForm;
  onChange: (patch: Partial<TrainingDetailsForm>) => void;
  errors: Partial<Record<TrainingField, string>>;
  disabled?: boolean | undefined;
}

export const TrainingSettingsFields: React.FC<TrainingSettingsFieldsProps> = ({
  value,
  onChange,
  errors,
  disabled,
}) => (
  <div className="space-y-4">
    <CheckRow
      id="training-counts-toward-certification"
      checked={value.counts_toward_certification}
      onChange={(checked) => onChange({ counts_toward_certification: checked })}
      disabled={disabled}
      title="Counts toward certification requirements"
      description="When on, attendance advances any linked certificate/pipeline requirements (NFPA, NREMT, recruit school). Turn it off for sessions that give members credit but aren't delivered in a way a certifying body would accept — members still get the training record and hours, but the hours won't count toward their certificate."
    />
    <CheckRow
      id="training-auto-create-records"
      checked={value.auto_create_records}
      onChange={(checked) => onChange({ auto_create_records: checked })}
      disabled={disabled}
      title="Start an in-progress training record when members check in"
      description="Records are completed when attendance is finalized either way."
    />
    <CheckRow
      id="training-require-sign-off"
      checked={value.require_completion_confirmation}
      onChange={(checked) => onChange({ require_completion_confirmation: checked })}
      disabled={disabled}
      title="Require sign-off"
      description="Records stay pending until the instructor or a training officer approves them."
    />
    {value.require_completion_confirmation && (
      <div className="border-l-2 border-red-500/30 pl-4 md:w-1/2">
        <FormField
          id={TRAINING_FIELDS.approval_deadline_days.id}
          label="Approval deadline (days)"
          error={errors.approval_deadline_days}
          hint="Days the instructor or a training officer has to approve completions once attendance is finalized."
        >
          {(field) => (
            <input
              {...field}
              type="number"
              inputMode="numeric"
              min="1"
              max="30"
              value={value.approval_deadline_days}
              disabled={disabled}
              onChange={(e) => onChange({ approval_deadline_days: e.target.value })}
              className="form-input py-3"
            />
          )}
        </FormField>
      </div>
    )}
  </div>
);
