/**
 * Sign up to volunteer at an outreach event, from the event page.
 *
 * For a member who cannot manage the event's staffing; an organizer sees the
 * same seat board inside EventStaffingCard. Rendered when the event detail
 * says the event has a live signup sheet (`volunteer_signup`). The board reads
 * the seats fresh, and the scheduling signup endpoint enforces eligibility and
 * the signup window.
 */

import React from 'react';
import { UserPlus } from 'lucide-react';
import VolunteerSeatBoard from './VolunteerSeatBoard';

interface EventVolunteerSignupCardProps {
  eventId: string;
  /** The event has ended, so there is nothing left to sign up for. */
  isPast: boolean;
}

const EventVolunteerSignupCard: React.FC<EventVolunteerSignupCardProps> = ({ eventId, isPast }) => (
  <section className="card p-6" aria-labelledby="event-volunteer-heading">
    <h2
      id="event-volunteer-heading"
      className="text-theme-text-primary mb-3 flex items-center gap-2 text-lg font-semibold"
    >
      <UserPlus className="h-5 w-5" aria-hidden="true" />
      Volunteer staffing
    </h2>
    <VolunteerSeatBoard eventId={eventId} isPast={isPast} />
  </section>
);

export default EventVolunteerSignupCard;
