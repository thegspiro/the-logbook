/**
 * "Request to be excused" on a training session's page.
 *
 * Whether the member may ask is the server's answer (`GET .../eligibility`),
 * never worked out here (CLAUDE.md pitfall #29): it alone knows which
 * attendance requirements grade this member, whether they checked in, the
 * deadline and the cap. The card offers the button when the answer allows it,
 * shows the request once there is one, and otherwise says nothing unless the
 * refusal is one the member could act on or would want to know about.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarX } from 'lucide-react';
import { attendanceWaiverService } from '../../services/attendanceWaiverService';
import { useConfirm } from '../../contexts/ConfirmContext';
import { AttendanceWaiverStatus } from '../../constants/enums';
import type { AttendanceWaiverEligibility, AttendanceWaiverRequest } from '../../types/attendanceWaiver';
import { formatDateTime } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { capSummary, latestDecisionNote } from '../../utils/attendanceWaivers';
import AttendanceWaiverRequestDialog from './AttendanceWaiverRequestDialog';

/**
 * Refusals worth telling the member about: the session does count against
 * them, but they can no longer ask. The others (the department takes no
 * requests, the session does not count, the member is exempt) mean there is
 * nothing to excuse, and a notice would only be noise on the page.
 * `no_decider` is the Chief's or President's own request while the other
 * office is vacant and no alternate is named: they can fix it by asking.
 */
const SHOWN_REFUSALS: ReadonlySet<string> = new Set(['checked_in', 'deadline_passed', 'no_waivers_left', 'no_decider']);

interface AttendanceWaiverCardProps {
  eventId: string;
  eventTitle: string;
  timezone: string;
}

export const AttendanceWaiverCard: React.FC<AttendanceWaiverCardProps> = ({ eventId, eventTitle, timezone }) => {
  const [eligibility, setEligibility] = useState<AttendanceWaiverEligibility | null>(null);
  const [request, setRequest] = useState<AttendanceWaiverRequest | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const { confirm } = useConfirm();

  const load = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      try {
        const answer = await attendanceWaiverService.getEligibility(eventId);
        const existing = answer.existing_request_id
          ? await attendanceWaiverService.get(answer.existing_request_id)
          : null;
        if (isCancelled()) return;
        setEligibility(answer);
        setRequest(existing);
      } catch {
        // Non-critical: with no answer the page offers nothing rather than a
        // button the server may refuse.
        if (isCancelled()) return;
        setEligibility(null);
        setRequest(null);
      }
    },
    [eventId]
  );

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleSubmitted = (created: AttendanceWaiverRequest) => {
    setRequest(created);
    setShowDialog(false);
    toast.success('Request sent');
    void load();
  };

  const handleWithdraw = async () => {
    if (!request) return;
    const confirmed = await confirm({
      title: 'Withdraw your request?',
      message:
        'The officers will no longer be asked to excuse you from this session. You can ask again before the deadline.',
      confirmLabel: 'Withdraw request',
      cancelLabel: 'Keep it',
      variant: 'warning',
    });
    if (!confirmed) return;
    setWithdrawing(true);
    try {
      await attendanceWaiverService.withdraw(request.id);
      toast.success('Request withdrawn');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Your request could not be withdrawn'));
    } finally {
      setWithdrawing(false);
    }
    // The server's answer replaces ours either way: after a refusal the
    // request may have been decided in the meantime.
    await load();
  };

  if (request && request.status === AttendanceWaiverStatus.PENDING) {
    return (
      <div className="split-row alert-info gap-3 rounded-lg p-4 text-sm sm:items-center" role="status">
        <span className="split-row-main">
          You asked to be excused from this session on {formatDateTime(request.submitted_at, timezone)}. It is waiting
          for a decision.
        </span>
        {request.can_withdraw && (
          <button
            type="button"
            onClick={() => void handleWithdraw()}
            disabled={withdrawing}
            className="split-row-aside btn-secondary text-sm font-medium disabled:opacity-50"
          >
            {withdrawing ? 'Withdrawing...' : 'Withdraw request'}
          </button>
        )}
      </div>
    );
  }

  if (request && request.status === AttendanceWaiverStatus.APPROVED) {
    const note = latestDecisionNote(request.actions);
    return (
      <div className="alert-success rounded-lg p-4 text-sm" role="status">
        You are excused from this session
        {request.decided_by_name ? `, approved by ${request.decided_by_name}` : ''}
        {request.chief_override ? ' on a Chief override' : ''}. It does not count toward your attendance requirement.
        {note && <span className="mt-1 block">Note: {note}</span>}
      </div>
    );
  }

  if (request && request.status === AttendanceWaiverStatus.DENIED) {
    const note = latestDecisionNote(request.actions);
    return (
      <div className="alert-warning rounded-lg p-4 text-sm" role="status">
        Your request to be excused from this session was not approved
        {request.decided_by_name ? ` by ${request.decided_by_name}` : ''}. The session still counts toward your
        attendance requirement.
        {note && <span className="mt-1 block">Reason: {note}</span>}
      </div>
    );
  }

  if (!eligibility) return null;

  if (!eligibility.allowed) {
    if (!eligibility.refusal || !SHOWN_REFUSALS.has(eligibility.refusal_code ?? '')) return null;
    return (
      <div className="card text-theme-text-secondary p-4 text-sm" role="status">
        {eligibility.refusal}
      </div>
    );
  }

  const cap = capSummary(eligibility);

  return (
    <>
      <div className="split-row card gap-3 p-4 sm:items-center">
        <div className="split-row-main text-theme-text-secondary space-y-1 text-sm">
          <p>This session counts toward your attendance requirement. Can&apos;t make it? Ask to be excused.</p>
          {eligibility.deadline && <p>Ask by {formatDateTime(eligibility.deadline, timezone)}.</p>}
          {cap && <p>{cap}</p>}
        </div>
        <button
          type="button"
          onClick={() => setShowDialog(true)}
          className="split-row-aside btn-secondary inline-flex shrink-0 items-center gap-2 text-sm font-medium"
        >
          <CalendarX className="h-4 w-4" aria-hidden="true" />
          Request to be excused
        </button>
      </div>

      {showDialog && (
        <AttendanceWaiverRequestDialog
          eventTitle={eventTitle}
          eligibility={eligibility}
          timezone={timezone}
          onClose={() => setShowDialog(false)}
          onSubmitted={handleSubmitted}
        />
      )}
    </>
  );
};

export default AttendanceWaiverCard;
