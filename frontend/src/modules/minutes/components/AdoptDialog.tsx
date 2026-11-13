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
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatForDateTimeInput, formatDate, localToUTC } from '../../../utils/dateFormatting';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { minutesService } from '../services/api';
import { PersonPicker } from './PersonPicker';
import type { AdoptionDetails, AdoptionProposal, AttendeeEntry, MinutesListItem } from '../types/minutes';

type AdoptField = 'votedAt' | 'meetingId' | 'asAmended' | 'movedBy' | 'secondedBy';

/** MinutesAdopt in schemas/minute.py (snake_case). */
const ADOPT_FIELDS: Record<AdoptField, ServerFieldSpec> = {
  votedAt: { label: 'When the body voted', api: 'adopted_on' },
  meetingId: { label: 'At which meeting', api: 'adopting_minutes_id' },
  asAmended: { label: 'Adopted', api: 'as_amended' },
  movedBy: { label: 'Moved by', maxLength: 200, api: 'moved_by' },
  secondedBy: { label: 'Seconded by', maxLength: 200, api: 'seconded_by' },
};

/** In the order they appear, so the first failing one takes focus. */
const ADOPT_FIELD_IDS: Record<AdoptField, string> = {
  votedAt: 'adopt-voted-at',
  meetingId: 'adopt-meeting',
  asAmended: 'adopt-how-presented',
  movedBy: 'adopt-moved-by',
  secondedBy: 'adopt-seconded-by',
};

interface AdoptDialogProps {
  isOpen: boolean;
  minutesId: string;
  /** Whether a suggestion was accepted, which sets the default for "as amended". */
  hasAcceptedSuggestions: boolean;
  /** What a later meeting's passed acceptance motion implies; fills the form in. */
  proposal?: AdoptionProposal | null;
  /** The roll of these minutes, which the mover and seconder are chosen from. */
  attendees: AttendeeEntry[];
  busy: boolean;
  onClose: () => void;
  /**
   * Adopts the minutes. A rejection the dialog can place on a field (a 422) is
   * rethrown by the page and shown there; anything else the page reports.
   */
  onAdopt: (details: AdoptionDetails) => Promise<void> | void;
}

interface AdoptValues {
  votedAt: string;
  meetingId: string;
  asAmended: boolean;
  movedBy: string;
  secondedBy: string;
}

