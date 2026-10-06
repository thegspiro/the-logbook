/**
 * Correct a leave of absence's dates or reason.
 *
 * A leave was created from Waiver Management but its dates could only be
 * changed through the API: a wrong end date quietly changed somebody's
 * compliance until the leave was deactivated and re-created (member
 * lifecycle, KNOWN_LIMITATIONS). The owner chose to put the edit beside where
 * leaves are created, so this dialog opens from the Waiver Management list.
 *
 * Every field the dialog owns is sent on save (Pitfall #1, update path): a
 * permanent leave sends `end_date: null` and an emptied reason sends
 * `reason: null`, so clearing either actually persists.
 */

import React, { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { memberStatusService } from '../../services/api';
import { blankToNull } from '../../utils/formValues';
import { getErrorMessage } from '../../utils/errorHandling';

export interface EditableLeave {
  id: string;
  member_name: string;
  start_date: string;
  end_date: string | null;
  reason: string | null;
}

interface EditLeaveDialogProps {
  leave: EditableLeave | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export const EditLeaveDialog: React.FC<EditLeaveDialogProps> = ({ leave, onClose, onSaved }) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [permanent, setPermanent] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seeded on every open, so a correction typed for one leave cannot be
  // saved against the next.
  useEffect(() => {
    if (!leave) return;
    setStartDate(leave.start_date);
    setEndDate(leave.end_date ?? '');
    setPermanent(leave.end_date === null);
    setReason(leave.reason ?? '');
    setError(null);
  }, [leave]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!leave) return;
    if (!startDate) {
      setError('Enter a start date.');
      return;
    }
    if (!permanent && !endDate) {
      setError('Enter an end date, or tick Permanent.');
      return;
    }
    if (!permanent && endDate < startDate) {
      setError('The end date must be on or after the start date.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await memberStatusService.updateLeaveOfAbsence(leave.id, {
        start_date: startDate,
        end_date: permanent ? null : endDate,
        reason: blankToNull(reason),
      });
      await onSaved();
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not save the leave'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={leave !== null}
      onClose={onClose}
      title={leave ? `Edit leave — ${leave.member_name}` : 'Edit leave'}
      onSubmit={(e) => void handleSubmit(e)}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary btn-md" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            Save leave
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <p role="alert" className="alert-danger text-sm">
            {error}
          </p>
        )}
        <div>
          <label htmlFor="edit-leave-start" className="form-label">
            Start date
          </label>
          <input
            id="edit-leave-start"
            type="date"
            className="form-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="edit-leave-end" className="form-label">
            End date
          </label>
          <input
            id="edit-leave-end"
            type="date"
            className="form-input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            disabled={permanent}
          />
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={permanent}
              onChange={(e) => setPermanent(e.target.checked)}
            />
            <span className="text-theme-text-secondary">Permanent (no end date)</span>
          </label>
        </div>
        <div>
          <label htmlFor="edit-leave-reason" className="form-label">
            Reason (optional)
          </label>
          <textarea
            id="edit-leave-reason"
            className="form-input"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <p className="text-theme-text-muted text-xs">
          Leaves pro-rate training requirements, so a corrected date changes the member&rsquo;s compliance from the next
          check.
        </p>
      </div>
    </Modal>
  );
};

export default EditLeaveDialog;
