/**
 * Record how the body adopted the minutes: when it voted, at which meeting, and
 * whether as presented or as amended.
 *
 * The meeting is picked from the department's other minutes. Adopting is the
 * secretary recording what the body did at the later meeting, so the vote
 * defaults to now and "as amended" defaults to whether any suggestion was
 * accepted — both of which the adopter can change.
 */

import React, { useEffect, useState } from 'react';
import { Modal } from '../../../components/Modal';
import DateTimeQuarterHour from '../../../components/ux/DateTimeQuarterHour';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatForDateTimeInput, formatDate, localToUTC } from '../../../utils/dateFormatting';
import { minutesService } from '../services/api';
import type { AdoptionDetails, MinutesListItem } from '../types/minutes';

interface AdoptDialogProps {
  isOpen: boolean;
  minutesId: string;
  /** Whether a suggestion was accepted, which sets the default for "as amended". */
  hasAcceptedSuggestions: boolean;
  busy: boolean;
  onClose: () => void;
  onAdopt: (details: AdoptionDetails) => void;
}

export const AdoptDialog: React.FC<AdoptDialogProps> = ({
  isOpen,
  minutesId,
  hasAcceptedSuggestions,
  busy,
  onClose,
  onAdopt,
}) => {
  const tz = useTimezone();
  const [votedAt, setVotedAt] = useState('');
  const [meetingId, setMeetingId] = useState('');
  const [asAmended, setAsAmended] = useState(hasAcceptedSuggestions);
  const [meetings, setMeetings] = useState<MinutesListItem[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setVotedAt(formatForDateTimeInput(new Date().toISOString(), tz));
    setMeetingId('');
    setAsAmended(hasAcceptedSuggestions);
    minutesService
      .listAllMinutes()
      .then((all) => setMeetings(all.filter((m) => m.id !== minutesId)))
      .catch(() => setMeetings([]));
  }, [isOpen, minutesId, hasAcceptedSuggestions, tz]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Adopt these minutes"
      size="md"
      onSubmit={(e) => {
        e.preventDefault();
        onAdopt({
          adopted_on: votedAt ? localToUTC(votedAt, tz) : undefined,
          adopting_minutes_id: meetingId || undefined,
          as_amended: asAmended,
        });
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn-success">
            {busy ? 'Adopting…' : 'Adopt Minutes'}
          </button>
        </>
      }
    >
      <p className="text-theme-text-secondary mb-3 text-sm">
        Once adopted, these minutes are locked. A correction after that means reopening them, and they must be
        circulated and adopted again.
      </p>
      <div className="space-y-3">
        <div>
          <span className="form-label">When the body voted</span>
          <DateTimeQuarterHour value={votedAt} onChange={setVotedAt} timezone={tz} timeLabel="Adoption vote" />
        </div>
        <div>
          <label htmlFor="adopt-meeting" className="form-label">
            At which meeting
          </label>
          <select
            id="adopt-meeting"
            value={meetingId}
            onChange={(e) => setMeetingId(e.target.value)}
            className="form-input"
          >
            <option value="">Not recorded</option>
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} ({formatDate(m.meeting_date, tz)})
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className="form-label">Adopted</legend>
          <label className="mr-4 inline-flex items-center gap-2 text-sm">
            <input type="radio" name="adopt-how" checked={!asAmended} onChange={() => setAsAmended(false)} />
            As presented
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" name="adopt-how" checked={asAmended} onChange={() => setAsAmended(true)} />
            As amended
          </label>
          {hasAcceptedSuggestions && (
            <p className="text-theme-text-muted mt-1 text-xs">
              A suggestion was accepted, so “as amended” is selected.
            </p>
          )}
        </fieldset>
      </div>
    </Modal>
  );
};

export default AdoptDialog;
