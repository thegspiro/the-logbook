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
import { getErrorMessage } from '../../../utils/errorHandling';
import { minutesService } from '../services/api';

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

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setPassword('');
    setError(null);
  }, [isOpen, slotKey]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await minutesService.sign(minutesId, slotKey, name.trim(), password);
      setPassword('');
      await onSigned();
      onClose();
    } catch (err: unknown) {
      setPassword('');
      setError(getErrorMessage(err, 'Failed to sign the minutes'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Sign as ${slotTitle}`}
      size="md"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={busy || !name.trim() || !password} className="btn-primary">
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
        <div>
          <label htmlFor="sign-name" className="form-label">
            Type your full name
          </label>
          <input
            id="sign-name"
            type="text"
            autoComplete="name"
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="form-input"
          />
          <p className="text-theme-text-muted mt-1 text-xs">As it appears on your account.</p>
        </div>
        <div>
          <label htmlFor="sign-password" className="form-label">
            Confirm your password
          </label>
          <input
            id="sign-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="form-input"
          />
        </div>
      </div>
    </Modal>
  );
};

export default SignDialog;
