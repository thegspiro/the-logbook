/**
 * Add or edit one step of an approval chain.
 *
 * The help text describes what the backend actually does with each field
 * (finance_service.py, finance_approver_matching.py), not what the data model
 * suggests: only the named approver — or any finance.approve holder when none
 * is named — can act on an approval step in The Logbook, an approvals admin can
 * override with a reason, the named approver is only contacted when the type
 * is Email, and notification steps send no email yet.
 */

import React, { useState } from 'react';
import { Modal } from '../../../components/Modal';
import { ApprovalStepType, ApproverType } from '../types';
import { EMPTY_STEP_FORM, validateStepForm } from '../utils/approvalStepForm';
import type { StepFormErrors, StepFormValues } from '../utils/approvalStepForm';
import type { ApproverOption, ApproverOptions } from '../hooks/useApproverOptions';

interface ApprovalStepDialogProps {
  /** Title and submit label switch on this. */
  mode: 'add' | 'edit';
  initialValues?: StepFormValues;
  approverOptions: ApproverOptions;
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: StepFormValues) => Promise<void>;
}

const APPROVER_TYPE_CHOICES: { value: ApproverType | ''; label: string }[] = [
  { value: '', label: 'None' },
  { value: ApproverType.POSITION, label: 'Position' },
  { value: ApproverType.PERMISSION, label: 'Permission' },
  { value: ApproverType.SPECIFIC_USER, label: 'Specific member' },
  { value: ApproverType.EMAIL, label: 'Email' },
];

function optionsFor(type: ApproverType | '', options: ApproverOptions): ApproverOption[] | null {
  if (type === ApproverType.POSITION) return options.positions;
  if (type === ApproverType.PERMISSION) return options.permissions;
  if (type === ApproverType.SPECIFIC_USER) return options.users;
  return null;
}

const TEXT_FALLBACK_LABEL: Partial<Record<ApproverType, string>> = {
  [ApproverType.POSITION]: 'Position slug, such as treasurer',
  [ApproverType.PERMISSION]: 'Permission, such as finance.approve',
  [ApproverType.SPECIFIC_USER]: 'Member ID',
};

