import React from 'react';
import { CheckCircle2, CircleDashed, CornerUpLeft, Lock } from 'lucide-react';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';
import { CLEARANCE_STATUS_LABELS, type ClearanceRequest } from '../types';

/** Where a request stands, step by step. */
export const ClearanceSteps: React.FC<{ request: ClearanceRequest }> = ({ request }) => {
  const tz = useTimezone();
  return (
    <div>
      <p className="text-theme-text-primary mb-2 text-sm font-medium">
        {CLEARANCE_STATUS_LABELS[request.status]}
        {request.purpose === 'review' ? ' (internal review)' : ''}
        {request.submitted_by_name ? ` · submitted by ${request.submitted_by_name}` : ''}
      </p>
      <ol className="space-y-2">
        {request.steps.map((step) => {
          const current = request.status === 'pending' && step.index === request.current_step_index;
          return (
            <li key={step.index} className="flex items-start gap-2 text-sm">
              {step.decision === 'cleared' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-800 dark:text-white" aria-hidden="true" />
              ) : step.decision === 'returned' ? (
                <CornerUpLeft className="mt-0.5 h-4 w-4 shrink-0 text-amber-800 dark:text-white" aria-hidden="true" />
              ) : step.blocked ? (
                <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <CircleDashed className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <div>
                <span className={`text-theme-text-primary ${current ? 'font-semibold' : ''}`}>
                  {step.name}
                  {step.position_name ? ` — ${step.position_name}` : ''}
                </span>
                {step.blocked && !step.decision && (
                  <p className="text-theme-text-secondary">
                    This step&rsquo;s position no longer exists. Update the clearance list and submit again.
                  </p>
                )}
                {step.decision && (
                  <p className="text-theme-text-secondary">
                    {step.decision === 'cleared' ? 'Cleared' : 'Returned'}
                    {step.decided_by_name ? ` by ${step.decided_by_name}` : ''}
                    {step.decided_by_author ? ' (the author)' : ''}
                    {step.decided_at ? `, ${formatDateTime(step.decided_at, tz)}` : ''}
                    {step.note ? ` — ${step.note}` : ''}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
};
