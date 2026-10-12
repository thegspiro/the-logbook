/**
 * Undo a mistaken drop (W15-3).
 *
 * Shown on a dropped member's profile to members.manage holders while the
 * server says the drop can still be undone (a week). Undoing restores the
 * member and reopens the service stint the drop closed, as if it had not
 * happened — unlike a status change back to Active, which records a rejoin
 * with a gap. The window and the rule are the server's; this only asks.
 */

import React, { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { undoDropService, type UndoDropAvailability, type UndoDropRestoreStatus } from '../../services/undoDropService';
import { useConfirm } from '../../contexts/ConfirmContext';
import { formatDateTime } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

interface UndoDropControlProps {
  userId: string;
  memberName: string;
  tz: string;
  onUndone: () => void | Promise<void>;
}

const RESTORE_OPTIONS: { value: UndoDropRestoreStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'probationary', label: 'Probationary' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'leave', label: 'On Leave' },
];

export const UndoDropControl: React.FC<UndoDropControlProps> = ({ userId, memberName, tz, onUndone }) => {
  const { confirm } = useConfirm();
  const [availability, setAvailability] = useState<UndoDropAvailability | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<UndoDropRestoreStatus>('active');
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    undoDropService
      .getAvailability(userId)
      .then((result) => {
        if (!cancelled) setAvailability(result);
      })
      .catch(() => {
        // Not offered when the server cannot say it is allowed.
        if (!cancelled) setAvailability(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!availability?.available) return null;

  const restoreLabel = RESTORE_OPTIONS.find((o) => o.value === restoreStatus)?.label ?? 'Active';

  const handleUndo = async () => {
    const ok = await confirm({
      title: 'Undo this drop?',
      message: `${memberName} goes back to ${restoreLabel} and their service continues as if the drop had not happened, with no gap. If they really left and have come back, keep the drop and change their status instead, which records the rejoin.`,
      confirmLabel: 'Undo drop',
      cancelLabel: 'Keep the drop',
      variant: 'warning',
    });
    if (!ok) return;
    setWorking(true);
    try {
      await undoDropService.undoDrop(userId, {
        restore_status: restoreStatus,
        reason: reason.trim() || undefined,
      });
      toast.success('Drop undone');
      await onUndone();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not undo the drop'));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="alert-warning mt-3 space-y-2 text-sm" data-testid="undo-drop">
      <p>
        Dropped by mistake? You can undo this drop until{' '}
        {availability.available_until ? formatDateTime(availability.available_until, tz) : 'the end of the week'}.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="undo-drop-status" className="form-label">
            Restore as
          </label>
          <select
            id="undo-drop-status"
            className="form-input"
            value={restoreStatus}
            onChange={(e) => setRestoreStatus(e.target.value as UndoDropRestoreStatus)}
            disabled={working}
          >
            {RESTORE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-1">
          <label htmlFor="undo-drop-reason" className="form-label">
            Reason (optional)
          </label>
          <input
            id="undo-drop-reason"
            className="form-input"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            disabled={working}
          />
        </div>
        <button type="button" className="btn-primary" onClick={() => void handleUndo()} disabled={working}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Undo drop
        </button>
      </div>
    </div>
  );
};

export default UndoDropControl;
