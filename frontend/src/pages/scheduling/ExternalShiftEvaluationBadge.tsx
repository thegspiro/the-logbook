/**
 * Where a logged outside shift's evaluation stands, beside the shift.
 *
 * Shown only on a shift that calls for one (an agency the department
 * evaluates, and a member in a program with an evaluation form). There is no
 * close-out for an outside shift to hold, so this is how a missing one shows.
 */
import React from 'react';

import type { ExternalShiftEntry } from '../../modules/scheduling/services/api';

const LABELS = {
  needed: { text: 'Evaluation needed', tone: 'bg-theme-alert-warning-bg text-theme-alert-warning-text' },
  draft: { text: 'Evaluation started', tone: 'bg-theme-alert-warning-bg text-theme-alert-warning-text' },
  submitted: { text: 'Evaluated', tone: 'bg-theme-alert-success-bg text-theme-alert-success-text' },
} as const;

interface ExternalShiftEvaluationBadgeProps {
  status: ExternalShiftEntry['evaluation_status'];
  className?: string;
}

export const ExternalShiftEvaluationBadge: React.FC<ExternalShiftEvaluationBadgeProps> = ({
  status,
  className = '',
}) => {
  if (!status) return null;
  const label = LABELS[status];
  return <span className={`badge ${label.tone} ${className}`}>{label.text}</span>;
};

export default ExternalShiftEvaluationBadge;
