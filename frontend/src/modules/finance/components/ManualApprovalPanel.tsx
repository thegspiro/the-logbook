/**
 * Manual Approval Panel
 *
 * Approve or deny a finance request that no approval chain applies to.
 *
 * Submitting a request when no chain matches (or the matching chain has no
 * steps) leaves it waiting for approval with no approval steps — and every
 * step-based action needs a step. This is the only way such a request moves.
 * Renders nothing unless the request is in exactly that state and the viewer
 * holds `finance.approve`.
 */

import React, { useState } from 'react';
import { CheckCircle, Info, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { PromptDialog } from '@/components/ux/PromptDialog';
import { useAuthStore } from '@/stores/authStore';
import { getErrorMessage } from '@/utils/errorHandling';
import { approvalService } from '../services/api';
import type { ApprovalEntityType } from '../types';

const PENDING_APPROVAL = 'pending_approval';

interface ManualApprovalPanelProps {
  entityType: ApprovalEntityType;
  entityId: string;
  status: string;
  approvalStepCount: number;
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
  requesterId,
  onDecided,
}) => {
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const userId = useAuthStore((s) => s.user?.id);
  const [dialog, setDialog] = useState<'approve' | 'deny' | null>(null);
  const [saving, setSaving] = useState(false);

  if (status !== PENDING_APPROVAL || approvalStepCount > 0 || !checkPermission('finance.approve')) {
    return null;
  }

  const isRequester = Boolean(userId) && userId === requesterId;

  const decide = async (action: 'approve' | 'deny', value: string) => {
    setSaving(true);
    try {
      if (action === 'approve') {
        await approvalService.manualApprove(entityType, entityId, value || undefined);
        toast.success('Request approved');
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Info className="text-theme-text-secondary mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-theme-text-primary text-sm font-medium">
              No approval chain applies to this request. Approve or deny it here.
            </p>
            {isRequester && (
              <p className="text-theme-text-secondary mt-1 text-sm">
                You submitted this request, so someone else has to approve it. You can still deny it.
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isRequester && (
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
        label="Note (optional)"
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
