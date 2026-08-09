import React from 'react';
import { MessageSquare } from 'lucide-react';
import { StarRating } from './StarRating';
import { SKILL_SCORE_LABELS } from '../constants/shiftReportConstants';
import type { ShiftCompletionReport } from '../../../types/training';

interface ReportContentDisplayProps {
  report: ShiftCompletionReport;
}

export const ReportContentDisplay: React.FC<ReportContentDisplayProps> = ({ report }) => {
  return (
    <div className="space-y-3">
      {report.performance_rating != null && report.performance_rating > 0 && (
        <div>
          <p className="text-theme-text-secondary mb-1 text-xs font-semibold tracking-wider uppercase">
            Performance Rating
          </p>
          <StarRating value={report.performance_rating} size="sm" />
        </div>
      )}

      {report.call_types && report.call_types.length > 0 && (
        <div>
          <p className="text-theme-text-secondary mb-2 text-xs font-semibold tracking-wider uppercase">Call Types</p>
          <div className="flex flex-wrap gap-1.5">
            {report.call_types.map((type) => (
              <span
                key={type}
                className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-400"
              >
                {type}
              </span>
            ))}
          </div>
        </div>
      )}

      {(report.areas_of_strength || report.areas_for_improvement) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {report.areas_of_strength && (
            <div>
              <p className="text-theme-text-secondary mb-1 text-xs font-semibold tracking-wider uppercase">Strengths</p>
              <p className="text-theme-text-primary text-sm whitespace-pre-wrap">{report.areas_of_strength}</p>
            </div>
          )}
          {report.areas_for_improvement && (
            <div>
              <p className="text-theme-text-secondary mb-1 text-xs font-semibold tracking-wider uppercase">
                Areas for Improvement
              </p>
              <p className="text-theme-text-primary text-sm whitespace-pre-wrap">{report.areas_for_improvement}</p>
            </div>
          )}
        </div>
      )}

      {report.officer_narrative && (
        <div>
          <p className="text-theme-text-secondary mb-1 text-xs font-semibold tracking-wider uppercase">
            Officer Narrative
          </p>
          <p className="text-theme-text-primary text-sm whitespace-pre-wrap">{report.officer_narrative}</p>
        </div>
      )}

      {report.skills_observed && report.skills_observed.length > 0 && (
        <div>
          <p className="text-theme-text-secondary mb-2 text-xs font-semibold tracking-wider uppercase">
            Skills Observed
          </p>
          <div className="space-y-1.5">
            {report.skills_observed.map((skill, i) => (
              <div key={i}>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block rounded-full border px-2 py-0.5 text-xs ${
                      skill.demonstrated
                        ? 'border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400'
                        : 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border'
                    }`}
                  >
                    {skill.demonstrated ? '\u2713' : '\u25CB'} {skill.skill_name}
                  </span>
                  {skill.score != null && (
                    <span className="text-xs font-medium text-violet-600 dark:text-violet-400">
                      {skill.score}/5 — {SKILL_SCORE_LABELS[skill.score] ?? ''}
                    </span>
                  )}
                </div>
                {skill.comment && (
                  <p className="text-theme-text-muted mt-0.5 ml-2 flex items-start gap-1 text-xs italic">
                    <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" />
                    {skill.comment}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {report.tasks_performed && report.tasks_performed.length > 0 && (
        <div>
          <p className="text-theme-text-secondary mb-2 text-xs font-semibold tracking-wider uppercase">
            Tasks Performed
          </p>
          <ul className="space-y-1.5">
            {report.tasks_performed.map((task, i) => (
              <li key={i} className="text-theme-text-primary text-sm">
                <span className="font-medium">{task.task}</span>
                {task.description && <span className="text-theme-text-muted"> — {task.description}</span>}
                {task.comment && (
                  <p className="text-theme-text-muted mt-0.5 ml-2 flex items-start gap-1 text-xs italic">
                    <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" />
                    {task.comment}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.trainee_comments && (
        <div className="bg-theme-surface-hover rounded-lg p-3">
          <p className="text-theme-text-secondary mb-1 text-xs font-semibold tracking-wider uppercase">
            Trainee Comments
          </p>
          <p className="text-theme-text-primary text-sm">{report.trainee_comments}</p>
        </div>
      )}
    </div>
  );
};
