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

/** A step a manager may name someone on: an approval or calibration not yet
 * done. The server refuses any other, so this only decides what is offered. */
function assignable(step: EvaluationStep): boolean {
  return (
    (step.type === 'approval' || step.type === 'calibration') && (step.status === 'pending' || step.status === 'open')
  );
}

interface StepListProps {
  steps: EvaluationStep[];
  /** Given to a holder of evaluations.manage: opens the assign dialog. */
  onAssign?: ((step: EvaluationStep) => void) | undefined;
}

export const StepList: React.FC<StepListProps> = ({ steps, onAssign }) => (
  <section aria-labelledby="steps-heading" className="card p-4 sm:p-6">
    <h2 id="steps-heading" className="text-theme-text-primary text-lg font-semibold">
      Steps
    </h2>
    <ol className="mt-3 space-y-2">
      {steps.map((step) => {
        const status = STATUS[step.status];
        return (
          <li key={step.key} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="text-theme-text-primary block text-sm font-medium">{step.label}</span>
              {step.assignee && (
                <span className="text-theme-text-secondary block text-xs">Assigned to {step.assignee.name}</span>
              )}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              {step.due_date && step.status !== 'completed' && (
                <span className="text-theme-text-secondary text-xs">Due {formatCalendarDate(step.due_date)}</span>
              )}
              <span className={`badge ${status.className}`}>{status.label}</span>
              {onAssign && assignable(step) && (
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  aria-label={`${step.assignee ? 'Change who takes' : 'Assign'} ${step.label}`}
                  onClick={() => onAssign(step)}
                >
                  {step.assignee ? 'Change' : 'Assign'}
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  </section>
);
