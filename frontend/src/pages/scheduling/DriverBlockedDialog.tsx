/**
 * Driver Blocked Dialog
 *
 * What an officer sees the moment an assignment is refused because the member
 * lacks the EVOC certification the apparatus requires.
 *
 * A refusal with no route forward is where a safety control turns into a
 * workaround — someone drives anyway and nobody records it. So this does three
 * things a toast cannot: it states what is missing, it names the people who can
 * authorize the exception (resolved from live permissions, not assumed from
 * rank, so it is right in a department that moved the grant), and it offers the
 * request inline, prefilled from the shift.
 *
 * Opened off the `LB-SCHED-001` support code rather than the message text,
 * which would break the moment the wording changed.
 */

import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Check, Loader2, ShieldAlert, UserCheck, X } from 'lucide-react';
import { driverExceptionService } from '../../modules/apparatus/services/api';
import {
  DRIVER_EXCEPTION_REASON_LABELS,
  type DriverExceptionApprover,
  type DriverExceptionCreate,
} from '../../modules/apparatus/types';
import { Modal } from '../../components/Modal';
import { useAuthStore } from '../../stores/authStore';
import { getErrorMessage } from '../../utils/errorHandling';
import { formatCalendarDate } from '../../utils/dateFormatting';
import { useRanks } from '../../hooks/useRanks';

export interface DriverBlockedDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The member who was refused the driver seat. */
  userId: string;
  userName: string;
  /** The shift's apparatus, when it has one — scopes the exception request. */
  apparatusId?: string | undefined;
  apparatusUnitNumber?: string | undefined;
  /** The shift date (YYYY-MM-DD); becomes the exception's validity window. */
  shiftDate: string;
  /** The backend's explanation of what is missing. */
  blockedReason: string;
}

export const DriverBlockedDialog: React.FC<DriverBlockedDialogProps> = ({
  isOpen,
  onClose,
  userId,
  userName,
  apparatusId,
  apparatusUnitNumber,
  shiftDate,
  blockedReason,
}) => {
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const { ranks } = useRanks();

  // Requesting is gated the same way the endpoint is, so the form is absent
  // rather than present-and-failing for a member who cannot raise one.
  const canRequest =
    checkPermission('scheduling.assign') || checkPermission('scheduling.manage') || checkPermission('apparatus.manage');

  const [approvers, setApprovers] = useState<DriverExceptionApprover[]>([]);
  const [loadingApprovers, setLoadingApprovers] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState('parade');
  const [justification, setJustification] = useState('');
  const [restrictions, setRestrictions] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoadingApprovers(true);
    setShowForm(false);
    setReason('parade');
    setJustification('');
    setRestrictions('');
    driverExceptionService
      .approvers()
      .then(setApprovers)
      .catch(() => {
        // Non-critical: the block still stands and the request form still
        // works, the officer just does not get the names.
        setApprovers([]);
      })
      .finally(() => setLoadingApprovers(false));
  }, [isOpen]);

  const rankLabel = useMemo(() => {
    const byCode = new Map(ranks.map((rank) => [rank.rank_code, rank.display_name]));
    return (code: string | null) => (code ? (byCode.get(code) ?? code) : null);
  }, [ranks]);

  const handleRequest = async () => {
    if (!justification.trim()) {
      toast.error('Give a justification — the approver has to weigh it');
      return;
    }
    setSaving(true);
    try {
      // Create payload: blanks omitted so an empty string never reaches a
      // validator. The window is the shift's own day, which is the narrowest
      // grant that solves the problem in front of the officer.
      const payload: DriverExceptionCreate = {
        userId,
        apparatusId: apparatusId || undefined,
        reason,
        justification: justification.trim(),
        restrictions: restrictions.trim() || undefined,
        validFrom: shiftDate,
        validUntil: shiftDate,
      };
      await driverExceptionService.request(payload);
      toast.success('Exception requested — it takes effect only once a chief approves it');
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to request the exception'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Driver qualification required" size="md">
      <div className="modal-body space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-theme-text-primary text-sm font-medium">
              {userName} was not assigned as driver
              {apparatusUnitNumber ? ` of ${apparatusUnitNumber}` : ''}.
            </p>
            <p className="text-theme-text-secondary mt-1 text-sm">{blockedReason}</p>
          </div>
        </div>

        <div>
          <p className="text-theme-text-primary flex items-center gap-1.5 text-sm font-medium">
            <UserCheck className="h-4 w-4" aria-hidden="true" />
            Who can approve an exception
          </p>
          {loadingApprovers ? (
            <div className="py-3" role="status" aria-live="polite">
              <Loader2 className="text-theme-text-muted h-4 w-4 animate-spin" aria-hidden="true" />
            </div>
          ) : approvers.length === 0 ? (
            <p className="text-theme-text-muted mt-1 text-sm">
              Nobody currently holds the approval permission. A system administrator needs to grant &ldquo;Approve
              exceptions to the EVOC driving requirement&rdquo; to a chief before an exception can be approved.
            </p>
          ) : (
            <>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {approvers.map((approver) => (
                  <li
                    key={approver.userId}
                    className="border-theme-surface-border text-theme-text-secondary rounded border px-2 py-1 text-xs"
                  >
                    <span className="font-medium">{approver.userName}</span>
                    {rankLabel(approver.rank) && (
                      <span className="text-theme-text-muted"> · {rankLabel(approver.rank)}</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-theme-text-muted mt-1.5 text-xs">
                Contact them however you normally would — an exception request will not page anyone.
              </p>
            </>
          )}
        </div>

        {canRequest && !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="btn-info inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium"
          >
            Request an exception
          </button>
        )}

        {!canRequest && (
          <p className="text-theme-text-muted text-sm">
            Ask one of the people above, or an officer who can assign shifts, to raise the exception request.
          </p>
        )}

        {canRequest && showForm && (
          <div className="border-theme-surface-border bg-theme-surface-secondary/50 space-y-3 rounded-lg border p-3">
            <p className="text-theme-text-muted text-xs">
              This covers {userName}
              {apparatusUnitNumber ? ` on ${apparatusUnitNumber}` : ''} for {formatCalendarDate(shiftDate)} only. It
              grants nothing until a chief other than you approves it.
            </p>

            <div>
              <label htmlFor="blocked-reason" className="form-label">
                Reason
              </label>
              <select
                id="blocked-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="form-input"
              >
                {Object.entries(DRIVER_EXCEPTION_REASON_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="blocked-justification" className="form-label">
                Justification
              </label>
              <textarea
                id="blocked-justification"
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Why this member, on this apparatus, for this shift"
                className="form-input"
              />
            </div>

            <div>
              <label htmlFor="blocked-restrictions" className="form-label">
                Operating restrictions
              </label>
              <input
                id="blocked-restrictions"
                type="text"
                value={restrictions}
                onChange={(e) => setRestrictions(e.target.value)}
                maxLength={1000}
                placeholder="e.g. Parade route only, no emergency response"
                className="form-input"
              />
            </div>

            <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>The member stays off this shift as driver until the exception is approved.</span>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleRequest();
                }}
                disabled={saving}
                className="btn-info inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Submit request
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default DriverBlockedDialog;
