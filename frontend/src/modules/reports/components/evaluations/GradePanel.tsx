/**
 * One calculated grade — a section's or the overall — and the evaluator's
 * choice to give a different one, with the reason.
 *
 * The score and the calculated grade are the server's; this only shows them
 * and records what the evaluator chose. Choosing the calculated grade again
 * clears the change, so "Use the calculated grade" and picking the same level
 * mean the same thing and never ask for a reason.
 */
import React from 'react';
import type { GradeResult, ScaleLevel } from '../../types/evaluations';
import { describeCalculatedGrade } from '../../utils/evaluationRecord';

interface GradePanelProps {
  id: string;
  /** "Section grade" or "Overall grade". */
  title: string;
  result: GradeResult | undefined;
  levels: ScaleLevel[];
  /** The evaluator's grade, if they gave one, and its reason as typed. */
  overrideLevel: number | null;
  reason: string;
  readOnly: boolean;
  onChange?: ((level: number | null, reason: string) => void) | undefined;
}

export const GradePanel: React.FC<GradePanelProps> = ({
  id,
  title,
  result,
  levels,
  overrideLevel,
  reason,
  readOnly,
  onChange,
}) => {
  const calculated = result?.calculated_level ?? null;
  const changed = overrideLevel !== null && overrideLevel !== calculated;
  const labelOf = (level: number | null) => levels.find((l) => l.value === level)?.label ?? '';

  return (
    <div className="bg-theme-surface-secondary mt-4 rounded-lg p-3">
      <p className="text-theme-text-primary text-sm">
        <span className="font-semibold">{title}:</span> {describeCalculatedGrade(result)}
      </p>
      {readOnly ? (
        result?.override_level != null && (
          <>
            <p className="text-theme-text-primary mt-1 text-sm">
              <span className="font-semibold">Evaluator&apos;s grade:</span> {result.override_label}
            </p>
            {result.reason && (
              <p className="text-theme-text-secondary mt-1 text-sm whitespace-pre-wrap">Why: {result.reason}</p>
            )}
          </>
        )
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-grade`} className="form-label">
              Your grade
            </label>
            <select
              id={`${id}-grade`}
              className="form-input"
              value={changed ? String(overrideLevel) : ''}
              onChange={(e) => {
                const level = e.target.value ? Number(e.target.value) : null;
                onChange?.(level === calculated ? null : level, reason);
              }}
            >
              <option value="">Use the calculated grade</option>
              {levels.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </select>
          </div>
          {changed && (
            <div className="sm:col-span-2">
              <label htmlFor={`${id}-reason`} className="form-label">
                Why is this {labelOf(overrideLevel)} rather than {labelOf(calculated) || 'ungraded'}? (required)
              </label>
              <textarea
                id={`${id}-reason`}
                className="form-input min-h-20"
                value={reason}
                onChange={(e) => onChange?.(overrideLevel, e.target.value)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GradePanel;
