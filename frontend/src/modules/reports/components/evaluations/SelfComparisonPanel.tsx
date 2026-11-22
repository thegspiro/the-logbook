/**
 * The member's self-evaluation beside the evaluator's rating of each rated
 * item, with the items where the two are far apart marked: the points worth
 * raising when the review is discussed. It shows only what the two parts on
 * the page already show this viewer.
 */
import React, { useState } from 'react';
import type { PartContent, TemplateDefinition } from '../../types/evaluations';
import { compareSelfEvaluation, SELF_COMPARISON_GAP } from '../../utils/evaluationRecord';

interface SelfComparisonPanelProps {
  definition: TemplateDefinition;
  self: PartContent;
  evaluator: PartContent;
}

export const SelfComparisonPanel: React.FC<SelfComparisonPanelProps> = ({ definition, self, evaluator }) => {
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const rows = compareSelfEvaluation(definition, self, evaluator);
  if (rows.length === 0) return null;
  const differing = rows.filter((row) => row.differs).length;
  const shown = onlyDifferences ? rows.filter((row) => row.differs) : rows;

  return (
    <section aria-labelledby="self-comparison-heading" className="card p-4 sm:p-6">
      <h2 id="self-comparison-heading" className="text-theme-text-primary text-lg font-semibold">
        Self-evaluation beside the evaluation
      </h2>
      <p className="text-theme-text-secondary mt-1 text-sm">
        {differing === 0
          ? 'No rated item is far apart.'
          : `${differing} ${differing === 1 ? 'item is' : 'items are'} ${SELF_COMPARISON_GAP} or more levels apart, or opposite on meets / does not meet.`}
      </p>
      {differing > 0 && (
        <label className="touch:min-h-11 mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={onlyDifferences}
            onChange={(e) => setOnlyDifferences(e.target.checked)}
          />
          <span className="text-theme-text-secondary">Show only those</span>
        </label>
      )}
      <ul className="divide-theme-surface-border mt-3 divide-y text-sm">
        {shown.map((row) => (
          <li key={row.key} className="py-2">
            <p className="text-theme-text-primary font-medium">
              {row.label}
              {row.differs && (
                <span className="badge ml-2 bg-amber-500/15 align-middle text-amber-900 dark:text-amber-200">
                  Far apart
                </span>
              )}
            </p>
            <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-theme-text-secondary inline">Self: </dt>
                <dd className="text-theme-text-primary inline">{row.self}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-theme-text-secondary inline">Evaluator: </dt>
                <dd className="text-theme-text-primary inline">{row.evaluator}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
};
