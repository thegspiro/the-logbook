/**
 * Sign the adopted minutes in one slot.
 *
 * Signing is a person attesting that this version is a true record, so it asks
 * for more than a click: the signer types their name as it stands on their
 * account and confirms their password. The password goes to the server to be
 * checked and is cleared from the screen whether or not it was right.
 */

import React, { useEffect, useState } from 'react';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { minutesService } from '../services/api';

type SignField = 'name' | 'password';

/** SignRequest in schemas/minute.py. */
const SIGN_FIELDS: Record<SignField, ServerFieldSpec> = {
  name: { label: 'Your full name', maxLength: 200, api: 'signed_name' },
  password: { label: 'Password', maxLength: 1000 },
};

const SIGN_FIELD_IDS: Record<SignField, string> = { name: 'sign-name', password: 'sign-password' };

interface SignDialogProps {
  isOpen: boolean;
  minutesId: string;
  minutesTitle: string;
  slotKey: string;
  slotTitle: string;
  onClose: () => void;
  onSigned: () => Promise<void> | void;
}

export const SignDialog: React.FC<SignDialogProps> = ({
  isOpen,
  minutesId,
  minutesTitle,
  slotKey,
  slotTitle,
  onClose,
  onSigned,
}) => {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<SignField, string | undefined>>>({});

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setPassword('');
    setError(null);
    setErrors({});
  }, [isOpen, slotKey]);

  // A typed name or password is asked about before Escape, the X or Cancel
  // drops it; called here rather than given to Modal so Cancel asks too.
  const requestClose = useDiscardGuard({ isDirty: name.trim() !== '' || password !== '', onClose });

  const showErrors = (next: Partial<Record<SignField, string>>) => {
    setErrors(next);
    const first = (Object.keys(SIGN_FIELD_IDS) as SignField[]).find((field) => next[field]);
    if (first) window.setTimeout(() => document.getElementById(SIGN_FIELD_IDS[first])?.focus(), 0);
  };

  const submit = async () => {
    const refused: Partial<Record<SignField, string>> = {};
    if (!name.trim()) refused.name = 'Type your full name to sign.';
    if (!password) refused.password = 'Confirm your password to sign.';
    if (Object.keys(refused).length > 0) {
      showErrors(refused);
      return;
    }
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await minutesService.sign(minutesId, slotKey, name.trim(), password);
      setPassword('');
      await onSigned();
      onClose();
    } catch (err: unknown) {
      setPassword('');
      const mapped = mapServerFieldErrors(err, SIGN_FIELDS);
      if (mapped) {
        showErrors(mapped.fieldErrors);
        if (mapped.unmatched.length) setError(mapped.unmatched.join(' '));
      } else {
        setError(getErrorMessage(err, 'Failed to sign the minutes'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={`Sign as ${slotTitle}`}
      size="md"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      footer={
        <>
          <button type="button" onClick={requestClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Signing…' : 'Sign the minutes'}
          </button>
        </>
      }
    >
      <p className="text-theme-text-secondary mb-3 text-sm">
        By signing you attest that these adopted minutes of <strong>{minutesTitle}</strong> are a true record of the
        meeting. Your signature is recorded against this version; if the minutes are reopened for a correction, the
        corrected version will need to be signed again.
      </p>
      {error && (
        <p className="alert-danger mb-3 text-sm" role="alert">
          {error}
        </p>
      )}
      <div className="space-y-3">
        <FormField
          label="Type your full name"
          required
          id={SIGN_FIELD_IDS.name}
          error={errors.name}
          hint="As it appears on your account."
          maxLength={200}
          count={name.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((prev) => ({ ...prev, name: undefined }));
              }}
              className="form-input"
            />
          )}
        </FormField>
        <FormField
          label="Confirm your password"
          required
          id={SIGN_FIELD_IDS.password}
          error={errors.password}
          maxLength={1000}
        >
          {(field) => (
            <input
              {...field}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErrors((prev) => ({ ...prev, password: undefined }));
              }}
              className="form-input"
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};

export default SignDialog;
