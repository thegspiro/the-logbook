/**
 * Approve or deny one approval step.
 *
 * Shared by the Approvals list and the three request detail pages so the
 * wording, the "reason required to deny" rule and the error handling cannot
 * drift between the two places a decision is made.
 *
 * Two modes. The usual one is a single prompt: optional notes to approve, a
 * required reason to deny. When the viewer is an approvals admin acting on a
 * step assigned to someone else (the backend's `requiresOverride`), the dialog
 * also asks for an override reason — the API refuses that decision without
 * one, and records it in the audit log.
 *
 * Approving an expense report with lines submitted after the department's
 * substantiation deadline (`lateLines`) first asks the approver to confirm
 * they have reviewed them; the API refuses the approval without that.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { FormField } from '@/components/ux/FormField';
import { PromptDialog } from '@/components/ux/PromptDialog';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useDiscardGuard } from '@/hooks/useDiscardGuard';
import { getErrorMessage } from '@/utils/errorHandling';
import type { ServerFieldSpec } from '@/utils/serverFieldErrors';
import { refusalsOnFields, type FieldErrors } from '../utils/fieldRefusals';
import { useFinanceStore } from '../store/financeStore';
import { lateLinesConfirmation } from './lateLinesConfirmation';

/** The backend's limit on `overrideReason` (ApprovalActionRequest). */
const OVERRIDE_REASON_MAX_LENGTH = 2000;

type DecisionField = 'notes' | 'overrideReason';

/** `ApprovalActionRequest` (schemas/finance.py); `notes` has no limit. */
const SERVER_FIELDS: Record<DecisionField, ServerFieldSpec> = {
  notes: { label: 'Notes' },
  overrideReason: { label: 'Override reason', maxLength: OVERRIDE_REASON_MAX_LENGTH },
};

export interface ApprovalDecision {
  stepRecordId: string;
  action: 'approve' | 'deny';
  /** What is being decided, as the dialog should name it, e.g. "New hose (purchase request)". */
  subject: string;
  stepName?: string | undefined;
  /**
   * Set when the viewer is acting as an approvals admin on a step they are not
   * the named approver of. Comes from the backend's `requiresOverride` flag.
   */
  override?: { assigneeLabel: string } | undefined;
  /** Expense reports: lines submitted after the substantiation deadline. */
  lateLines?: number | undefined;
}

interface ApprovalDecisionDialogProps {
  /** `null` keeps the dialog closed. */
  decision: ApprovalDecision | null;
  onClose: () => void;
  /** Called after the API accepted the decision, before the dialog closes. */
  onDecided?: () => void;
}

