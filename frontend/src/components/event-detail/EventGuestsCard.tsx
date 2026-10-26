/**
 * Guests who signed in at an event, on the event detail page.
 *
 * A kiosk guest sign-in (and a form or staff entry) is stored as an external
 * attendee, which no screen read — the event page said "Attendance (0)" the
 * morning after an open house that thirty people signed in to. Owner decision
 * (W23-2): list them on the event page, and do not count them in member
 * attendance, which stays a record of members.
 *
 * `GET /events/{id}/external-attendees` is gated on events.manage and returns
 * contact details, so the card renders only for event managers; everyone else
 * sees nothing rather than a card that 403s.
 *
 * Managers also sign guests in from here — a walk-in the kiosk sent to staff
 * (Add guest), or a guest entered earlier who has not signed in yet.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { UserPlus, Users } from 'lucide-react';
import { eventService } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandling';
import { AddGuestModal } from './AddGuestModal';
import type { ExternalAttendee } from '../../types/event';
import { formatDateTime } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';

const SOURCE_LABELS: Record<string, string> = {
  kiosk_qr: 'Signed in at the kiosk',
  event_qr: "Signed in with the event's guest QR code",
  form_submission: 'From a form',
};

interface EventGuestsCardProps {
  eventId: string;
  canManage: boolean;
  /** Whether the event takes guest sign-ins; an empty list still shows then. */
  allowsGuestCheckIn: boolean;
  /** The event's "Add guests to the prospective members pipeline" switch. */
  addsGuestsToPipeline?: boolean;
}

export const EventGuestsCard: React.FC<EventGuestsCardProps> = ({
  eventId,
  canManage,
  allowsGuestCheckIn,
  addsGuestsToPipeline = false,
}) => {
  const tz = useTimezone();
  const [guests, setGuests] = useState<ExternalAttendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [signingIn, setSigningIn] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    // Only the first load hides the card; a reload after a sign-in keeps the
    // current list on screen until the new one arrives.
    if (reloadKey === 0) setLoading(true);
    setFailed(false);
    eventService
      .getExternalAttendees(eventId)
      .then((data) => {
        if (!cancelled) setGuests(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, canManage, reloadKey]);

  const reload = () => setReloadKey((key) => key + 1);

  const signIn = async (guest: ExternalAttendee) => {
    setSigningIn(guest.id);
    try {
      const result = await eventService.checkInExternalAttendee(eventId, guest.id);
      toast.success(
        result.prospect_id ? `${guest.name} signed in and linked to their application.` : `${guest.name} signed in.`
      );
      reload();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, `${guest.name} could not be signed in.`));
    } finally {
      setSigningIn(null);
    }
  };

  if (!canManage || loading) return null;
  if (!failed && guests.length === 0 && !allowsGuestCheckIn) return null;

  const signedIn = guests.filter((guest) => guest.checked_in).length;

  return (
    <section className="card p-6" aria-labelledby="event-guests-heading">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 id="event-guests-heading" className="text-theme-text-primary flex items-center gap-2 text-lg font-medium">
          <Users className="h-5 w-5" aria-hidden="true" />
          <span>Guests ({guests.length})</span>
        </h2>
        <button type="button" onClick={() => setAdding(true)} className="btn-secondary flex items-center gap-1.5">
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Add guest
        </button>
      </div>
      <p className="text-theme-text-muted mb-4 text-sm">
        People who are not members. Guests are not counted in attendance.
        {guests.length > 0 ? ` ${signedIn} signed in.` : ''}
      </p>

      {failed ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          Guests could not be loaded. Refresh to try again.
        </p>
      ) : guests.length === 0 ? (
        <p className="text-theme-text-muted text-sm">No guests have signed in yet.</p>
      ) : (
        <ul className="divide-theme-surface-border divide-y">
          {guests.map((guest) => (
            <li key={guest.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="text-theme-text-primary text-sm font-medium">
                  {guest.name}
                  {guest.organization_name && (
                    <span className="text-theme-text-muted font-normal"> · {guest.organization_name}</span>
                  )}
                </p>
                {(guest.email || guest.phone) && (
                  <p className="text-theme-text-muted text-xs break-all">
                    {[guest.email, guest.phone].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-theme-text-secondary text-xs">
                  {guest.checked_in && guest.checked_in_at
                    ? `Signed in ${formatDateTime(guest.checked_in_at, tz)}`
                    : 'Not signed in'}
                </p>
                {guest.source && SOURCE_LABELS[guest.source] && (
                  <p className="text-theme-text-muted text-xs">{SOURCE_LABELS[guest.source]}</p>
                )}
                {!guest.checked_in && (
                  <button
                    type="button"
                    onClick={() => void signIn(guest)}
                    disabled={signingIn !== null}
                    aria-label={`Sign in ${guest.name}`}
                    className="btn-secondary mt-1 text-xs"
                  >
                    {signingIn === guest.id ? 'Signing in...' : 'Sign in'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <AddGuestModal
        isOpen={adding}
        eventId={eventId}
        addsGuestsToPipeline={addsGuestsToPipeline}
        onClose={() => setAdding(false)}
        onSaved={reload}
      />
    </section>
  );
};

export default EventGuestsCard;
