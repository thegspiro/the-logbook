/**
 * Form state and payload building for an approval-chain step.
 *
 * Kept out of the dialog component so the create/update payload rules can be
 * tested directly: create omits a blank field, update sends it as null so the
 * clear persists (CLAUDE.md pitfall #1).
 */

import { z } from 'zod';
import { ApprovalStepType, ApproverType } from '../types';
import type { ApprovalChainStep, ApprovalChainStepCreatePayload, ApprovalChainStepUpdatePayload } from '../types';

export interface StepFormValues {
  name: string;
  stepType: ApprovalStepType;
  /** '' = no named approver. */
  approverType: ApproverType | '';
  approverValue: string;
  allowSelfApproval: boolean;
  autoApproveUnder: string;
}

export type StepFormErrors = Partial<Record<keyof StepFormValues, string>>;

export const EMPTY_STEP_FORM: StepFormValues = {
  name: '',
  stepType: ApprovalStepType.APPROVAL,
  approverType: '',
  approverValue: '',
  allowSelfApproval: false,
  autoApproveUnder: '',
};

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
const emailSchema = z.email();

export function stepToFormValues(step: ApprovalChainStep): StepFormValues {
  return {
    name: step.name,
    stepType: step.stepType,
    approverType: step.approverType || '',
    approverValue: step.approverValue || '',
    allowSelfApproval: step.allowSelfApproval,
    autoApproveUnder: step.autoApproveUnder != null ? String(step.autoApproveUnder) : '',
  };
}

export function validateStepForm(values: StepFormValues): StepFormErrors {
  const errors: StepFormErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = 'Enter a name for this step.';
  else if (name.length > 200) errors.name = 'Keep the name to 200 characters or fewer.';

  if (values.stepType === ApprovalStepType.APPROVAL) {
    const value = values.approverValue.trim();
    if (values.approverType && !value) {
      errors.approverValue = 'Choose who this step names, or set the approver type to None.';
    } else if (values.approverType === ApproverType.EMAIL && !emailSchema.safeParse(value).success) {
      errors.approverValue = 'Enter one valid email address, such as trustee@example.org.';
    }

    const amount = values.autoApproveUnder.trim();
    if (amount && !AMOUNT_PATTERN.test(amount)) {
      errors.autoApproveUnder = 'Enter an amount in dollars, such as 250 or 250.00.';
    }
  }
  return errors;
}

/**
 * The fields the form owns, resolved for the chosen step type. Approver,
 * self-approval and auto-approve settings are read only on approval steps
 * (and self-approval only for an Email approver), so they are cleared rather
 * than kept when they no longer apply.
 */
function resolveFields(values: StepFormValues) {
  const isApproval = values.stepType === ApprovalStepType.APPROVAL;
  const approverType = isApproval && values.approverType ? values.approverType : null;
  return {
    name: values.name.trim(),
    stepType: values.stepType,
    approverType,
    approverValue: approverType ? values.approverValue.trim() || null : null,
    allowSelfApproval: approverType === ApproverType.EMAIL && values.allowSelfApproval,
    autoApproveUnder: isApproval ? values.autoApproveUnder.trim() || null : null,
  };
}

export function buildStepCreatePayload(values: StepFormValues, stepOrder: number): ApprovalChainStepCreatePayload {
  const f = resolveFields(values);
  return {
    step_order: stepOrder,
    name: f.name,
    step_type: f.stepType,
    approver_type: f.approverType || undefined,
    approver_value: f.approverValue || undefined,
    allow_self_approval: f.allowSelfApproval,
    auto_approve_under: f.autoApproveUnder || undefined,
  };
}

export function buildStepUpdatePayload(values: StepFormValues): ApprovalChainStepUpdatePayload {
  const f = resolveFields(values);
  return {
    name: f.name,
    step_type: f.stepType,
    approver_type: f.approverType,
    approver_value: f.approverValue,
    allow_self_approval: f.allowSelfApproval,
    auto_approve_under: f.autoApproveUnder,
  };
}
