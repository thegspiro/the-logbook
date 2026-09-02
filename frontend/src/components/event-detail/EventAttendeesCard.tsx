/**
 * EventAttendeesCard
 *
 * The member-facing "who's going" list. Deliberately the thin counterpart to
 * EventRSVPSection, which is the manager view: this one renders names and
 * nothing else — no email, no notes, no dietary or accessibility information,
 * no guest counts, no check-in times.
 *
 * That narrowness is enforced at three layers, and this component is the last
 * of them: the API serves a schema with three fields, `EventAttendee` types
 * only those three, and this component has no props through which anything
 * else could arrive. Widening any one of them is what would start publishing a
 * member's accommodation needs to the whole department.
 */

import React, { useState } from 'react';
import { Users } from 'lucide-react';
import { EmptyState } from '../ux';
import type { EventAttendee } from '../../types/event';

const INITIAL_VISIBLE = 12;

export interface EventAttendeesCardProps {
  attendees: EventAttendee[];
  loading?: boolean;
  /** Total going, which can exceed `attendees.length` because the API pages. */
  goingCount?: number | undefined;
}

export const EventAttendeesCard: React.FC<EventAttendeesCardProps> = ({ attendees, loading = false, goingCount }) => {
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? attendees : attendees.slice(0, INITIAL_VISIBLE);
  const hiddenCount = attendees.length - visible.length;
  const total = goingCount ?? attendees.length;

  return (
    <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
      <h2 className="text-theme-text-primary mb-4 flex items-center gap-2 text-lg font-medium">
        <Users className="h-5 w-5" aria-hidden="true" />
        Who&apos;s going{total > 0 ? ` (${total})` : ''}
      </h2>

      {loading ? (
        <p className="text-theme-text-muted text-sm" role="status" aria-live="polite">
          Loading attendees…
        </p>
      ) : attendees.length === 0 ? (
        <EmptyState icon={Users} title="Nobody yet" description="Be the first to say you're coming." />
      ) : (
        <>
          <ul className="space-y-2">
            {visible.map((attendee) => (
              <li
                key={attendee.user_id}
                className="bg-theme-surface-secondary text-theme-text-primary rounded-lg px-3 py-2 text-sm"
              >
                {attendee.user_name || 'Unnamed member'}
              </li>
            ))}
          </ul>

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-theme-text-secondary hover:text-theme-text-primary mobile-touch-target mt-3 text-sm font-medium"
            >
              Show {hiddenCount} more
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default EventAttendeesCard;
