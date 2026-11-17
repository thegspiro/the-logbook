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

import React, { useRef, useState } from 'react';
import { Modal } from '../../../components/Modal';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { ApprovalStepType, ApproverType } from '../types';
import { EMPTY_STEP_FORM, validateStepForm } from '../utils/approvalStepForm';
import type { StepFormErrors, StepFormValues } from '../utils/approvalStepForm';
import { firstErrorField, refusalsOnFields } from '../utils/fieldRefusals';
import type { ApproverOption, ApproverOptions } from '../hooks/useApproverOptions';

/** `ApprovalChainStepCreate` / `ApprovalChainStepUpdate` (schemas/finance.py): `name` max_length=200. */
const MAX_NAME = 200;
/**
 * The schema puts no `max_length` on `approver_value`; the column is
 * `String(500)` (models/finance.py), so the field stops there rather than at a
 * database error.
 */
const MAX_APPROVER_VALUE = 500;

type StepField = keyof StepFormValues;

/** The step payload is snake_case (`buildStep*Payload`); the default lookup covers it. */
const SERVER_FIELDS: Record<StepField, ServerFieldSpec> = {
  name: { label: 'Step name', maxLength: MAX_NAME },
  stepType: { label: 'Step type' },
  approverType: { label: 'Approver type' },
  approverValue: { label: 'Approver' },
  allowSelfApproval: { label: 'Allow self-approval by email' },
  autoApproveUnder: { label: 'Auto-approve under' },
};
const FIELD_ORDER = Object.keys(SERVER_FIELDS) as StepField[];
const FIELD_IDS: Record<StepField, string> = {
  name: 'step-name',
  stepType: 'step-type',
  approverType: 'step-approver-type',
  approverValue: 'step-approver-value',
  allowSelfApproval: 'step-allow-self-approval',
  autoApproveUnder: 'step-auto-approve',
};

const sameValues = (a: StepFormValues, b: StepFormValues) => FIELD_ORDER.every((key) => a[key] === b[key]);

interface ApprovalStepDialogProps {
  /** Title and submit label switch on this. */
  mode: 'add' | 'edit';
  initialValues?: StepFormValues;
  approverOptions: ApproverOptions;
  saving: boolean;
  onClose: () => void;
  /**
   * Saves the step. A rejection is shown in the dialog: a 422 on the field it
   * names, anything else beside the buttons. A caller that reports its own
   * failures and resolves leaves the dialog as it is.
   */
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
  const initial = useRef(initialValues ?? EMPTY_STEP_FORM);
  const [values, setValues] = useState<StepFormValues>(initial.current);
  const [errors, setErrors] = useState<StepFormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  // Escape, the X and Cancel all ask before throwing away a changed step
  // (forms review F-6).
  const requestClose = useDiscardGuard({ isDirty: !sameValues(values, initial.current), onClose });

  const clearError = (key: StepField) =>
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

  const update = <K extends StepField>(key: K, value: StepFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    clearError(key);
  };

  const flag = (next: StepFormErrors) => {
    setErrors(next);
    const first = firstErrorField(next, FIELD_ORDER);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
    return first === undefined;
  };

  const isApproval = values.stepType === ApprovalStepType.APPROVAL;
  // Former members are not offered; one this step already names stays, marked.
  const pickerOptions =
    optionsFor(values.approverType, approverOptions)
      ?.filter((o) => !o.former || o.value === values.approverValue)
      .map((o) => (o.former ? { ...o, label: `${o.label} (former member)` } : o)) ?? null;
  // Keep a stored value selectable even when it is not in today's list (a
  // position renamed, a member removed) so opening the form does not blank it.
  const pickerItems =
    pickerOptions && values.approverValue && !pickerOptions.some((o) => o.value === values.approverValue)
      ? [...pickerOptions, { value: values.approverValue, label: `${values.approverValue} (not found)` }]
      : pickerOptions;

