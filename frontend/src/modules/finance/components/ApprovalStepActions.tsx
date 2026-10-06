/**
 * Who the request is waiting on, and Approve / Deny for that step, shown on
 * the request's detail page.
 *
 * Whether the viewer may act is the backend's answer, not this component's:
 * the detail endpoint sets `canAct` (the viewer is the step's named approver)
 * or `requiresOverride` (an approvals admin who is not) on the step the request
 * is waiting on, from the same rule approve / deny enforce. Both are false for
 * a notification step and for a viewer without `finance.approve`, so neither
 * is re-checked here.
 *
 * Renders nothing unless the request is pending approval and has a pending
 * step. A pending request with no pending step is a different problem and is
 * not handled here.
 */

import React, { useState } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import type { ApprovalStepRecord } from '../types';
import { ApprovalDecisionDialog } from './ApprovalDecisionDialog';
import type { ApprovalDecision } from './ApprovalDecisionDialog';
import { findCurrentPendingStep } from './approvalEntities';

interface ApprovalStepActionsProps {
  isPendingApproval: boolean;
  steps: ApprovalStepRecord[];
  /** How the dialog names the request, e.g. "PR-2026-0004 (purchase request)". */
  subject: string;
  /** Re-fetch the request after a decision is recorded. */
  onDecided: () => void;
}

export const ApprovalStepActions: React.FC<ApprovalStepActionsProps> = ({
  isPendingApproval,
  steps,
  subject,
  onDecided,
}) => {
  const [decision, setDecision] = useState<ApprovalDecision | null>(null);
  const current = isPendingApproval ? findCurrentPendingStep(steps) : undefined;
  if (!current) return null;

  const canAct = current.canAct === true;
  const requiresOverride = !canAct && current.requiresOverride === true;
  const assigneeLabel = current.assigneeLabel || null;
  if (!assigneeLabel && !canAct && !requiresOverride) return null;

  const open = (action: ApprovalDecision['action']) =>
    setDecision({
      stepRecordId: current.id,
      action,
      subject,
      stepName: current.stepName,
      override: requiresOverride ? { assigneeLabel: assigneeLabel || 'someone else' } : undefined,
    });

  const boxClass =
    canAct || requiresOverride
      ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-500/30 dark:bg-yellow-500/10'
      : 'border-theme-surface-border bg-theme-surface-secondary';

  return (
    <div
      className={`mb-6 flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between ${boxClass}`}
    >
      <div className="text-theme-text-primary space-y-1 text-sm">
        {assigneeLabel && (
          <p>
            Waiting on <span className="font-medium">{assigneeLabel}</span>.
          </p>
        )}
        {canAct && <p>You can approve or deny this step.</p>}
        {requiresOverride && (
          <p className="flex flex-wrap items-center gap-2">
            <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
              Not assigned to you
            </span>
            <span>As an approvals administrator you can act on it by giving an override reason.</span>
          </p>
        )}
      </div>
      {canAct && (
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => open('approve')}
            className="btn-success inline-flex items-center gap-1.5 text-sm font-medium"
          >
            <CheckCircle className="h-4 w-4" />
            Approve
          </button>
          <button
            type="button"
            onClick={() => open('deny')}
            className="btn-secondary inline-flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-400"
          >
            <XCircle className="h-4 w-4" />
            Deny
          </button>
        </div>
      )}
      {requiresOverride && (
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => open('approve')}
            className="btn-secondary inline-flex items-center gap-1.5 text-sm font-medium"
          >
            <CheckCircle className="h-4 w-4" />
            Approve as approvals admin
          </button>
          <button
            type="button"
            onClick={() => open('deny')}
            className="btn-secondary inline-flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-400"
          >
            <XCircle className="h-4 w-4" />
            Deny as approvals admin
          </button>
        </div>
      )}
      <ApprovalDecisionDialog decision={decision} onClose={() => setDecision(null)} onDecided={onDecided} />
    </div>
  );
};
