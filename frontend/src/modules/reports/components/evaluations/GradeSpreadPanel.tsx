/**
 * How each evaluator's finalized reviews in a period fall across the five
 * grades, beside the department's, so a chief can see an evaluator who rates
 * everyone the same before results are final. It shows the spread and leaves
 * the reading to them (owner decision 2026-11-22). The server counts it from
 * the rows and grades the list above shows.
 */
import React, { useEffect, useState } from 'react';
import { getErrorMessage } from '../../../../utils/errorHandling';
import { evaluationsService } from '../../services/evaluationsApi';
import type { GradeSpread, GradeTally } from '../../types/evaluations';

interface GradeSpreadPanelProps {
  periodId: string;
}

const Counts: React.FC<{ levels: string[]; tally: GradeTally }> = ({ levels, tally }) => (
  <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
    {levels.map((label, index) => (
      <div key={label} className="flex gap-1">
        <dt className="text-theme-text-secondary">{label}</dt>
        <dd className="text-theme-text-primary font-semibold">{tally.counts[index] ?? 0}</dd>
      </div>
    ))}
    {tally.other > 0 && (
      <div className="flex gap-1">
        <dt className="text-theme-text-secondary">Not on the five grades</dt>
        <dd className="text-theme-text-primary font-semibold">{tally.other}</dd>
      </div>
    )}
  </dl>
);

export const GradeSpreadPanel: React.FC<GradeSpreadPanelProps> = ({ periodId }) => {
  const [spread, setSpread] = useState<GradeSpread | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setSpread(null);
    setError(null);
    evaluationsService
      .gradeSpread(periodId)
      .then((loaded) => {
        if (current) setSpread(loaded);
      })
      .catch((err: unknown) => {
        if (current) setError(getErrorMessage(err, 'The grades by evaluator could not be loaded.'));
      });
    return () => {
      current = false;
    };
  }, [periodId]);

  if (error) {
    return (
      <p className="text-theme-alert-danger-text mt-3 text-sm" role="alert">
        {error}
      </p>
    );
  }
  if (!spread || spread.department.total === 0) return null;

  return (
    <div className="mt-4">
      <h3 className="text-theme-text-primary text-sm font-semibold">Grades by evaluator</h3>
      <ul className="divide-theme-surface-border mt-1 divide-y text-sm">
        <li className="py-2">
          <p className="text-theme-text-primary font-medium">
            Whole department <span className="text-theme-text-secondary font-normal">({spread.department.total})</span>
          </p>
          <Counts levels={spread.levels} tally={spread.department} />
        </li>
        {spread.evaluators.map((evaluator) => (
          <li key={evaluator.evaluator_id ?? 'none'} className="py-2">
            <p className="text-theme-text-primary font-medium">
              {evaluator.name} <span className="text-theme-text-secondary font-normal">({evaluator.total})</span>
            </p>
            <Counts levels={spread.levels} tally={evaluator} />
          </li>
        ))}
      </ul>
    </div>
  );
};
