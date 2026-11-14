/**
 * Manual Approval Panel
 *
 * Approve or deny a finance request that no approval chain applies to, or
 * one held for a second approver.
 *
 * Submitting a request when no chain matches (or the matching chain has no
 * steps) leaves it waiting for approval with no approval steps — and every
 * step-based action needs a step. This is the only way such a request moves.
 * The same goes for a request the department's dual-approval threshold holds
 * after its first approval (`awaitingSecondApproval`, the backend's reading):
 * its chain, if it had one, has nothing left. Likewise an expense report held
 * until an approver confirms its late lines (`awaitingLateAcknowledgement`).
 * Renders nothing unless the request is in one of those states and the viewer
 * holds `finance.approve`. Approving a report with late lines asks the
 * approver to confirm them first; the API refuses without that.
 */

import React, { useState } from 'react';
import { CheckCircle, Info, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { PromptDialog } from '@/components/ux/PromptDialog';
import { useAuthStore } from '@/stores/authStore';
import { useConfirm } from '@/contexts/ConfirmContext';
import { getErrorMessage } from '@/utils/errorHandling';
import { approvalService } from '../services/api';
import type { ApprovalEntityType } from '../types';
import { lateLinesConfirmation } from './lateLinesConfirmation';

const PENDING_APPROVAL = 'pending_approval';

interface ManualApprovalPanelProps {
  entityType: ApprovalEntityType;
  entityId: string;
  status: string;
  approvalStepCount: number;
  /** Held for a second, different approver after its first approval. */
  awaitingSecondApproval?: boolean | undefined;
  /** Who gave the first approval, when one was given outside a chain. */
  firstApprovedBy?: string | null | undefined;
  /** Expense reports: lines submitted after the substantiation deadline. */
  lateLineCount?: number | undefined;
  /** Held until an approver confirms the late lines. */
  awaitingLateAcknowledgement?: boolean | undefined;
  /** Who raised the request. They cannot approve it (the backend refuses too). */
  requesterId: string;
  /** Called after a decision is recorded, to reload the request. */
  onDecided: () => void;
}

export const ManualApprovalPanel: React.FC<ManualApprovalPanelProps> = ({
  entityType,
  entityId,
  status,
  approvalStepCount,
  awaitingSecondApproval = false,
  firstApprovedBy,
  lateLineCount = 0,
  awaitingLateAcknowledgement = false,
  requesterId,
  onDecided,
}) => {
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const { confirm } = useConfirm();
  const userId = useAuthStore((s) => s.user?.id);
  const [dialog, setDialog] = useState<'approve' | 'deny' | null>(null);
  const [saving, setSaving] = useState(false);

  if (
    status !== PENDING_APPROVAL ||
    (approvalStepCount > 0 && !awaitingSecondApproval && !awaitingLateAcknowledgement) ||
    !checkPermission('finance.approve')
  ) {
    return null;
  }

  const isRequester = Boolean(userId) && userId === requesterId;
  // Covers a first approval given here; one given through a chain step is
  // refused by the backend in the same words.
  const approvedAlready = Boolean(userId) && userId === firstApprovedBy;

  const decide = async (action: 'approve' | 'deny', value: string) => {
    const acknowledgeLate = action === 'approve' && lateLineCount > 0;
    if (acknowledgeLate && !(await confirm(lateLinesConfirmation(lateLineCount)))) return;
    setSaving(true);
    try {
      if (action === 'approve') {
        if (acknowledgeLate) {
          await approvalService.manualApprove(entityType, entityId, value || undefined, true);
        } else {
          await approvalService.manualApprove(entityType, entityId, value || undefined);
        }
        // Under the dual-approval threshold this may be the first of two; the
        // reloaded request says which.
        toast.success('Approval recorded');
      } else {
        await approvalService.manualDeny(entityType, entityId, value);
        toast.success('Request denied');
      }
      setDialog(null);
      onDecided();
    } catch (err: unknown) {
      toast.error(
        getErrorMessage(err, action === 'approve' ? 'Could not approve the request' : 'Could not deny the request')
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-6">
      <div className="split-row gap-4 sm:items-center">
        <div className="split-row-main flex items-start gap-3">
          <Info className="text-theme-text-secondary mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-theme-text-primary text-sm font-medium">
              {awaitingLateAcknowledgement
                ? 'This report has expenses submitted after the deadline. An approver has to confirm them before it is approved.'
                : awaitingSecondApproval
                  ? 'This request needs a second approval from someone who has not approved it yet.'
                  : 'No approval chain applies to this request. Approve or deny it here.'}
            </p>
            {approvedAlready && (
              <p className="text-theme-text-secondary mt-1 text-sm">
                You gave the first approval, so someone else has to give the second. You can still deny it.
              </p>
            )}
            {isRequester && (
              <p className="text-theme-text-secondary mt-1 text-sm">
                You submitted this request, so someone else has to approve it. You can still deny it.
              </p>
            )}
          </div>
        </div>
        <div className="split-row-aside flex flex-wrap items-center gap-2">
          {!isRequester && !approvedAlready && (
            <button
              type="button"
              disabled={saving}
              onClick={() => setDialog('approve')}
              className="btn-success btn-sm inline-flex items-center gap-1.5"
            >
              <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
              Approve
            </button>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => setDialog('deny')}
            className="btn-secondary btn-sm inline-flex items-center gap-1.5 text-red-700 dark:text-red-400"
          >
            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
            Deny
          </button>
        </div>
      </div>

      <PromptDialog
        isOpen={dialog === 'approve'}
        onClose={() => setDialog(null)}
        onSubmit={(notes) => void decide('approve', notes)}
        title="Approve request"
        message="The request will be marked approved."
        label="Note"
        required={false}
        multiline
        hint="Saved in the audit log."
        confirmLabel="Approve"
        loading={saving}
      />
      <PromptDialog
        isOpen={dialog === 'deny'}
        onClose={() => setDialog(null)}
        onSubmit={(reason) => void decide('deny', reason)}
        title="Deny request"
        message="The request will be marked denied."
        label="Reason"
        required
        multiline
        hint="The requester sees this reason."
        confirmLabel="Deny"
        confirmVariant="warning"
        loading={saving}
      />
    </div>
  );
};

export default ManualApprovalPanel;