  const save = async () => {
    try {
      await onSubmit(values);
    } catch (err: unknown) {
      // Presentation only: what is sent, and who may approve, stay the
      // caller's and the backend's (forms review, approvals rule).
      const mapped = refusalsOnFields(err, SERVER_FIELDS);
      if (mapped) {
        flag(mapped.fieldErrors);
        if (mapped.unmatched.length > 0) setFailure(mapped.unmatched.join(' '));
        return;
      }
      setFailure(getErrorMessage(err, 'Could not save the step.'));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFailure(null);
    if (!flag(validateStepForm(values))) return;
    void save();
  };

  const approverValueLabel =
    values.approverType === ApproverType.EMAIL
      ? 'Approver email'
      : values.approverType && pickerItems
        ? APPROVER_TYPE_CHOICES.find((c) => c.value === values.approverType)?.label
        : values.approverType
          ? TEXT_FALLBACK_LABEL[values.approverType]
          : undefined;

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title={mode === 'add' ? 'Add step' : 'Edit step'}
      size="lg"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {mode === 'add' ? 'Add step' : 'Save step'}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField
          id={FIELD_IDS.name}
          label="Step name"
          error={errors.name}
          maxLength={MAX_NAME}
          count={values.name.length}
        >
          {(field) => (
            <input
              {...field}
              className="form-input"
              value={values.name}
              placeholder="e.g., Treasurer review"
              onChange={(e) => update('name', e.target.value)}
            />
          )}
        </FormField>

        <FormField
          id={FIELD_IDS.stepType}
          label="Step type"
          error={errors.stepType}
          hint={
            isApproval
              ? 'The request waits here until someone approves or denies it.'
              : 'Marked as sent on the request’s approval timeline when the request reaches it, and does not hold the request up. It does not send an email.'
          }
        >
          {(field) => (
            <select
              {...field}
              className="form-input"
              value={values.stepType}
              onChange={(e) => update('stepType', e.target.value as ApprovalStepType)}
            >
              <option value={ApprovalStepType.APPROVAL}>Approval</option>
              <option value={ApprovalStepType.NOTIFICATION}>Notification</option>
            </select>
          )}
        </FormField>

        {isApproval && (
          <>
            <FormField
              id={FIELD_IDS.approverType}
              label="Approver type"
              error={errors.approverType}
              hint="Only the approver chosen here can approve or deny this step in The Logbook. A position or member chosen here can do so without the finance.approve permission, on this step only. With None, anyone with the finance.approve permission can. An approvals administrator can also act on it by giving a reason, which is recorded in the audit log. The Email type also sends that address a link to approve or deny the request when it reaches this step (if email sending is set up)."
            >
              {(field) => (
                <select
                  {...field}
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
                    clearError('approverType');
                    clearError('approverValue');
                  }}
                >
                  {APPROVER_TYPE_CHOICES.map((choice) => (
                    <option key={choice.value || 'none'} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>

            {values.approverType && (
              <FormField
                id={FIELD_IDS.approverValue}
                label={approverValueLabel}
                error={errors.approverValue}
                {...(pickerItems ? {} : { maxLength: MAX_APPROVER_VALUE, count: values.approverValue.length })}
              >
                {(field) =>
                  pickerItems ? (
                    <select
                      {...field}
                      className="form-input"
                      value={values.approverValue}
                      onChange={(e) => update('approverValue', e.target.value)}
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
                      {...field}
                      // Validated by validateStepForm, not the browser, so the
                      // message is the same one every other field shows.
                      type="text"
                      inputMode={values.approverType === ApproverType.EMAIL ? 'email' : 'text'}
                      className="form-input"
                      value={values.approverValue}
                      placeholder={values.approverType === ApproverType.EMAIL ? 'trustee@example.org' : undefined}
                      onChange={(e) => update('approverValue', e.target.value)}
                    />
                  )
                }
              </FormField>
            )}

            {values.approverType === ApproverType.EMAIL && (
              <label className="text-theme-text-primary touch:min-h-[44px] flex items-start gap-2 text-sm">
                <input
                  id={FIELD_IDS.allowSelfApproval}
                  type="checkbox"
                  className="form-checkbox mt-0.5"
                  checked={values.allowSelfApproval}
                  aria-invalid={errors.allowSelfApproval ? true : undefined}
                  onChange={(e) => update('allowSelfApproval', e.target.checked)}
                />
                <span>
                  Allow self-approval by email
                  <span className="text-theme-text-secondary block text-xs">
                    Lets this address approve through the emailed link even when it is the requester’s own email.
                    Members approving in The Logbook can never approve their own request.
                  </span>
                  {errors.allowSelfApproval && (
                    <span className={`mt-1 block text-sm ${FIELD_ERROR_CLASS}`}>{errors.allowSelfApproval}</span>
                  )}
                </span>
              </label>
            )}

            <FormField
              id={FIELD_IDS.autoApproveUnder}
              label="Auto-approve under ($)"
              error={errors.autoApproveUnder}
              hint="A request for less than this amount is approved at this step automatically when it is submitted."
            >
              {(field) => (
                <input
                  {...field}
                  type="text"
                  inputMode="decimal"
                  className="form-input"
                  value={values.autoApproveUnder}
                  placeholder="Leave blank to always require approval"
                  onChange={(e) => update('autoApproveUnder', e.target.value)}
                />
              )}
            </FormField>
          </>
        )}

        {failure && (
          <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
            {failure}
          </p>
        )}
      </div>
    </Modal>
  );
};

export default ApprovalStepDialog;
