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
import type { SignatureDisposition, SignatureWrite, SigningOption } from '../../types/evaluations';

interface SignDialogProps {
  option: SigningOption | null;
  signerName: string;
  busy: boolean;
  onClose: () => void;
  onSign: (signature: SignatureWrite) => void;
}

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

  // Reset on each open, so a reason typed for one step is not carried to the next.
  useEffect(() => {
    if (option) {
      setDisposition(option.dispositions[0] ?? 'signed');
      setName('');
      setReason('');
      setIntent(false);
    }
  }, [option]);

  const refusing = disposition === 'refused';
  const ready = name.trim().length > 0 && intent && (!refusing || reason.trim().length > 0);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    onSign({
      signed_name: name.trim(),
      disposition,
      comment: refusing ? reason.trim() : undefined,
      intent_confirmed: true,
    });
  };

  return (
    <Modal
      isOpen={option !== null}
      onClose={onClose}
      title={option ? option.label : 'Sign'}
      onSubmit={submit}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !ready}>
            {CHOICES[disposition].label}
          </button>
        </div>
      }
    >
      {option && (
        <div className="space-y-4">
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
            <div>
              <label htmlFor="sign-reason" className="form-label">
                Reason for refusing (required)
              </label>
              <textarea
                id="sign-reason"
                className="form-input"
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}

          <div>
            <label htmlFor="sign-name" className="form-label">
              Type your full name to sign
            </label>
            <input
              id="sign-name"
              className="form-input font-serif text-lg italic"
              autoComplete="name"
              maxLength={200}
              placeholder={signerName}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <label className="touch:min-h-11 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox mt-1"
              checked={intent}
              onChange={(e) => setIntent(e.target.checked)}
            />
            <span className="text-theme-text-primary">
              I intend this typed name to be my signature. You may be asked to confirm your identity.
            </span>
          </label>
        </div>
      )}
    </Modal>
  );
};
