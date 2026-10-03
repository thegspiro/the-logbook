/**
 * Hand an event to a new organizer and alternate.
 *
 * On a recurring event the officer chooses whether the change covers this
 * occurrence only or this and every upcoming one — the second is how a new
 * officer takes over a standing drill night. Past occurrences always keep the
 * organizer who ran them; the API decides which events move and reports how
 * many did.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../Modal';
import { EventOrganizerPickers } from '../EventOrganizerPickers';
import { useOrganizerOptions } from '../../hooks/useOrganizerOptions';
import { eventService } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandling';
import type { EventTransferScope } from '../../types/event';

interface EventTransferModalProps {
  eventId: string;
  isRecurring: boolean;
  currentOrganizerId: string | null;
  currentAlternateId: string | null;
  onClose: () => void;
  onTransferred: () => void;
}

const EventTransferModal: React.FC<EventTransferModalProps> = ({
  eventId,
  isRecurring,
  currentOrganizerId,
  currentAlternateId,
  onClose,
  onTransferred,
}) => {
  const { options, loading, error: loadError } = useOrganizerOptions();
  const [organizerId, setOrganizerId] = useState(currentOrganizerId ?? '');
  const [alternateId, setAlternateId] = useState(currentAlternateId ?? '');
  const [scope, setScope] = useState<EventTransferScope>(isRecurring ? 'future' : 'this');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Only a single-event transfer can be known to change nothing from here: a
  // series transfer may still move later occurrences that differ from this one.
  const unchanged =
    scope === 'this' && organizerId === (currentOrganizerId ?? '') && alternateId === (currentAlternateId ?? '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizerId) {
      setSubmitError('Choose an organizer.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await eventService.transferEvent(eventId, {
        organizer_id: organizerId,
        alternate_organizer_id: alternateId || null,
        scope,
      });
      toast.success(
        result.updated_count > 1 ? `Transferred ${result.updated_count} events in the series` : 'Event transferred'
      );
      onTransferred();
    } catch (err: unknown) {
      setSubmitError(getErrorMessage(err, 'Could not transfer the event.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Transfer Event"
      titleId="transfer-event-modal-title"
      onSubmit={(e) => void handleSubmit(e)}
      footer={
        <>
          <button
            type="submit"
            disabled={submitting || loading || !organizerId || unchanged}
            className="btn-primary inline-flex w-full justify-center rounded-md text-base font-medium sm:ml-3 sm:w-auto sm:text-sm"
          >
            {submitting ? 'Transferring...' : 'Transfer'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary text-theme-text-secondary mt-3 inline-flex w-full justify-center text-base font-medium shadow-xs focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
          >
            Keep as is
          </button>
        </>
      }
    >
      <p className="text-theme-text-secondary mb-4 text-sm">
        The new organizer and alternate receive this event&apos;s attendance requests, including any still waiting. Both
        are told, and so is anyone relieved of the role.
      </p>

      {(submitError || loadError) && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3" role="alert" aria-live="assertive">
          <p className="text-sm text-red-700 dark:text-red-300">{submitError ?? loadError}</p>
        </div>
      )}

      <EventOrganizerPickers
        idPrefix="transfer"
        options={options}
        organizerId={organizerId}
        alternateId={alternateId}
        onOrganizerChange={setOrganizerId}
        onAlternateChange={setAlternateId}
        disabled={loading || submitting}
      />

      {isRecurring && (
        <fieldset className="mt-4 space-y-2" disabled={submitting}>
          <legend className="text-theme-text-primary mb-2 block text-sm font-semibold">Apply to</legend>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="transfer-scope"
              value="future"
              checked={scope === 'future'}
              onChange={() => setScope('future')}
              className="mt-0.5 h-4 w-4"
            />
            <span className="text-theme-text-secondary text-sm">
              This and all future events in the series
              <span className="text-theme-text-muted block text-xs">Past events keep the organizer who ran them.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="transfer-scope"
              value="this"
              checked={scope === 'this'}
              onChange={() => setScope('this')}
              className="mt-0.5 h-4 w-4"
            />
            <span className="text-theme-text-secondary text-sm">This event only</span>
          </label>
        </fieldset>
      )}
    </Modal>
  );
};

export default EventTransferModal;
