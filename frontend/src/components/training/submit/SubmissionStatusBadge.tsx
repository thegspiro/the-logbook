import React from 'react';
import type { SubmissionStatus } from '../../../types/training';

const STATUS_BADGE: Record<SubmissionStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-theme-surface-hover text-theme-text-muted' },
  pending_review: {
    label: 'Pending Review',
    className: 'bg-theme-alert-warning-bg text-theme-alert-warning-text',
  },
  approved: { label: 'Approved', className: 'bg-theme-alert-success-bg text-theme-alert-success-text' },
  rejected: { label: 'Rejected', className: 'bg-theme-alert-danger-bg text-theme-alert-danger-text' },
  revision_requested: {
    label: 'Needs Edits',
    className: 'bg-theme-alert-warning-bg text-orange-700 dark:text-orange-400',
  },
};

export const StatusBadge: React.FC<{ status: SubmissionStatus }> = ({ status }) => {
  const badge = STATUS_BADGE[status];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>;
};
