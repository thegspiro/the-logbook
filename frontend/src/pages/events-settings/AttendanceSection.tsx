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
 */

import React from 'react';
import { Users } from 'lucide-react';
import type { SettingsSectionProps } from './types';

export interface AttendanceSectionProps extends SettingsSectionProps {
  onChangeAttendeeVisibility: (value: 'members' | 'managers') => void;
}

const AttendanceSection: React.FC<AttendanceSectionProps> = ({ settings, saving, onChangeAttendeeVisibility }) => {
  const current = settings.defaults?.attendee_visibility ?? 'managers';

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
          <Users className="h-5 w-5" aria-hidden="true" />
          Attendee list
        </h3>
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
    </div>
  );
};

export default AttendanceSection;
