/**
 * Where the applicant's Interview Requirement stage stands: interviews
 * recorded against it, and which required interviewer positions have
 * interviewed.
 *
 * Reported by the server, which grades the stage the same way when it is
 * completed (CLAUDE.md #29): a position reads as done here exactly when the
 * stage would accept it. Renders nothing when the applicant is not on such a
 * stage, or the figures cannot be read — this is a summary beside the
 * interviews, and the stage's own refusal still names what is missing.
 */

import React, { useEffect, useState } from 'react';
import { CheckCircle, Clock } from 'lucide-react';
import { applicantService } from '../services/api';
import type { InterviewRequirementProgress } from '../types';

interface InterviewRequirementPanelProps {
  applicantId: string;
  /** Changed by the caller whenever an interview is added, edited or removed. */
  refreshKey?: number | undefined;
  /** The dialog draws its sections edge to edge; the Interview page uses cards. */
  variant?: 'card' | 'section' | undefined;
}

export const InterviewRequirementPanel: React.FC<InterviewRequirementPanelProps> = ({
  applicantId,
  refreshKey = 0,
  variant = 'card',
}) => {
  const [progress, setProgress] = useState<InterviewRequirementProgress | null>(null);

  useEffect(() => {
    let cancelled = false;
    applicantService
      .getInterviewRequirement(applicantId)
      .then((result) => {
        if (!cancelled) setProgress(result);
      })
      .catch(() => {
        if (!cancelled) setProgress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [applicantId, refreshKey]);

  if (!progress) return null;

  const countMet = progress.recorded_count >= progress.required_count;
  const wrapper = variant === 'card' ? 'card p-4' : 'border-theme-surface-border border-b p-4';

  return (
    <section className={wrapper} aria-label="Interview requirement">
      <h3 className="text-theme-text-muted mb-3 text-xs font-medium tracking-wider uppercase">Interview Requirement</h3>
      <ul className="space-y-2 text-xs">
        <li className="flex items-center justify-between gap-2">
          <span className="text-theme-text-secondary">
            {progress.recorded_count} of {progress.required_count} interview
            {progress.required_count === 1 ? '' : 's'} recorded
          </span>
          <Status met={countMet} />
        </li>
        {progress.positions.map((position) => (
          <li key={position.position} className="flex items-center justify-between gap-2">
            <span className="text-theme-text-secondary">Interview by {position.label}</span>
            <Status met={position.satisfied} />
          </li>
        ))}
        {progress.recommendation_met !== null && (
          <li className="flex items-center justify-between gap-2">
            <span className="text-theme-text-secondary">A required recommendation</span>
            <Status met={progress.recommendation_met} />
          </li>
        )}
      </ul>
      <p className="mt-3 text-xs font-medium" role="status">
        {progress.complete ? (
          <span className="text-emerald-700 dark:text-emerald-400">Requirement met</span>
        ) : (
          <span className="text-theme-text-muted">In progress</span>
        )}
      </p>
    </section>
  );
};

const Status: React.FC<{ met: boolean }> = ({ met }) =>
  met ? (
    <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
      <CheckCircle className="h-3 w-3" aria-hidden="true" />
      Done
    </span>
  ) : (
    <span className="text-theme-text-muted flex items-center gap-1">
      <Clock className="h-3 w-3" aria-hidden="true" />
      Missing
    </span>
  );
