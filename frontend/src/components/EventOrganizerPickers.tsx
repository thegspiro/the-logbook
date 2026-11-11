/**
 * Organizer and alternate selects, shared by the event form and the transfer
 * dialog so both offer the same members in the same order.
 *
 * The alternate list leaves out whoever is the organizer — the API refuses the
 * same person twice — including the member the organizer defaults to when the
 * organizer select is left on its placeholder. The organizer list leaves that
 * member out too, since the placeholder already names them.
 */

import React from 'react';
import type { OrganizerOption } from '../hooks/useOrganizerOptions';

interface EventOrganizerPickersProps {
  idPrefix: string;
  options: OrganizerOption[];
  organizerId: string;
  alternateId: string;
  onOrganizerChange: (id: string) => void;
  onAlternateChange: (id: string) => void;
  /** Shown as the organizer's empty choice, e.g. "Me (default)". Omit to make
   * the organizer a required pick. */
  organizerPlaceholder?: string | undefined;
  /** Who the organizer is when the placeholder is chosen, so they are not
   * offered again as the alternate. */
  defaultOrganizerId?: string | undefined;
  disabled?: boolean | undefined;
  selectClassName?: string | undefined;
  labelClassName?: string | undefined;
}

export const EventOrganizerPickers: React.FC<EventOrganizerPickersProps> = ({
  idPrefix,
  options,
  organizerId,
  alternateId,
  onOrganizerChange,
  onAlternateChange,
  organizerPlaceholder,
  defaultOrganizerId,
  disabled = false,
  selectClassName = 'form-input',
  labelClassName = 'block text-sm font-semibold text-theme-text-primary mb-2',
}) => {
  const effectiveOrganizer = organizerId || defaultOrganizerId || '';
  const alternates = options.filter((o) => o.id !== effectiveOrganizer);
  // The placeholder ("Me (default)") already stands for the default organizer,
  // so listing them by name as well offers one person twice. They stay listed
  // while explicitly chosen, so the select never shows a value it lacks.
  const organizers =
    organizerPlaceholder && defaultOrganizerId
      ? options.filter((o) => o.id !== defaultOrganizerId || o.id === organizerId)
      : options;

  const changeOrganizer = (id: string) => {
    onOrganizerChange(id);
    // The new organizer cannot also be the alternate.
    if (alternateId && alternateId === (id || defaultOrganizerId)) onAlternateChange('');
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor={`${idPrefix}-organizer`} className={labelClassName}>
          Organizer{organizerPlaceholder ? '' : ' *'}
        </label>
        <select
          id={`${idPrefix}-organizer`}
          value={organizerId}
          onChange={(e) => changeOrganizer(e.target.value)}
          disabled={disabled}
          required={!organizerPlaceholder}
          className={selectClassName}
        >
          <option value="">{organizerPlaceholder ?? 'Choose a member'}</option>
          {organizers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-alternate`} className={labelClassName}>
          Alternate (optional)
        </label>
        <select
          id={`${idPrefix}-alternate`}
          value={alternateId}
          onChange={(e) => onAlternateChange(e.target.value)}
          disabled={disabled}
          className={selectClassName}
        >
          <option value="">No alternate</option>
          {alternates.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      <p className="text-theme-text-muted text-xs sm:col-span-2">
        Attendance requests for this event go to the organizer and the alternate.
      </p>
    </div>
  );
};

export default EventOrganizerPickers;
