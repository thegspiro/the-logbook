/**
 * One line on the Shift Completion Report saying where a member's shift
 * evaluation stands, with the way into it.
 *
 * The evaluation itself is a separate page (ShiftEvaluationPage), so two
 * trainees do not stack two long forms into the report.
 */

import React from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import type { ShiftEvaluationRequirement } from '../../types/training';
import { shiftEvaluationPagePath } from '../../utils/shiftEvaluations';

interface Props {
  shiftId: string;
  requirement: ShiftEvaluationRequirement;
}

export const ShiftEvaluationStatusLine: React.FC<Props> = ({ shiftId, requirement }) => {
  const evaluation = requirement.evaluation;
  const submitted = evaluation?.status === 'submitted';
  const formName =
    requirement.template_options.length === 1
      ? (requirement.template_options[0]?.name ?? 'Shift evaluation')
      : 'Shift evaluation';

  let badge: { text: string; className: string };
  if (submitted) {
    badge = { text: 'Submitted', className: 'bg-theme-alert-success-bg text-theme-alert-success-text' };
  } else if (evaluation) {
    badge = { text: 'In progress', className: 'bg-theme-alert-warning-bg text-theme-alert-warning-text' };
  } else if (requirement.required) {
    badge = { text: 'Not started', className: 'bg-theme-alert-danger-bg text-theme-alert-danger-text' };
  } else {
    badge = { text: 'Optional', className: 'bg-theme-surface-secondary text-theme-text-secondary' };
  }

  let detail = '';
  if (submitted && evaluation) {
    const parts: string[] = [];
    if (evaluation.average_rating != null) parts.push(`Average ${evaluation.average_rating.toFixed(1)}`);
    if (evaluation.low_rating_count > 0) {
      parts.push(`${evaluation.low_rating_count} low rating${evaluation.low_rating_count === 1 ? '' : 's'}`);
    }
    detail = parts.join(' · ');
  } else if (evaluation) {
    detail = `${evaluation.rated_count} rated so far`;
  } else if (requirement.required) {
    detail = 'Required before close-out';
  }

  const action = submitted ? 'View / edit' : evaluation ? 'Continue evaluation' : 'Start evaluation';

  return (
    <div className="bg-theme-surface border-theme-surface-border flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
      <span className="text-theme-text-primary text-sm font-semibold">{formName}</span>
      {requirement.program_names.length > 0 && (
        <span className="text-theme-text-muted text-xs">{requirement.program_names.join(', ')}</span>
      )}
      <span className={`badge ${badge.className}`}>{badge.text}</span>
      {detail && <span className="text-theme-text-muted text-xs">{detail}</span>}
      <span className="flex-1" />
      <Link
        to={shiftEvaluationPagePath(shiftId, requirement.member_id, requirement.scope_key)}
        className={`${submitted ? 'btn-secondary' : 'btn-primary'} inline-flex items-center gap-1 text-sm`}
        aria-label={`${action} for ${requirement.member_name}`}
      >
        {action}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
};

export default ShiftEvaluationStatusLine;
