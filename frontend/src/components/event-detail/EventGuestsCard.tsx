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
 */

import React, { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { eventService } from '../../services/api';
import type { ExternalAttendee } from '../../types/event';
import { formatDateTime } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';

const SOURCE_LABELS: Record<string, string> = {
  kiosk_qr: 'Signed in at the kiosk',
  form_submission: 'From a form',
};

interface EventGuestsCardProps {
  eventId: string;
  canManage: boolean;
  /** Whether the event takes guest sign-ins; an empty list still shows then. */
  allowsGuestCheckIn: boolean;
}

export const EventGuestsCard: React.FC<EventGuestsCardProps> = ({ eventId, canManage, allowsGuestCheckIn }) => {
  const tz = useTimezone();
  const [guests, setGuests] = useState<ExternalAttendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
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
  }, [eventId, canManage]);

  if (!canManage || loading) return null;
  if (!failed && guests.length === 0 && !allowsGuestCheckIn) return null;

  const signedIn = guests.filter((guest) => guest.checked_in).length;

  return (
    <section className="card p-6" aria-labelledby="event-guests-heading">
      <h2
        id="event-guests-heading"
        className="text-theme-text-primary mb-1 flex items-center gap-2 text-lg font-medium"
      >
        <Users className="h-5 w-5" aria-hidden="true" />
        <span>Guests ({guests.length})</span>
      </h2>
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
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default EventGuestsCard;
