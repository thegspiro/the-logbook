/**
 * Approve / Deny for the step a request is currently waiting on, shown on the
 * request's detail page.
 *
 * Renders nothing unless all of these hold: the request is pending approval,
 * the viewer holds `finance.approve` (the gate on the approve/deny endpoints),
 * there is a pending step, and that step is an approval step rather than a
 * notification. A pending request with no pending step is a different problem
 * and is not handled here.
 */

import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { approvalChainService } from '../services/api';
import { ApprovalStepType } from '../types';
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
  const canApprove = useAuthStore((s) => s.checkPermission('finance.approve'));
  const current = isPendingApproval && canApprove ? findCurrentPendingStep(steps) : undefined;
  const chainId = current?.chainId;
  const stepId = current?.stepId;

  // The step record does not carry its step's type, so it is read from the
  // chain. A reachable notification step is marked "sent" by the backend and
  // so should never be the pending one, but that is an invariant of the
  // backend's advance logic rather than something this page can see — and
  // offering Approve on a notification would only earn a confusing refusal.
  const [stepType, setStepType] = useState<{ stepId: string; type: ApprovalStepType | null } | null>(null);

  useEffect(() => {
    if (!chainId || !stepId) return undefined;
    let cancelled = false;
    approvalChainService
      .get(chainId)
      .then((chain) => {
        if (cancelled) return;
        const step = chain.steps.find((s) => s.id === stepId);
        setStepType({ stepId, type: step?.stepType ?? null });
      })
      .catch(() => {
        // Fail closed: without the step's type, offer nothing rather than
        // buttons that may not apply. The timeline still shows the step.
        if (!cancelled) setStepType({ stepId, type: null });
      });
    return () => {
      cancelled = true;
    };
  }, [chainId, stepId]);

  const [decision, setDecision] = useState<ApprovalDecision | null>(null);

  if (!current || stepType?.stepId !== current.stepId || stepType.type !== ApprovalStepType.APPROVAL) {
    return null;
  }

  const open = (action: ApprovalDecision['action']) =>
    setDecision({ stepRecordId: current.id, action, subject, stepName: current.stepName });

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-yellow-500/30 dark:bg-yellow-500/10">
      <p className="text-theme-text-primary text-sm">
        Waiting on <span className="font-medium">{current.stepName ?? 'the next approval step'}</span>. You can approve
        or deny this step.
      </p>
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
      <ApprovalDecisionDialog decision={decision} onClose={() => setDecision(null)} onDecided={onDecided} />
    </div>
  );
};