const decisionMessage = (decision: ApprovalDecision): React.ReactNode => {
  const stepLine = decision.stepName ? ` at the ${decision.stepName} step` : '';
  return decision.action === 'deny' ? (
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
};

interface OverrideFormProps {
  decision: ApprovalDecision;
  assigneeLabel: string;
  busy: boolean;
  /** What the server refused, on its field; the decision is not recorded. */
  serverErrors: FieldErrors<DecisionField>;
  /** Clears a server refusal once its field is edited. */
  onEdited: (field: DecisionField) => void;
  onClose: () => void;
  onSubmit: (notes: string, overrideReason: string) => void;
}

/**
 * Mounted only while open, and keyed on the decision by the caller, so a
 * reason typed for one step is never prefilled into the next.
 */
const OverrideForm: React.FC<OverrideFormProps> = ({
  decision,
  assigneeLabel,
  busy,
  serverErrors,
  onEdited,
  onClose,
  onSubmit,
}) => {
  const isDeny = decision.action === 'deny';
  const [notes, setNotes] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [touched, setTouched] = useState(false);
  const isDirty = notes !== '' || overrideReason !== '';
  // Escape, the X and Cancel all ask before throwing away a typed reason.
  const requestClose = useDiscardGuard({
    isDirty,
    onClose: () => {
      if (!busy) onClose();
    },
  });

  const trimmedNotes = notes.trim();
  const trimmedReason = overrideReason.trim();
  const notesError = isDeny && !trimmedNotes ? 'Reason is required.' : null;
  const reasonError = !trimmedReason
    ? 'Override reason is required.'
    : trimmedReason.length > OVERRIDE_REASON_MAX_LENGTH
      ? 'Override reason must be 2,000 characters or fewer.'
      : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (notesError || reasonError || busy) return;
    onSubmit(trimmedNotes, trimmedReason);
  };

  const title = isDeny ? 'Deny as approvals admin' : 'Approve as approvals admin';
  const notesShown = (touched ? notesError : null) ?? serverErrors.notes;
  const reasonShown = (touched ? reasonError : null) ?? serverErrors.overrideReason;

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title={title}
      size="sm"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button
            type="submit"
            disabled={busy}
            className={
              isDeny
                ? 'inline-flex items-center justify-center gap-2 rounded-lg bg-amber-700 px-4 py-2 font-medium text-white transition-colors hover:bg-amber-800 disabled:opacity-50'
                : 'btn-primary inline-flex items-center justify-center gap-2 font-medium'
            }
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {title}
          </button>
          <button type="button" onClick={requestClose} disabled={busy} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="text-theme-text-secondary space-y-2 text-sm">
          <p>{decisionMessage(decision)}</p>
          <p>
            This step is assigned to <span className="text-theme-text-primary font-medium">{assigneeLabel}</span>. As an
            approvals administrator you can still {isDeny ? 'deny' : 'approve'} it, but you must say why.
          </p>
        </div>

        <FormField
          id="approval-decision-notes"
          label={isDeny ? 'Reason' : 'Notes'}
          optional={!isDeny}
          error={notesShown}
          hint={isDeny ? 'Saved on the request.' : 'Shown on the request’s approval timeline.'}
        >
          {(field) => (
            <textarea
              {...field}
              className="form-input"
              rows={3}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                onEdited('notes');
              }}
            />
          )}
        </FormField>

        <FormField
          id="approval-decision-override"
          label="Override reason"
          error={reasonShown}
          hint="Why you are acting on a step assigned to someone else. Recorded in the audit log."
          maxLength={OVERRIDE_REASON_MAX_LENGTH}
          count={overrideReason.length}
        >
          {(field) => (
            <textarea
              {...field}
              className="form-input"
              rows={3}
              value={overrideReason}
              onChange={(e) => {
                setOverrideReason(e.target.value);
                onEdited('overrideReason');
              }}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};

export const ApprovalDecisionDialog: React.FC<ApprovalDecisionDialogProps> = ({ decision, onClose, onDecided }) => {
  const approveStep = useFinanceStore((s) => s.approveStep);
  const denyStep = useFinanceStore((s) => s.denyStep);
  const { confirm } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors<DecisionField>>({});

  const isDeny = decision?.action === 'deny';

  const handleSubmit = async (notes: string, overrideReason?: string) => {
    if (!decision || busy) return;
    const lateLines = decision.action === 'approve' ? (decision.lateLines ?? 0) : 0;
    if (lateLines > 0 && !(await confirm(lateLinesConfirmation(lateLines)))) return;
    setBusy(true);
    setServerErrors({});
    try {
      if (decision.action === 'approve') {
        if (lateLines > 0) {
          await approveStep(decision.stepRecordId, notes || undefined, overrideReason, true);
        } else {
          await approveStep(decision.stepRecordId, notes || undefined, overrideReason);
        }
        toast.success('Approved');
      } else {
        await denyStep(decision.stepRecordId, notes, overrideReason);
        toast.success('Denied');
      }
      onDecided?.();
      onClose();
    } catch (err: unknown) {
      // The override form shows a refusal on its field; nothing was recorded.
      const mapped = decision.override ? refusalsOnFields(err, SERVER_FIELDS) : null;
      if (mapped) {
        setServerErrors(mapped.fieldErrors);
        const first = mapped.fieldErrors.notes ? 'approval-decision-notes' : 'approval-decision-override';
        document.getElementById(first)?.focus();
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
      // Left open so a typed reason survives a failure worth retrying; the
      // message is the API's own (e.g. the separation-of-duties refusal, or
      // "This step is waiting on …" when the viewer is not its approver).
      toast.error(getErrorMessage(err, isDeny ? 'Could not deny this request' : 'Could not approve this request'));
    } finally {
      setBusy(false);
    }
  };

  if (decision?.override) {
    return (
      <OverrideForm
        key={`${decision.stepRecordId}:${decision.action}`}
        decision={decision}
        assigneeLabel={decision.override.assigneeLabel}
        busy={busy}
        serverErrors={serverErrors}
        onEdited={(field) =>
          setServerErrors((prev) => {
            if (!prev[field]) return prev;
            const next = { ...prev };
            delete next[field];
            return next;
          })
        }
        onClose={() => {
          setServerErrors({});
          onClose();
        }}
        onSubmit={(notes, overrideReason) => void handleSubmit(notes, overrideReason)}
      />
    );
  }

  return (
    <PromptDialog
      isOpen={decision !== null}
      onClose={() => {
        if (!busy) onClose();
      }}
      onSubmit={(value) => void handleSubmit(value)}
      title={isDeny ? 'Deny request' : 'Approve request'}
      message={decision ? decisionMessage(decision) : null}
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
