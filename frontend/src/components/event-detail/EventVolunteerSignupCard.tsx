/**
 * Sign up to volunteer at an outreach event, from the event page.
 *
 * For a member who cannot manage the event's staffing: they see the roles
 * still needed and claim one, the same signup Scheduling → Open Shifts offers.
 * An organizer gets this inside EventStaffingCard instead. The server decides
 * what is shown (`volunteer_signup` on the event detail) and enforces
 * eligibility and the signup window when the member signs up.
 */

import React from 'react';
import { Link } from 'react-router';
import { UserPlus } from 'lucide-react';
import OutreachRoleSignup from '../../modules/scheduling/components/OutreachRoleSignup';
import type { EventVolunteerSignup } from '../../types/event';

interface EventVolunteerSignupCardProps {
  signup: EventVolunteerSignup;
  /** The event has ended, so there is nothing left to sign up for. */
  isPast: boolean;
  onSignedUp: () => void | Promise<void>;
}

/** Each role with how many are still needed, as both staffing cards show it. */
export const VolunteerRoleList: React.FC<{ roles: EventVolunteerSignup['roles'] }> = ({ roles }) => (
  <ul className="space-y-1 text-sm">
    {roles.map((role) => (
      <li key={role.role} className="flex justify-between gap-3">
        <span className="text-theme-text-primary">{role.label}</span>
        <span className={role.remaining > 0 ? 'text-amber-800 dark:text-amber-300' : 'text-theme-text-secondary'}>
          {role.filled} of {role.total}
          {role.remaining > 0 ? ` — ${role.remaining} still needed` : ''}
        </span>
      </li>
    ))}
  </ul>
);

const EventVolunteerSignupCard: React.FC<EventVolunteerSignupCardProps> = ({ signup, isPast, onSignedUp }) => (
  <section className="card p-6" aria-labelledby="event-volunteer-heading">
    <h2
      id="event-volunteer-heading"
      className="text-theme-text-primary mb-3 flex items-center gap-2 text-lg font-semibold"
    >
      <UserPlus className="h-5 w-5" aria-hidden="true" />
      Volunteer
    </h2>
    <div className="space-y-3">
      <VolunteerRoleList roles={signup.roles} />
      {signup.signed_up ? (
        <p className="text-theme-text-secondary text-sm">
          You are signed up{signup.my_role_label ? ` as ${signup.my_role_label}` : ''}. To give the role up, go to{' '}
          <Link to="/scheduling?tab=my-shifts" className="font-medium text-blue-700 underline dark:text-blue-400">
            My Shifts
          </Link>
          .
        </p>
      ) : (
        !isPast && <OutreachRoleSignup shiftId={signup.shift_id} roles={signup.roles} onSignedUp={onSignedUp} />
      )}
    </div>
  </section>
);

export default EventVolunteerSignupCard;
