/**
 * Issue an NFC ID card to one member.
 *
 * Shared by the member profile's ID Cards panel and the department-wide ID
 * Cards page, so a card is registered the same way — same capture, same
 * validation, same payload — wherever an officer happens to be. The field
 * state resets on every close, so a serial read for one member cannot be
 * filed against the next.
 */

import React, { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { NfcCardCapture } from './NfcCardCapture';
import { nfcCardService } from '../services/nfcCardService';
import { getErrorMessage } from '../../../utils/errorHandling';
import { NfcCredentialType } from '../../../constants/enums';
import { isPlausibleCardSerial } from '../constants/idCards';

interface IssueIdCardDialogProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  /** Shown in the title so an officer can see whose card they are issuing. */
  memberName?: string | null | undefined;
  onIssued: () => void | Promise<void>;
}

export const IssueIdCardDialog: React.FC<IssueIdCardDialogProps> = ({
  isOpen,
  onClose,
  userId,
  memberName,
  onIssued,
}) => {
  const [credential, setCredential] = useState('');
  const [credentialType, setCredentialType] = useState<NfcCredentialType>(NfcCredentialType.SERIAL);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    setCredential('');
    setCredentialType(NfcCredentialType.SERIAL);
    setLabel('');
    setError(null);
    onClose();
  }, [onClose]);

  const handleCapture = useCallback((value: string, type: NfcCredentialType) => {
    setCredential(value);
    setCredentialType(type);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!isPlausibleCardSerial(credential)) {
      setError('No card has been read yet. Write a code to a blank card, tap a printed one, or type its serial.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await nfcCardService.register({
        user_id: userId,
        tag_uid: credential,
        credential_type: credentialType,
        // Create payload: a blank label is omitted rather than sent as "".
        label: label.trim() || undefined,
      });
      toast.success('ID card issued');
      close();
      await onIssued();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to register this card'));
    } finally {
      setSaving(false);
    }
  }, [credential, credentialType, label, userId, close, onIssued]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={memberName ? `Issue an ID card to ${memberName}` : 'Issue an ID card'}
      size="sm"
      footer={
        <>
          <button type="button" onClick={close} className="btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={() => void handleSubmit()} disabled={saving} className="btn-primary">
            {saving ? 'Registering…' : 'Register card'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <NfcCardCapture value={credential} onChange={handleCapture} credentialType={credentialType} error={error} />
        <div>
          <label className="form-label" htmlFor="nfc-card-label">
            Label <span className="text-theme-text-secondary font-normal">(optional)</span>
          </label>
          <input
            id="nfc-card-label"
            type="text"
            className="form-input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Blue ID card"
            maxLength={100}
          />
        </div>
      </div>
    </Modal>
  );
};
