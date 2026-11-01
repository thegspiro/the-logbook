/**
 * Targets for the requirement types credited by shift evaluations: evaluated
 * shifts, transports and refusals. Shared by every requirement editor so the
 * three say the same thing about how they are counted.
 */
import React from 'react';

import { isEvaluationRequirementType } from '../../utils/shiftEvaluations';

interface EvaluationRequirementFieldsProps {
  idPrefix: string;
  type: string;
  shifts: string;
  transports: string;
  refusals: string;
  excludesLowest: boolean;
  onShiftsChange: (value: string) => void;
  onTransportsChange: (value: string) => void;
  onRefusalsChange: (value: string) => void;
  onExcludesLowestChange: (value: boolean) => void;
}

const COUNTED_FROM =
  'Counted from submitted shift evaluations for members enrolled in a program that includes this requirement, once the member can see the evaluation.';

export const EvaluationRequirementFields: React.FC<EvaluationRequirementFieldsProps> = ({
  idPrefix,
  type,
  shifts,
  transports,
  refusals,
  excludesLowest,
  onShiftsChange,
  onTransportsChange,
  onRefusalsChange,
  onExcludesLowestChange,
}) => {
  if (!isEvaluationRequirementType(type)) return null;

  const field = {
    evaluated_shifts: {
      id: `${idPrefix}-required-evaluated-shifts`,
      label: 'Required evaluated shifts',
      value: shifts,
      onChange: onShiftsChange,
      placeholder: 'e.g., 10',
    },
    transports: {
      id: `${idPrefix}-required-transports`,
      label: 'Required transports',
      value: transports,
      onChange: onTransportsChange,
      placeholder: 'e.g., 20',
    },
    refusals: {
      id: `${idPrefix}-required-refusals`,
      label: 'Required refusals',
      value: refusals,
      onChange: onRefusalsChange,
      placeholder: 'e.g., 5',
    },
  }[type];
  const hintId = `${field.id}-hint`;

  return (
    <div className="space-y-3">
      <div>
        <label className="form-label" htmlFor={field.id}>
          {field.label}{' '}
          <span aria-hidden="true" className="text-red-700 dark:text-red-400">
            *
          </span>
        </label>
        <input
          id={field.id}
          type="number"
          min={1}
          className="form-input"
          value={field.value}
          onChange={(e) => field.onChange(e.target.value)}
          placeholder={field.placeholder}
          aria-required="true"
          aria-describedby={hintId}
        />
        <p id={hintId} className="text-theme-text-muted mt-1 text-xs">
          {COUNTED_FROM}
        </p>
      </div>
      {type === 'evaluated_shifts' && (
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="form-checkbox mt-0.5"
            checked={excludesLowest}
            onChange={(e) => onExcludesLowestChange(e.target.checked)}
          />
          <span className="text-theme-text-secondary text-sm">
            Only count evaluations with no item at the lowest rating
            <span className="text-theme-text-muted block text-xs">
              A shift where any item was rated at the bottom of the form&apos;s scale does not count toward the total.
            </span>
          </span>
        </label>
      )}
    </div>
  );
};

export default EvaluationRequirementFields;
