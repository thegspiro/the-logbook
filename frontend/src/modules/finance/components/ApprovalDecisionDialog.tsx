/**
 * Approve or deny one approval step.
 *
 * Shared by the Approvals list and the three request detail pages so the
 * wording, the "reason required to deny" rule and the error handling cannot
 * drift between the two places a decision is made.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { PromptDialog } from '@/components/ux/PromptDialog';
import { getErrorMessage } from '@/utils/errorHandling';
import { useFinanceStore } from '../store/financeStore';

export interface ApprovalDecision {
  stepRecordId: string;
  action: 'approve' | 'deny';
  /** What is being decided, as the dialog should name it, e.g. "New hose (purchase request)". */
  subject: string;
  stepName?: string | undefined;
}

interface ApprovalDecisionDialogProps {
  /** `null` keeps the dialog closed. */
  decision: ApprovalDecision | null;
  onClose: () => void;
  /** Called after the API accepted the decision, before the dialog closes. */
  onDecided?: () => void;
}

export const ApprovalDecisionDialog: React.FC<ApprovalDecisionDialogProps> = ({ decision, onClose, onDecided }) => {
  const approveStep = useFinanceStore((s) => s.approveStep);
  const denyStep = useFinanceStore((s) => s.denyStep);
  const [busy, setBusy] = useState(false);

  const isDeny = decision?.action === 'deny';

  const handleSubmit = async (notes: string) => {
    if (!decision || busy) return;
    setBusy(true);
    try {
      if (decision.action === 'approve') {
        await approveStep(decision.stepRecordId, notes || undefined);
        toast.success('Approved');
      } else {
        await denyStep(decision.stepRecordId, notes);
        toast.success('Denied');
      }
      onDecided?.();
      onClose();
    } catch (err: unknown) {
      // Left open so a typed reason survives a failure worth retrying; the
      // message is the API's own (e.g. the separation-of-duties refusal).
      toast.error(getErrorMessage(err, isDeny ? 'Could not deny this request' : 'Could not approve this request'));
    } finally {
      setBusy(false);
    }
  };

  const stepLine = decision?.stepName ? ` at the ${decision.stepName} step` : '';
  const message = !decision ? null : isDeny ? (
    <>
      Deny <span className="text-theme-text-primary font-medium">{decision.subject}</span>
      {stepLine}. Denying ends the request, and no later steps run. Your reason is saved on the request.
    </>
  ) : (
    <>
      Approve <span className="text-theme-text-primary font-medium">{decision.subject}</span>
      {stepLine}. If more steps follow, the request moves to the next one.
    </>
  );

  return (
    <PromptDialog
      isOpen={decision !== null}
      onClose={() => {
        if (!busy) onClose();
      }}
      onSubmit={(value) => void handleSubmit(value)}
      title={isDeny ? 'Deny request' : 'Approve request'}
      message={message}
      label={isDeny ? 'Reason' : 'Notes'}
      multiline
      required={isDeny}
      {...(isDeny ? {} : { hint: 'Shown on the request’s approval timeline.' })}
      confirmLabel={isDeny ? 'Deny' : 'Approve'}
      confirmVariant={isDeny ? 'warning' : 'primary'}
      loading={busy}
    />
  );
};
