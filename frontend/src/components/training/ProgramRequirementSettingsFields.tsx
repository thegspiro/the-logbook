/**
 * The three settings that belong to a requirement's place in one program
 * rather than to the requirement itself — shared by the create-pipeline wizard
 * and the program's requirement edit modal so the two say the same thing.
 */
import React from 'react';
import { MAX_CUSTOM_DEADLINE_DAYS, type ProgramRequirementSettingsForm } from '../../utils/programRequirementSettings';

interface Props {
  idPrefix: string;
  value: ProgramRequirementSettingsForm;
  onChange: (field: keyof ProgramRequirementSettingsForm, value: string) => void;
  /** The wizard's dense cards use the small inputs and labels. */
  compact?: boolean;
}

export const ProgramRequirementSettingsFields: React.FC<Props> = ({ idPrefix, value, onChange, compact = false }) => {
  const labelClass = compact ? 'text-theme-text-muted mb-1 block text-xs font-medium' : 'form-label';
  const inputClass = compact ? 'form-input-sm' : 'form-input';
  return (
    <fieldset className="space-y-3">
      <legend className={labelClass}>In this program</legend>
      <div>
        <label htmlFor={`${idPrefix}-deadline-days`} className={labelClass}>
          Due after enrollment (days)
        </label>
        <input
          id={`${idPrefix}-deadline-days`}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_CUSTOM_DEADLINE_DAYS}
          step={1}
          value={value.custom_deadline_days}
          onChange={(e) => onChange('custom_deadline_days', e.target.value)}
          className={`${inputClass} w-32`}
          placeholder="No due date"
        />
        <p className="text-theme-text-muted mt-1 text-xs">
          Due this many days after each member enrolls. Members are reminded on the program&apos;s reminder schedule and
          told once if it goes overdue. Changing it moves the date for everyone already enrolled.
        </p>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-member-description`} className={labelClass}>
          Description members see
        </label>
        <textarea
          id={`${idPrefix}-member-description`}
          rows={2}
          value={value.program_specific_description}
          onChange={(e) => onChange('program_specific_description', e.target.value)}
          className={inputClass}
          placeholder="Leave blank to show the requirement's own description"
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-completion-message`} className={labelClass}>
          Message when completed
        </label>
        <textarea
          id={`${idPrefix}-completion-message`}
          rows={2}
          value={value.notification_message}
          onChange={(e) => onChange('notification_message', e.target.value)}
          className={inputClass}
          placeholder="e.g., Nice work — bring your card to Station 2 so we can copy it."
        />
        <p className="text-theme-text-muted mt-1 text-xs">Emailed to the member once, when they complete it.</p>
      </div>
    </fieldset>
  );
};
