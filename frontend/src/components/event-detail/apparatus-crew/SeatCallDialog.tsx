/**
 * Email the chosen members about the open seats on this night's whole run.
 *
 * One email lists every upcoming night of the run that still has a seat a
 * member can take, so it is offered once per run, not once per night. Send is
 * held until the count is in and is not zero: a send to nobody is refused by
 * the server anyway, and a coordinator should see that before pressing it.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Send } from 'lucide-react';
import { Modal } from '../../Modal';
import MemberAudiencePicker from '../../member-audience/MemberAudiencePicker';
import { apparatusEventService } from '../../../services/api';
import type { SeatCallResult } from '../../../types/apparatusEvent';
import { EMPTY_AUDIENCE, type MemberAudienceChoice } from '../../../types/memberAudience';
import { getErrorMessage } from '../../../utils/errorHandling';

interface SeatCallDialogProps {
  /** The night whose run is emailed about; null when closed. */
  eventId: string | null;
  runTitle: string;
  onClose: () => void;
  onSent: (result: SeatCallResult) => void;
}

export const SeatCallDialog: React.FC<SeatCallDialogProps> = ({ eventId, runTitle, onClose, onSent }) => {
  const [choice, setChoice] = useState<MemberAudienceChoice>(EMPTY_AUDIENCE);
  const [message, setMessage] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  // A fresh choice each time it opens, so one run's audience is not sent to
  // for the next by accident.
  useEffect(() => {
    if (!eventId) return;
    setChoice(EMPTY_AUDIENCE);
    setMessage('');
    setCount(null);
  }, [eventId]);

  if (!eventId) return null;

  const send = async () => {
    setSending(true);
    try {
      const result = await apparatusEventService.sendSeatCall(eventId, {
        ...choice,
        message: message.trim() || undefined,
      });
      toast.success(result.message);
      onSent(result);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not email the members.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Email members about open seats"
      size="lg"
      isDirty={message.trim() !== '' || choice !== EMPTY_AUDIENCE}
      footer={
        <>
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2"
            disabled={sending || !count}
            onClick={() => void send()}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {sending ? 'Sending…' : 'Send email'}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={sending}>
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-theme-text-secondary text-sm">
          One email lists every upcoming night of <strong>{runTitle}</strong> that still has a seat members can take,
          with a link to each. Nights that are full, have started, or take no self sign-ups are left out.
        </p>
        <MemberAudiencePicker value={choice} onChange={setChoice} onCount={setCount} />
        <div>
          <label className="form-label" htmlFor="seat-call-message">
            Note (optional)
          </label>
          <textarea
            id="seat-call-message"
            className="form-input text-sm"
            rows={3}
            maxLength={2000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Santa's suit is in the Station 1 closet."
          />
        </div>
      </div>
    </Modal>
  );
};

export default SeatCallDialog;
