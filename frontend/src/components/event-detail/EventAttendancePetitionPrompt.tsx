/**
 * "I was there" — a member asks to be marked present after the fact.
 *
 * For an event whose check-in has closed, a member with no check-in (a dead
 * phone, no signal, a QR code nobody put up) sends the organizer a request,
 * which they confirm or reject. Whether a request can be made at all — the
 * 30-day window, already being recorded present, an earlier request — is the
 * server's decision (`can_request`), so this renders exactly what the API
 * would accept rather than re-deriving the rules.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Hand } from 'lucide-react';
import { Modal } from '../Modal';
import DateTimeQuarterHour from '../ux/DateTimeQuarterHour';
import { eventService } from '../../services/api';
import { useConfirm } from '../../contexts/ConfirmContext';
import { AttendancePetitionStatus } from '../../constants/enums';
import type { MyAttendancePetition } from '../../types/event';
import { formatDateTime, localToUTC } from '../../utils/dateFormatting';
import { getErrorDetail } from '../../utils/errorHandling';

interface EventAttendancePetitionPromptProps {
  eventId: string;
  timezone: string;
}

const REASON_MAX_LENGTH = 1000;

export const EventAttendancePetitionPrompt: React.FC<EventAttendancePetitionPromptProps> = ({ eventId, timezone }) => {
  const [standing, setStanding] = useState<MyAttendancePetition | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState('');
  const [arrivedAt, setArrivedAt] = useState('');
  const [leftAt, setLeftAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const { confirm } = useConfirm();

  const loadStanding = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      try {
        const result = await eventService.getMyAttendancePetition(eventId);
        if (!isCancelled()) setStanding(result);
      } catch {
        // Non-critical: without an answer the page simply offers nothing,
        // rather than a button the server may refuse.
        if (!isCancelled()) setStanding(null);
      }
    },
    [eventId]
  );

  useEffect(() => {
    let cancelled = false;
    void loadStanding(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadStanding]);

  const handleWithdraw = async () => {
    const confirmed = await confirm({
      title: 'Withdraw your request?',
      message:
        'The organizer will no longer be asked to mark you present. You can send a new request afterwards if you still need one.',
      confirmLabel: 'Withdraw request',
      cancelLabel: 'Keep it',
      variant: 'warning',
    });
    if (!confirmed) return;
    setWithdrawing(true);
    try {
      await eventService.withdrawAttendancePetition(eventId);
      toast.success('Request withdrawn');
    } catch (err) {
      toast.error(getErrorDetail(err) || 'Failed to withdraw your request');
    } finally {
      setWithdrawing(false);
    }
    // Either way the server's answer replaces ours: after a refusal the
    // request may have been decided in the meantime.
    await loadStanding();
  };

  const openForm = () => {
    setReason('');
    setArrivedAt('');
    setLeftAt('');
    setFormError(null);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setFormError('Say briefly why you have no check-in.');
      return;
    }
    const requestedIn = localToUTC(arrivedAt, timezone) || undefined;
    const requestedOut = localToUTC(leftAt, timezone) || undefined;
    if (requestedIn && requestedOut && new Date(requestedOut) <= new Date(requestedIn)) {
      setFormError('The time you left must be after the time you arrived.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const petition = await eventService.submitAttendancePetition(eventId, {
        reason: trimmed,
        requested_check_in_at: requestedIn,
        requested_check_out_at: requestedOut,
      });
      setStanding({ petition, can_request: false, unavailable_reason: null });
      setShowForm(false);
      toast.success('Request sent to the event organizer');
      // Only the server knows how many withdrawals this request has left.
      void loadStanding();
    } catch (err) {
      setFormError(getErrorDetail(err) || 'Failed to send your request');
    } finally {
      setSubmitting(false);
    }
  };

  const petition = standing?.petition ?? null;

  if (petition) {
    const reviewer = petition.reviewed_by_name || 'the event organizer';
    if (petition.status === AttendancePetitionStatus.PENDING) {
      return (
        <div
          className="alert-info flex flex-col gap-3 rounded-lg p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
          role="status"
        >
          <span>
            You asked to be marked present on {formatDateTime(petition.created_at, timezone)}. The event organizer has
            been notified and will confirm or decline it.
            {/* The server caps withdrawals, so a request cannot be cycled to
                re-notify the organizer; past the cap this one is final. */}
            {standing?.can_withdraw === false && (
              <span className="mt-1 block">You have withdrawn this request as many times as allowed.</span>
            )}
          </span>
          {standing?.can_withdraw && (
            <button
              type="button"
              onClick={() => void handleWithdraw()}
              disabled={withdrawing}
              className="btn-secondary shrink-0 text-sm font-medium disabled:opacity-50"
            >
              {withdrawing ? 'Withdrawing...' : 'Withdraw request'}
            </button>
          )}
        </div>
      );
    }
    if (petition.status === AttendancePetitionStatus.APPROVED) {
      return (
        <div className="alert-success rounded-lg p-4 text-sm" role="status">
          Your attendance was confirmed by {reviewer}.
          {petition.review_note && <span className="mt-1 block">Note: {petition.review_note}</span>}
        </div>
      );
    }
    return (
      <div className="alert-warning rounded-lg p-4 text-sm" role="status">
        Your request to be marked present was not approved by {reviewer}.
        {petition.review_note && <span className="mt-1 block">Reason: {petition.review_note}</span>}
      </div>
    );
  }

  if (!standing?.can_request) return null;

  return (
    <>
      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-theme-text-secondary text-sm">
          Were you at this event but never checked in? Ask the organizer to mark you present.
        </p>
        <button
          type="button"
          onClick={openForm}
          className="btn-secondary inline-flex shrink-0 items-center gap-2 text-sm font-medium"
        >
          <Hand className="h-4 w-4" aria-hidden="true" />I was there
        </button>
      </div>

      {showForm && (
        <Modal
          isOpen
          onClose={() => setShowForm(false)}
          title="Ask to be marked present"
          titleId="attendance-petition-title"
          aria-describedby="attendance-petition-description"
          onSubmit={(e) => void handleSubmit(e)}
          footer={
            <>
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary inline-flex w-full justify-center rounded-md text-base font-medium sm:ml-3 sm:w-auto sm:text-sm"
              >
                {submitting ? 'Sending...' : 'Send request'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="btn-secondary text-theme-text-secondary mt-3 inline-flex w-full justify-center text-base font-medium shadow-xs sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
              >
                Cancel
              </button>
            </>
          }
        >
          <p id="attendance-petition-description" className="text-theme-text-secondary mb-4 text-sm">
            The event organizer will be notified and can confirm your attendance or decline the request. You can
            withdraw it while it is waiting; once it has been decided, the decision stands.
          </p>

          {formError && (
            <div className="alert-danger mb-4 rounded-lg p-3 text-sm" role="alert">
              {formError}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="attendance-petition-reason" className="form-label">
                Why is there no check-in?
              </label>
              <textarea
                id="attendance-petition-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={REASON_MAX_LENGTH}
                rows={3}
                required
                className="form-input mt-1"
                placeholder="e.g. My phone died before I could scan the QR code"
              />
            </div>
            <div>
              <label htmlFor="attendance-petition-arrived" className="form-label">
                When did you arrive? <span className="text-theme-text-muted font-normal">(optional)</span>
              </label>
              <DateTimeQuarterHour
                id="attendance-petition-arrived"
                value={arrivedAt}
                onChange={setArrivedAt}
                timezone={timezone}
                timeLabel="Arrival time"
                className="form-input mt-1"
              />
            </div>
            <div>
              <label htmlFor="attendance-petition-left" className="form-label">
                When did you leave? <span className="text-theme-text-muted font-normal">(optional)</span>
              </label>
              <DateTimeQuarterHour
                id="attendance-petition-left"
                value={leftAt}
                onChange={setLeftAt}
                timezone={timezone}
                timeLabel="Departure time"
                className="form-input mt-1"
              />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};

export default EventAttendancePetitionPrompt;