export const AdoptDialog: React.FC<AdoptDialogProps> = ({
  isOpen,
  minutesId,
  hasAcceptedSuggestions,
  proposal = null,
  attendees,
  busy,
  onClose,
  onAdopt,
}) => {
  const tz = useTimezone();
  const [votedAt, setVotedAt] = useState('');
  const [meetingId, setMeetingId] = useState('');
  const [asAmended, setAsAmended] = useState(hasAcceptedSuggestions);
  const [meetings, setMeetings] = useState<MinutesListItem[]>([]);
  const [movedBy, setMovedBy] = useState('');
  const [secondedBy, setSecondedBy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<AdoptField, string>>>({});
  const [initial, setInitial] = useState<AdoptValues | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    // Filled in from the meeting that accepted these minutes, when there was one;
    // otherwise the vote defaults to now and the rest starts blank.
    const seeded: AdoptValues = {
      votedAt: formatForDateTimeInput(proposal?.adopted_on ?? new Date().toISOString(), tz),
      meetingId: proposal?.adopting_minutes_id ?? '',
      asAmended: proposal ? proposal.as_amended : hasAcceptedSuggestions,
      movedBy: proposal?.moved_by ?? '',
      secondedBy: proposal?.seconded_by ?? '',
    };
    setVotedAt(seeded.votedAt);
    setMeetingId(seeded.meetingId);
    setAsAmended(seeded.asAmended);
    setMovedBy(seeded.movedBy);
    setSecondedBy(seeded.secondedBy);
    setInitial(seeded);
    setError(null);
    setErrors({});
    minutesService
      .listAllMinutes()
      .then((all) => setMeetings(all.filter((m) => m.id !== minutesId)))
      .catch(() => setMeetings([]));
  }, [isOpen, minutesId, hasAcceptedSuggestions, proposal, tz]);

  // Anything changed from what the dialog opened with is asked about before
  // Escape, the X or Cancel drops it.
  const isDirty =
    initial !== null &&
    (votedAt !== initial.votedAt ||
      meetingId !== initial.meetingId ||
      asAmended !== initial.asAmended ||
      movedBy !== initial.movedBy ||
      secondedBy !== initial.secondedBy);
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const showErrors = (next: Partial<Record<AdoptField, string>>) => {
    setErrors(next);
    const first = (Object.keys(ADOPT_FIELD_IDS) as AdoptField[]).find((field) => next[field]);
    if (first) window.setTimeout(() => document.getElementById(ADOPT_FIELD_IDS[first])?.focus(), 0);
  };
  const clearError = (field: AdoptField) => setErrors((prev) => ({ ...prev, [field]: undefined }));

  // Adopting is the approve step of a draft-then-approve record, so a refusal
  // stops it (owner rule of 2026-11-05) and stays on the field it is about.
  const submit = async () => {
    const mover = movedBy.trim();
    const seconder = secondedBy.trim();
    if (mover && mover.toLowerCase() === seconder.toLowerCase()) {
      showErrors({ secondedBy: 'The person who moved cannot also second.' });
      return;
    }
    setError(null);
    setErrors({});
    try {
      await onAdopt({
        adopted_on: votedAt ? localToUTC(votedAt, tz) : undefined,
        adopting_minutes_id: meetingId || undefined,
        as_amended: asAmended,
        moved_by: mover || undefined,
        seconded_by: seconder || undefined,
      });
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, ADOPT_FIELDS);
      if (!mapped) return;
      showErrors(mapped.fieldErrors);
      if (mapped.unmatched.length) setError(mapped.unmatched.join(' '));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title="Adopt these minutes"
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
      {proposal && (
        <p className="alert-info mb-3 text-sm" role="status">
          Filled in from the motion recorded at {proposal.adopting_minutes_title}. Check it, then adopt.
        </p>
      )}
      {error && (
        <p className="alert-danger mb-3 text-sm" role="alert">
          {error}
        </p>
      )}
      <div className="space-y-3">
        <FormField label="When the body voted" id={ADOPT_FIELD_IDS.votedAt} error={errors.votedAt}>
          {(field) => (
            <DateTimeQuarterHour
              {...field}
              value={votedAt}
              onChange={(value) => {
                setVotedAt(value);
                clearError('votedAt');
              }}
              timezone={tz}
              timeLabel="Adoption vote"
            />
          )}
        </FormField>
        <FormField label="At which meeting" id={ADOPT_FIELD_IDS.meetingId} error={errors.meetingId}>
          {(field) => (
            <select
              {...field}
              value={meetingId}
              onChange={(e) => {
                setMeetingId(e.target.value);
                clearError('meetingId');
              }}
              className="form-input"
            >
              <option value="">Not recorded</option>
              {meetings.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} ({formatDate(m.meeting_date, tz)})
                </option>
              ))}
            </select>
          )}
        </FormField>
        <fieldset
          aria-invalid={errors.asAmended ? true : undefined}
          aria-describedby={errors.asAmended ? 'adopt-how-error' : undefined}
        >
          <legend className="form-label">Adopted</legend>
          <label className="mr-4 inline-flex items-center gap-2 text-sm">
            <input
              id={ADOPT_FIELD_IDS.asAmended}
              type="radio"
              name="adopt-how"
              checked={!asAmended}
              onChange={() => setAsAmended(false)}
            />
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
          {errors.asAmended && (
            <p id="adopt-how-error" className="mt-1 text-sm text-red-800 dark:text-red-300">
              {errors.asAmended}
            </p>
          )}
        </fieldset>
        <div className="card-secondary space-y-3 p-3">
          <p className="text-theme-text-primary text-sm">
            <span className="font-semibold">Motion: </span>
            {asAmended ? 'To adopt the minutes as amended.' : 'To adopt the minutes as presented.'}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PersonPicker
              id="adopt-moved-by"
              label="Moved by"
              value={movedBy}
              onChange={(name) => {
                setMovedBy(name);
                clearError('movedBy');
                clearError('secondedBy');
              }}
              attendees={attendees}
              error={errors.movedBy}
            />
            <PersonPicker
              id="adopt-seconded-by"
              label="Seconded by"
              value={secondedBy}
              onChange={(name) => {
                setSecondedBy(name);
                clearError('secondedBy');
              }}
              attendees={attendees}
              exclude={movedBy}
              error={errors.secondedBy}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default AdoptDialog;
