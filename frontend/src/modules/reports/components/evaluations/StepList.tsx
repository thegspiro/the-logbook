/** The evaluation's workflow steps, in order, with where each one stands. */
import React from 'react';
import { formatCalendarDate } from '../../../../utils/dateFormatting';
import type { EvaluationStep } from '../../types/evaluations';

const STATUS: Record<EvaluationStep['status'], { label: string; className: string }> = {
  pending: { label: 'Not started', className: 'bg-slate-500/15 text-theme-text-secondary' },
  open: { label: 'In progress', className: 'bg-blue-500/15 text-blue-900 dark:text-blue-200' },
  completed: { label: 'Done', className: 'bg-green-500/15 text-green-800 dark:text-green-300' },
  skipped: { label: 'Not submitted', className: 'bg-amber-500/20 text-amber-900 dark:text-amber-300' },
};

export const StepList: React.FC<{ steps: EvaluationStep[] }> = ({ steps }) => (
  <section aria-labelledby="steps-heading" className="card p-4 sm:p-6">
    <h2 id="steps-heading" className="text-theme-text-primary text-lg font-semibold">
      Steps
    </h2>
    <ol className="mt-3 space-y-2">
      {steps.map((step) => {
        const status = STATUS[step.status];
        return (
          <li key={step.key} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-theme-text-primary text-sm font-medium">{step.label}</span>
            <span className="flex items-center gap-2">
              {step.due_date && step.status !== 'completed' && (
                <span className="text-theme-text-secondary text-xs">Due {formatCalendarDate(step.due_date)}</span>
              )}
              <span className={`badge ${status.className}`}>{status.label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  </section>
);
