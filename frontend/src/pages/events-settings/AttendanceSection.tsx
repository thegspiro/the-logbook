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
 *
 * And how far ahead a mandatory event asks members to respond. Without a
 * window, one recurring mandatory series asked about every future occurrence
 * at once.
 */

import React from 'react';
import { CalendarClock, Inbox, Users } from 'lucide-react';
import type { SettingsSectionProps } from './types';
import type { EventPositionOption, EventType } from '../../types/event';
import { getEventTypeLabel } from '../../utils/eventHelpers';
import { EventType as EventTypeEnum } from '../../constants/enums';
import {
  EVENT_MANDATORY_RSVP_WINDOW_DAYS,
  EVENT_MANDATORY_RSVP_WINDOW_MAX_DAYS,
  EVENT_MANDATORY_RSVP_WINDOW_MIN_DAYS,
} from '../../constants/config';

// Every type the API accepts a fallback for. Not enabled_event_types: nothing
// enforces that list, so an event of a type missing from it still exists and
// still needs somebody to take its requests.
const EVENT_TYPES: EventType[] = Object.values(EventTypeEnum);

export interface AttendanceSectionProps extends SettingsSectionProps {
  onChangeAttendeeVisibility: (value: 'members' | 'managers') => void;
  /** null while the positions could not be loaded. */
  positionOptions: EventPositionOption[] | null;
  onChangeFallbackPosition: (eventType: EventType, positionId: string | null) => void;
  onChangeMandatoryRsvpWindow: (days: number) => void;
}

const AttendanceSection: React.FC<AttendanceSectionProps> = ({
  settings,
  saving,
  onChangeAttendeeVisibility,
  positionOptions,
  onChangeFallbackPosition,
  onChangeMandatoryRsvpWindow,
}) => {
  const current = settings.defaults?.attendee_visibility ?? 'managers';
  const fallbacks = settings.attendance_request_fallback_positions ?? {};
  const savedWindow = settings.mandatory_rsvp_window_days ?? EVENT_MANDATORY_RSVP_WINDOW_DAYS;

  // Held locally and saved on blur or Enter, because every save on this screen
  // writes immediately: saving per keystroke would store "9" on the way to "90".
  const [windowDraft, setWindowDraft] = React.useState(String(savedWindow));
  React.useEffect(() => {
    setWindowDraft(String(savedWindow));
  }, [savedWindow]);

  const parsedWindow = Number(windowDraft);
  const windowIsValid =
    Number.isInteger(parsedWindow) &&
    parsedWindow >= EVENT_MANDATORY_RSVP_WINDOW_MIN_DAYS &&
    parsedWindow <= EVENT_MANDATORY_RSVP_WINDOW_MAX_DAYS;

  const commitWindow = () => {
    if (!windowIsValid) return;
    if (parsedWindow !== savedWindow) onChangeMandatoryRsvpWindow(parsedWindow);
  };

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

      <div className="border-theme-surface-border border-t pt-6">
        <h3 className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
          <CalendarClock className="h-5 w-5" aria-hidden="true" />
          Mandatory event responses
        </h3>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Members are asked to respond to a mandatory event once it is this close. Later events in a recurring series
          appear as they come within range. An event whose RSVP deadline is under two days away is always asked about.
        </p>

        <div className="mt-4">
          <label htmlFor="mandatory-rsvp-window" className="text-theme-text-primary mb-1 block text-sm font-medium">
            Ask for a response
          </label>
          <div className="flex items-center gap-3">
            <input
              id="mandatory-rsvp-window"
              type="number"
              inputMode="numeric"
              min={EVENT_MANDATORY_RSVP_WINDOW_MIN_DAYS}
              max={EVENT_MANDATORY_RSVP_WINDOW_MAX_DAYS}
              step={1}
              value={windowDraft}
              onChange={(e) => setWindowDraft(e.target.value)}
              onBlur={commitWindow}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitWindow();
              }}
              disabled={saving}
              aria-invalid={!windowIsValid}
              aria-describedby="mandatory-rsvp-window-hint"
              className="form-input w-24"
            />
            <span className="text-theme-text-muted text-sm">days before the event</span>
          </div>
          <p
            id="mandatory-rsvp-window-hint"
            className={`mt-1 text-xs ${windowIsValid ? 'text-theme-text-muted' : 'text-red-700 dark:text-red-400'}`}
            role={windowIsValid ? undefined : 'alert'}
          >
            {windowIsValid
              ? `Default ${EVENT_MANDATORY_RSVP_WINDOW_DAYS} days.`
              : `Enter a whole number from ${EVENT_MANDATORY_RSVP_WINDOW_MIN_DAYS} to ${EVENT_MANDATORY_RSVP_WINDOW_MAX_DAYS}.`}
          </p>
        </div>
      </div>
    </div>
  );
};

export default AttendanceSection;
