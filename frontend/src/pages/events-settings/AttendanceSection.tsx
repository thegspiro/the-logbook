/**
 * AttendanceSection
 *
 * The organization-wide default for who may see an event's attendee list.
 * Individual events can override this in either direction from the event form;
 * this is the value they inherit when they do not.
 *
 * Ships as "Only event managers", which is how rosters behaved before they
 * could be shared at all — an organization has to opt in deliberately rather
 * than discover its member list published by an upgrade.
 *
 * Also who takes an attendance request ("I was there") that an event's own
 * organizer and alternate cannot — both left, or the only one set is the member
 * asking. Chosen per event type; an unset type goes to the Secretary, and only
 * failing that to every event manager.
 */

import React from 'react';
import { Inbox, Users } from 'lucide-react';
import type { SettingsSectionProps } from './types';
import type { EventPositionOption, EventType } from '../../types/event';
import { getEventTypeLabel } from '../../utils/eventHelpers';
import { EventType as EventTypeEnum } from '../../constants/enums';

// Every type the API accepts a fallback for. Not enabled_event_types: nothing
// enforces that list, so an event of a type missing from it still exists and
// still needs somebody to take its requests.
const EVENT_TYPES: EventType[] = Object.values(EventTypeEnum);

export interface AttendanceSectionProps extends SettingsSectionProps {
  onChangeAttendeeVisibility: (value: 'members' | 'managers') => void;
  /** null while the positions could not be loaded. */
  positionOptions: EventPositionOption[] | null;
  onChangeFallbackPosition: (eventType: EventType, positionId: string | null) => void;
}

const AttendanceSection: React.FC<AttendanceSectionProps> = ({
  settings,
  saving,
  onChangeAttendeeVisibility,
  positionOptions,
  onChangeFallbackPosition,
}) => {
  const current = settings.defaults?.attendee_visibility ?? 'managers';
  const fallbacks = settings.attendance_request_fallback_positions ?? {};

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
          <Users className="h-5 w-5" aria-hidden="true" />
          Attendee list
        </h2>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Who can see the list of members going to an event. Individual events can override this.
        </p>
      </div>

      <fieldset disabled={saving} className="space-y-3">
        <legend className="sr-only">Default attendee list visibility</legend>

        {(
          [
            {
              value: 'managers' as const,
              label: 'Only event managers',
              description: 'The attendee list stays restricted to members who can manage events.',
            },
            {
              value: 'members' as const,
              label: 'Everyone in the department',
              description:
                'Members see the names of people going. They never see email addresses, RSVP notes, dietary restrictions, accessibility needs, guest counts or check-in times.',
            },
          ] as const
        ).map((option) => (
          <label
            key={option.value}
            className="border-theme-surface-border hover:bg-theme-surface-hover flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors"
          >
            <input
              type="radio"
              name="attendee-visibility-default"
              value={option.value}
              checked={current === option.value}
              onChange={() => onChangeAttendeeVisibility(option.value)}
              className="mt-0.5 h-4 w-4 text-blue-600"
            />
            <span>
              <span className="text-theme-text-primary block text-sm font-medium">{option.label}</span>
              <span className="text-theme-text-muted mt-0.5 block text-xs">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="border-theme-surface-border border-t pt-6">
        <h3 className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
          <Inbox className="h-5 w-5" aria-hidden="true" />
          Attendance requests
        </h3>
        <p className="text-theme-text-secondary mt-1 text-sm">
          When a member asks to be marked present, the event&apos;s organizer and alternate are asked. If neither can be
          reached, the request goes to the position chosen here for that type of event. Left on the default, it goes to
          the Secretary, or to every event manager if there is no Secretary.
        </p>

        {positionOptions === null ? (
          <p className="mt-3 text-sm text-red-700 dark:text-red-400" role="alert">
            Positions could not be loaded, so these choices cannot be changed right now.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {EVENT_TYPES.map((eventType) => (
              <div key={eventType}>
                <label
                  htmlFor={`fallback-position-${eventType}`}
                  className="text-theme-text-primary mb-1 block text-sm font-medium"
                >
                  {getEventTypeLabel(eventType)}
                </label>
                <select
                  id={`fallback-position-${eventType}`}
                  value={fallbacks[eventType] ?? ''}
                  onChange={(e) => onChangeFallbackPosition(eventType, e.target.value || null)}
                  disabled={saving}
                  className="form-input"
                >
                  <option value="">Default (Secretary)</option>
                  {positionOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AttendanceSection;
