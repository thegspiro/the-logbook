/**
 * Signing an evaluation step.
 *
 * The signer types their own name and confirms they intend to sign. A member
 * acknowledges receipt — never agreement — or refuses with a reason; either
 * finalizes the evaluation. The server checks the name and asks the shared
 * client for step-up re-verification before it records anything.
 */
import React, { useEffect, useState } from 'react';
import { Modal } from '../../../../components/Modal';
import { FormField } from '../../../../components/ux/FormField';
import { useDiscardGuard } from '../../../../hooks/useDiscardGuard';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../../utils/serverFieldErrors';
import type { SignatureDisposition, SignatureWrite, SigningOption } from '../../types/evaluations';

interface SignDialogProps {
  option: SigningOption | null;
  signerName: string;
  busy: boolean;
  onClose: () => void;
  /** Records the signature; a 422 the page rethrows is shown on its field here. */
  onSign: (signature: SignatureWrite) => Promise<void> | void;
}

type SignField = 'reason' | 'name' | 'intent';

/** SignatureWrite in schemas/evaluation.py (snake_case). */
const SIGN_FIELDS: Record<SignField, ServerFieldSpec> = {
  reason: { label: 'Reason for refusing', maxLength: 2000, api: 'comment' },
  name: { label: 'Your full name', maxLength: 200, api: 'signed_name' },
  intent: { label: 'Intent to sign', api: 'intent_confirmed' },
};

/** In the order they appear, so the first failing one takes focus. */
const SIGN_FIELD_IDS: Record<SignField, string> = { reason: 'sign-reason', name: 'sign-name', intent: 'sign-intent' };

const CHOICES: Record<SignatureDisposition, { label: string; help: string }> = {
  signed: { label: 'Sign', help: 'Your signature approves the evaluation as written.' },
  acknowledged: {
    label: 'Acknowledge receipt',
    help: 'You have received and read this evaluation. Acknowledging does not mean you agree with it.',
  },
  refused: {
    label: 'Refuse to sign',
    help: 'Your refusal and your reason are recorded with the evaluation, which is still finalized.',
  },
};

export const SignDialog: React.FC<SignDialogProps> = ({ option, signerName, busy, onClose, onSign }) => {
  const [disposition, setDisposition] = useState<SignatureDisposition>('signed');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [intent, setIntent] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<SignField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Reset on each open, so a reason typed for one step is not carried to the next.
  useEffect(() => {
    if (option) {
      setDisposition(option.dispositions[0] ?? 'signed');
      setName('');
      setReason('');
      setIntent(false);
      setErrors({});
      setFormError(null);
    }
  }, [option]);

  const refusing = disposition === 'refused';

  // A typed name or reason is asked about before Escape, the X or Cancel drops
  // it; called here rather than given to Modal so Cancel asks too.
  const requestClose = useDiscardGuard({ isDirty: name.trim() !== '' || reason.trim() !== '', onClose });
  const clearError = (field: SignField) => setErrors((prev) => ({ ...prev, [field]: undefined }));

  const showErrors = (next: Partial<Record<SignField, string>>) => {
    setErrors(next);
    const first = (Object.keys(SIGN_FIELD_IDS) as SignField[]).find((field) => next[field]);
    if (first) window.setTimeout(() => document.getElementById(SIGN_FIELD_IDS[first])?.focus(), 0);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const refused: Partial<Record<SignField, string>> = {};
    if (refusing && !reason.trim()) refused.reason = 'Say why you are refusing to sign.';
    if (!name.trim()) refused.name = 'Type your full name to sign.';
    if (!intent) refused.intent = 'Confirm that the typed name is your signature.';
    if (Object.keys(refused).length > 0) {
      showErrors(refused);
      return;
    }
    setErrors({});
    setFormError(null);
    try {
      await onSign({
        signed_name: name.trim(),
        disposition,
        comment: refusing ? reason.trim() : undefined,
        intent_confirmed: true,
      });
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, SIGN_FIELDS);
      if (!mapped) return;
      showErrors(mapped.fieldErrors);
      if (mapped.unmatched.length) setFormError(mapped.unmatched.join(' '));
    }
  };

  return (
    <Modal
      isOpen={option !== null}
      onClose={requestClose}
      title={option ? option.label : 'Sign'}
      noValidate
      onSubmit={(e) => void submit(e)}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={requestClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {CHOICES[disposition].label}
          </button>
        </div>
      }
    >
      {option && (
        <div className="space-y-4">
          {formError && (
            <p role="alert" className="alert-danger text-theme-text-primary text-sm">
              {formError}
            </p>
          )}
          {option.dispositions.length > 1 ? (
            <fieldset>
              <legend className="form-label">Your response</legend>
              <div className="grid gap-2">
                {option.dispositions.map((choice) => (
                  <label
                    key={choice}
                    className="card-secondary touch:min-h-11 flex cursor-pointer items-start gap-2 p-2 text-sm"
                  >
                    <input
                      type="radio"
                      className="mt-1"
                      name="disposition"
                      checked={disposition === choice}
                      onChange={() => setDisposition(choice)}
                    />
                    <span>
                      <span className="text-theme-text-primary font-medium">{CHOICES[choice].label}</span>
                      <span className="text-theme-text-secondary block">{CHOICES[choice].help}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <p className="text-theme-text-secondary text-sm">{CHOICES[disposition].help}</p>
          )}

          {refusing && (
            <FormField
              label="Reason for refusing"
              required
              id={SIGN_FIELD_IDS.reason}
              error={errors.reason}
              maxLength={2000}
              count={reason.length}
            >
              {(field) => (
                <textarea
                  {...field}
                  className="form-input"
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    clearError('reason');
                  }}
                />
              )}
            </FormField>
          )}

          <FormField
            label="Type your full name to sign"
            required
            id={SIGN_FIELD_IDS.name}
            error={errors.name}
            maxLength={200}
            count={name.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                className="form-input font-serif text-lg italic"
                autoComplete="name"
                placeholder={signerName}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearError('name');
                }}
              />
            )}
          </FormField>

          <div>
            <label className="touch:min-h-11 flex items-start gap-2 text-sm">
              <input
                id={SIGN_FIELD_IDS.intent}
                type="checkbox"
                className="form-checkbox mt-1"
                checked={intent}
                aria-required="true"
                aria-invalid={errors.intent ? true : undefined}
                aria-describedby={errors.intent ? 'sign-intent-error' : undefined}
                onChange={(e) => {
                  setIntent(e.target.checked);
                  clearError('intent');
                }}
              />
              <span className="text-theme-text-primary">
                I intend this typed name to be my signature. You may be asked to confirm your identity.
              </span>
            </label>
            {errors.intent && (
              <p id="sign-intent-error" className="mt-1 text-sm text-red-800 dark:text-red-300">
                {errors.intent}
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
};