export const ApprovalStepDialog: React.FC<ApprovalStepDialogProps> = ({
  mode,
  initialValues,
  approverOptions,
  saving,
  onClose,
  onSubmit,
}) => {
  const [values, setValues] = useState<StepFormValues>(initialValues ?? EMPTY_STEP_FORM);
  const [errors, setErrors] = useState<StepFormErrors>({});

  const update = <K extends keyof StepFormValues>(key: K, value: StepFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const isApproval = values.stepType === ApprovalStepType.APPROVAL;
  const pickerOptions = optionsFor(values.approverType, approverOptions);
  // Keep a stored value selectable even when it is not in today's list (a
  // position renamed, a member removed) so opening the form does not blank it.
  const pickerItems =
    pickerOptions && values.approverValue && !pickerOptions.some((o) => o.value === values.approverValue)
      ? [...pickerOptions, { value: values.approverValue, label: `${values.approverValue} (not found)` }]
      : pickerOptions;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateStepForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    void onSubmit(values);
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={mode === 'add' ? 'Add step' : 'Edit step'}
      size="lg"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {mode === 'add' ? 'Add step' : 'Save step'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="step-name" className="form-label">
            Step name
          </label>
          <input
            id="step-name"
            className="form-input"
            value={values.name}
            maxLength={200}
            placeholder="e.g., Treasurer review"
            onChange={(e) => update('name', e.target.value)}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'step-name-error' : undefined}
          />
          {errors.name && (
            <p id="step-name-error" className="mt-1 text-xs text-red-700 dark:text-red-400">
              {errors.name}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="step-type" className="form-label">
            Step type
          </label>
          <select
            id="step-type"
            className="form-input"
            value={values.stepType}
            onChange={(e) => update('stepType', e.target.value as ApprovalStepType)}
          >
            <option value={ApprovalStepType.APPROVAL}>Approval</option>
            <option value={ApprovalStepType.NOTIFICATION}>Notification</option>
          </select>
          <p className="text-theme-text-secondary mt-1 text-xs">
            {isApproval
              ? 'The request waits here until someone approves or denies it.'
              : 'Marked as sent on the request’s approval timeline when the request reaches it, and does not hold the request up. It does not send an email.'}
          </p>
        </div>

        {isApproval && (
          <>
            <div>
              <label htmlFor="step-approver-type" className="form-label">
                Approver type
              </label>
              <select
                id="step-approver-type"
                className="form-input"
                value={values.approverType}
                onChange={(e) => {
                  const next = e.target.value as ApproverType | '';
                  setValues((prev) => ({
                    ...prev,
                    approverType: next,
                    approverValue: '',
                    allowSelfApproval: next === ApproverType.EMAIL ? prev.allowSelfApproval : false,
                  }));
                }}
              >
                {APPROVER_TYPE_CHOICES.map((choice) => (
                  <option key={choice.value || 'none'} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
              <p className="text-theme-text-secondary mt-1 text-xs">
                Only the approver chosen here can approve or deny this step in The Logbook. With None, anyone with the
                finance.approve permission can. An approvals administrator can also act on it by giving a reason, which
                is recorded in the audit log. The Email type also sends that address a link to approve or deny the
                request when it reaches this step (if email sending is set up).
              </p>
            </div>

            {values.approverType && (
              <div>
                <label htmlFor="step-approver-value" className="form-label">
                  {values.approverType === ApproverType.EMAIL
                    ? 'Approver email'
                    : pickerItems
                      ? APPROVER_TYPE_CHOICES.find((c) => c.value === values.approverType)?.label
                      : TEXT_FALLBACK_LABEL[values.approverType]}
                </label>
                {pickerItems ? (
                  <select
                    id="step-approver-value"
                    className="form-input"
                    value={values.approverValue}
                    onChange={(e) => update('approverValue', e.target.value)}
                    aria-invalid={Boolean(errors.approverValue)}
                    aria-describedby={errors.approverValue ? 'step-approver-value-error' : undefined}
                  >
                    <option value="">Choose…</option>
                    {pickerItems.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="step-approver-value"
                    // Validated by validateStepForm, not the browser, so the
                    // message is the same one every other field shows.
                    type="text"
                    inputMode={values.approverType === ApproverType.EMAIL ? 'email' : 'text'}
                    className="form-input"
                    value={values.approverValue}
                    maxLength={500}
                    placeholder={values.approverType === ApproverType.EMAIL ? 'trustee@example.org' : undefined}
                    onChange={(e) => update('approverValue', e.target.value)}
                    aria-invalid={Boolean(errors.approverValue)}
                    aria-describedby={errors.approverValue ? 'step-approver-value-error' : undefined}
                  />
                )}
                {errors.approverValue && (
                  <p id="step-approver-value-error" className="mt-1 text-xs text-red-700 dark:text-red-400">
                    {errors.approverValue}
                  </p>
                )}
              </div>
            )}

            {values.approverType === ApproverType.EMAIL && (
              <label className="text-theme-text-primary touch:min-h-[44px] flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="form-checkbox mt-0.5"
                  checked={values.allowSelfApproval}
                  onChange={(e) => update('allowSelfApproval', e.target.checked)}
                />
                <span>
                  Allow self-approval by email
                  <span className="text-theme-text-secondary block text-xs">
                    Lets this address approve through the emailed link even when it is the requester’s own email.
                    Members approving in The Logbook can never approve their own request.
                  </span>
                </span>
              </label>
            )}

            <div>
              <label htmlFor="step-auto-approve" className="form-label">
                Auto-approve under ($)
              </label>
              <input
                id="step-auto-approve"
                type="text"
                inputMode="decimal"
                className="form-input"
                value={values.autoApproveUnder}
                placeholder="Leave blank to always require approval"
                onChange={(e) => update('autoApproveUnder', e.target.value)}
                aria-invalid={Boolean(errors.autoApproveUnder)}
                aria-describedby={errors.autoApproveUnder ? 'step-auto-approve-error' : 'step-auto-approve-help'}
              />
              {errors.autoApproveUnder ? (
                <p id="step-auto-approve-error" className="mt-1 text-xs text-red-700 dark:text-red-400">
                  {errors.autoApproveUnder}
                </p>
              ) : (
                <p id="step-auto-approve-help" className="text-theme-text-secondary mt-1 text-xs">
                  A request for less than this amount is approved at this step automatically when it is submitted.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default ApprovalStepDialog;
