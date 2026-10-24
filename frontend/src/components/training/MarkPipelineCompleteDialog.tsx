/**
 * An officer marks a member's whole pipeline enrollment complete by hand.
 *
 * The backend decides everything that matters — who may (`training.manage`),
 * which enrollments (active or on hold), and what follows (the completion
 * notice and EVOC operator handling, the same as an automatic completion). This
 * only asks for the reason the audit log records, and says what will happen.
 */
import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { PromptDialog } from '../ux';
import { trainingProgramService } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandling';
import { MARK_PIPELINE_COMPLETE_LABEL } from './markPipelineComplete';

interface MarkPipelineCompleteDialogProps {
  /** The enrollment to complete; the dialog is open while this is set. */
  enrollmentId: string | null;
  memberName: string;
  onClose: () => void;
  /** Called after the server accepted it, to re-fetch what is on screen. */
  onCompleted: () => void | Promise<void>;
}

export const MarkPipelineCompleteDialog: React.FC<MarkPipelineCompleteDialogProps> = ({
  enrollmentId,
  memberName,
  onClose,
  onCompleted,
}) => {
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (reason: string) => {
    if (!enrollmentId) return;
    setSaving(true);
    try {
      await trainingProgramService.completeEnrollment(enrollmentId, reason);
      toast.success(`${memberName} marked complete`);
      onClose();
      await onCompleted();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to mark this pipeline complete'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PromptDialog
      isOpen={enrollmentId !== null}
      onClose={onClose}
      onSubmit={(reason) => {
        void handleSubmit(reason);
      }}
      title={`${MARK_PIPELINE_COMPLETE_LABEL}?`}
      message={
        <>
          <p>
            {memberName} is completed now and receives the completion notice, exactly as if they had finished every
            required item.
          </p>
          <p className="mt-2">
            Any required item they have not met stays unmet on their record. The reason below goes in the audit log.
          </p>
        </>
      }
      label="Reason"
      placeholder="Why this member is complete"
      hint="Required, up to 500 characters."
      multiline
      confirmLabel="Mark complete"
      cancelLabel="Keep in progress"
      loading={saving}
    />
  );
};

export default MarkPipelineCompleteDialog;
