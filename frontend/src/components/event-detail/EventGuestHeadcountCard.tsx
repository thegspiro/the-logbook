/**
 * The guests a coordinator counted at an outreach event, on the event page.
 *
 * A school assembly or a block party does not pass round a sign-in sheet, so
 * the Outreach Impact report could only show the audience the requester
 * expected. A headcount entered here is the event's actual figure there, in
 * place of guest sign-ins. Rendered only when the detail endpoint says the
 * caller may record one (`can_record_guest_headcount`), which it decides with
 * the same checks the save applies.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ClipboardList } from 'lucide-react';
import { eventService } from '../../services/api';
import type { Event } from '../../types/event';
import { getErrorMessage } from '../../utils/errorHandling';
import { formatNumber } from '../../utils/dateFormatting';
import { FormField } from '../ux';
import { parseHeadcount } from './guestHeadcount';

interface EventGuestHeadcountCardProps {
  event: Event;
  onSaved: (event: Event) => void;
}

const EventGuestHeadcountCard: React.FC<EventGuestHeadcountCardProps> = ({ event, onSaved }) => {
  const saved = event.guest_headcount ?? null;
  const [draft, setDraft] = useState(saved == null ? '' : String(saved));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A fresh event from the server (after a save, or a reload) resets the box.
  useEffect(() => {
    setDraft(saved == null ? '' : String(saved));
  }, [saved]);

  const save = async (value: number | null) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await eventService.setGuestHeadcount(event.id, value);
      onSaved(updated);
      toast.success(value == null ? 'Headcount cleared.' : `Headcount saved: ${formatNumber(value)} guests.`);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not save the headcount'));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseHeadcount(draft);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    void save(parsed.value);
  };

  const unchanged = draft.trim() === (saved == null ? '' : String(saved));

  return (
    <section className="card p-6" aria-labelledby="event-headcount-heading">
      <h2
        id="event-headcount-heading"
        className="text-theme-text-primary mb-1 flex items-center gap-2 text-lg font-medium"
      >
        <ClipboardList className="h-5 w-5" aria-hidden="true" />
        <span>Guest headcount</span>
      </h2>
      <p className="text-theme-text-muted mb-4 text-sm">
        How many guests were there, for an event where people did not sign in one by one. Outreach Impact reports this
        in place of guest sign-ins. Members on duty are not part of it.
      </p>
      <form onSubmit={submit} noValidate className="flex flex-wrap items-start gap-3">
        <FormField label="Guests counted" error={error} className="w-40">
          {(control) => (
            <input
              {...control}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className="form-input"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
            />
          )}
        </FormField>
        {/* Aligned with the input, under the label. */}
        <div className="flex flex-wrap gap-2 sm:mt-6">
          <button type="submit" className="btn-primary" disabled={busy || unchanged}>
            {busy ? 'Saving…' : 'Save headcount'}
          </button>
          {saved != null && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void save(null)}>
              Clear
            </button>
          )}
        </div>
      </form>
    </section>
  );
};

export default EventGuestHeadcountCard;
