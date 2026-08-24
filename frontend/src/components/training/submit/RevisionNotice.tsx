import React from 'react';
import { Pencil, RotateCcw } from 'lucide-react';
import { formatCalendarDate } from '../../../utils/dateFormatting';
import { formatHours } from '../../../utils/hoursFormatting';
import type { TrainingSubmission } from '../../../types/training';

export const RevisionNotice: React.FC<{
  submission: TrainingSubmission;
  onFix: () => void;
  onWithdraw: () => void;
}> = ({ submission, onFix, onWithdraw }) => {
  const meta = [
    `${formatHours(submission.hours_completed)}h`,
    formatCalendarDate(submission.completion_date, { month: 'short', day: 'numeric' }),
    submission.issuing_agency,
    submission.certification_number ? `Cert ${submission.certification_number}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="alert-warning animate-page-enter mb-5 flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <RotateCcw className="text-theme-alert-warning-icon mt-0.5 h-[18px] w-[18px] shrink-0" />
        <div className="flex flex-col gap-1">
          <p className="text-theme-alert-warning-title text-sm font-semibold">
            {submission.reviewer_notes ? 'A training officer asked for a change' : 'A training officer sent this back'}
          </p>
          {submission.reviewer_notes && (
            <p className="text-theme-alert-warning-text text-sm">&ldquo;{submission.reviewer_notes}&rdquo;</p>
          )}
          <p className="text-theme-text-muted text-xs">
            {submission.reviewed_at
              ? `Returned ${formatCalendarDate(submission.reviewed_at.slice(0, 10), { month: 'short', day: 'numeric' })} · `
              : ''}
            Your hours are not counted yet
          </p>
        </div>
      </div>

      <div>
        <p className="text-theme-text-primary text-lg font-semibold">{submission.course_name}</p>
        <p className="text-theme-text-muted text-sm">{meta}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onFix}
          className="btn-primary flex flex-1 items-center justify-center gap-2 text-sm"
        >
          <Pencil className="h-4 w-4" /> Fix and Resubmit
        </button>
        <button type="button" onClick={onWithdraw} className="btn-secondary text-sm">
          Withdraw
        </button>
      </div>
    </div>
  );
};
