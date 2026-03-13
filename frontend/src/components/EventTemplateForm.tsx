/**
 * Event Template Form
 *
 * Form component for creating and editing event templates.
 * Includes all configurable template fields organized in collapsible sections.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { EventTemplate, EventTemplateCreate } from '../types/event';
import { EventType } from '../constants/enums';
import { getEventTypeLabel } from '../utils/eventHelpers';

interface EventTemplateFormProps {
  initialData?: EventTemplate | undefined;
  onSubmit: (data: EventTemplateCreate) => void | Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
}

const EVENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: EventType.BUSINESS_MEETING, label: getEventTypeLabel(EventType.BUSINESS_MEETING) },
  { value: EventType.PUBLIC_EDUCATION, label: getEventTypeLabel(EventType.PUBLIC_EDUCATION) },
  { value: EventType.TRAINING, label: getEventTypeLabel(EventType.TRAINING) },
  { value: EventType.SOCIAL, label: getEventTypeLabel(EventType.SOCIAL) },
  { value: EventType.FUNDRAISER, label: getEventTypeLabel(EventType.FUNDRAISER) },
  { value: EventType.CEREMONY, label: getEventTypeLabel(EventType.CEREMONY) },
  { value: EventType.OTHER, label: getEventTypeLabel(EventType.OTHER) },
];

const CHECK_IN_WINDOW_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'flexible', label: 'Flexible' },
  { value: 'strict', label: 'Strict' },
  { value: 'window', label: 'Window' },
];

const inputClass =
  'w-full rounded-lg border border-theme-input-border bg-theme-input-bg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-theme-focus-ring';
const selectClass =
  'w-full rounded-lg border border-theme-input-border bg-theme-input-bg px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-theme-focus-ring';
const labelClass = 'block text-sm font-medium text-theme-text-primary mb-1';
const checkboxClass =
  'h-4 w-4 rounded border-theme-input-border text-red-600 focus:ring-theme-focus-ring';

export const EventTemplateForm: React.FC<EventTemplateFormProps> = ({
  initialData,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel = 'Save Template',
}) => {
  // Basic fields
  const [name, setName] = useState(initialData?.name ?? '');
  const [description, setDescription] = useState(initialData?.description ?? '');
  const [eventType, setEventType] = useState(initialData?.event_type ?? EventType.BUSINESS_MEETING);
  const [defaultTitle, setDefaultTitle] = useState(initialData?.default_title ?? '');
  const [defaultDescription, setDefaultDescription] = useState(initialData?.default_description ?? '');

  // Location & Duration
  const [defaultLocation, setDefaultLocation] = useState(initialData?.default_location ?? '');
  const [defaultDurationMinutes, setDefaultDurationMinutes] = useState(
    initialData?.default_duration_minutes?.toString() ?? '',
  );

  // RSVP & Attendance
  const [requiresRsvp, setRequiresRsvp] = useState(initialData?.requires_rsvp ?? false);
  const [maxAttendees, setMaxAttendees] = useState(initialData?.max_attendees?.toString() ?? '');
  const [isMandatory, setIsMandatory] = useState(initialData?.is_mandatory ?? false);
  const [allowGuests, setAllowGuests] = useState(initialData?.allow_guests ?? false);

  // Reminders
  const [sendReminders, setSendReminders] = useState(initialData?.send_reminders ?? false);
  const [reminderSchedule, setReminderSchedule] = useState(
    initialData?.reminder_schedule?.join(', ') ?? '',
  );

  // Check-in settings
  const [checkInWindowType, setCheckInWindowType] = useState(
    initialData?.check_in_window_type ?? '',
  );
  const [checkInMinutesBefore, setCheckInMinutesBefore] = useState(
    initialData?.check_in_minutes_before?.toString() ?? '',
  );
  const [checkInMinutesAfter, setCheckInMinutesAfter] = useState(
    initialData?.check_in_minutes_after?.toString() ?? '',
  );
  const [requireCheckout, setRequireCheckout] = useState(initialData?.require_checkout ?? false);

  // Collapsible sections
  const [showRsvpSection, setShowRsvpSection] = useState(
    !!(initialData?.requires_rsvp || initialData?.is_mandatory || initialData?.allow_guests),
  );
  const [showCheckInSection, setShowCheckInSection] = useState(
    !!(initialData?.check_in_window_type || initialData?.require_checkout),
  );
  const [showReminderSection, setShowReminderSection] = useState(
    !!initialData?.send_reminders,
  );

  const [nameError, setNameError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
    if (!name.trim()) {
      setNameError('Template name is required');
      return;
    }
    setNameError('');

    // Parse reminder schedule: comma-separated numbers (hours before event)
    const parsedReminders = reminderSchedule
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));

    const data: EventTemplateCreate = {
      name: name.trim(),
      event_type: eventType,
      requires_rsvp: requiresRsvp,
      is_mandatory: isMandatory,
      allow_guests: allowGuests,
      send_reminders: sendReminders,
      require_checkout: requireCheckout,
    };

    // Only include optional fields when they have actual values (exactOptionalPropertyTypes)
    const trimmedDescription = description.trim();
    if (trimmedDescription) data.description = trimmedDescription;
    const trimmedDefaultTitle = defaultTitle.trim();
    if (trimmedDefaultTitle) data.default_title = trimmedDefaultTitle;
    const trimmedDefaultDescription = defaultDescription.trim();
    if (trimmedDefaultDescription) data.default_description = trimmedDefaultDescription;
    const trimmedDefaultLocation = defaultLocation.trim();
    if (trimmedDefaultLocation) data.default_location = trimmedDefaultLocation;
    const parsedDuration = parseInt(defaultDurationMinutes, 10);
    if (parsedDuration > 0) data.default_duration_minutes = parsedDuration;
    const parsedMaxAttendees = parseInt(maxAttendees, 10);
    if (parsedMaxAttendees > 0) data.max_attendees = parsedMaxAttendees;
    if (parsedReminders.length > 0) data.reminder_schedule = parsedReminders;
    if (checkInWindowType) data.check_in_window_type = checkInWindowType as 'flexible' | 'strict' | 'window';
    const parsedMinsBefore = parseInt(checkInMinutesBefore, 10);
    if (parsedMinsBefore > 0) data.check_in_minutes_before = parsedMinsBefore;
    const parsedMinsAfter = parseInt(checkInMinutesAfter, 10);
    if (parsedMinsAfter > 0) data.check_in_minutes_after = parsedMinsAfter;

    void onSubmit(data);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Information */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-theme-text-primary uppercase tracking-wider">
          Basic Information
        </h3>

        <div>
          <label htmlFor="template-name" className={labelClass}>
            Template Name <span className="text-red-700 dark:text-red-500">*</span>
          </label>
          <input
            id="template-name"
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setNameError(''); }}
            className={`${inputClass} ${nameError ? 'border-red-500' : ''}`}
            placeholder="e.g., Monthly Business Meeting"
            required
          />
          {nameError && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">{nameError}</p>
          )}
        </div>

        <div>
          <label htmlFor="template-description" className={labelClass}>
            Description
          </label>
          <textarea
            id="template-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
            rows={2}
            placeholder="Brief description of what this template is for"
          />
        </div>

        <div>
          <label htmlFor="template-event-type" className={labelClass}>
            Event Type
          </label>
          <select
            id="template-event-type"
            value={eventType}
            onChange={(e) => setEventType(e.target.value as typeof eventType)}
            className={selectClass}
          >
            {EVENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Default Event Values */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-theme-text-primary uppercase tracking-wider">
          Default Event Values
        </h3>

        <div>
          <label htmlFor="template-default-title" className={labelClass}>
            Default Title
          </label>
          <input
            id="template-default-title"
            type="text"
            value={defaultTitle}
            onChange={(e) => setDefaultTitle(e.target.value)}
            className={inputClass}
            placeholder="Pre-filled event title"
          />
        </div>

        <div>
          <label htmlFor="template-default-description" className={labelClass}>
            Default Description
          </label>
          <textarea
            id="template-default-description"
            value={defaultDescription}
            onChange={(e) => setDefaultDescription(e.target.value)}
            className={inputClass}
            rows={3}
            placeholder="Pre-filled event description"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="template-default-location" className={labelClass}>
              Default Location
            </label>
            <input
              id="template-default-location"
              type="text"
              value={defaultLocation}
              onChange={(e) => setDefaultLocation(e.target.value)}
              className={inputClass}
              placeholder="e.g., Station 1 Meeting Room"
            />
          </div>
          <div>
            <label htmlFor="template-default-duration" className={labelClass}>
              Default Duration (minutes)
            </label>
            <input
              id="template-default-duration"
              type="number"
              min={1}
              value={defaultDurationMinutes}
              onChange={(e) => setDefaultDurationMinutes(e.target.value)}
              className={inputClass}
              placeholder="60"
            />
          </div>
        </div>
      </div>

      {/* RSVP & Attendance (collapsible) */}
      <div>
        <button
          type="button"
          onClick={() => setShowRsvpSection((prev) => !prev)}
          className="flex items-center gap-2 text-sm font-semibold text-theme-text-primary uppercase tracking-wider hover:text-theme-text-secondary transition-colors w-full"
        >
          {showRsvpSection ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
          RSVP & Attendance
        </button>
        {showRsvpSection && (
          <div className="mt-4 space-y-4 pl-6">
            <div className="flex items-center gap-3">
              <input
                id="template-requires-rsvp"
                type="checkbox"
                checked={requiresRsvp}
                onChange={(e) => setRequiresRsvp(e.target.checked)}
                className={checkboxClass}
              />
              <label htmlFor="template-requires-rsvp" className="text-sm text-theme-text-primary">
                Requires RSVP
              </label>
            </div>

            {requiresRsvp && (
              <div>
                <label htmlFor="template-max-attendees" className={labelClass}>
                  Max Attendees
                </label>
                <input
                  id="template-max-attendees"
                  type="number"
                  min={1}
                  value={maxAttendees}
                  onChange={(e) => setMaxAttendees(e.target.value)}
                  className={`${inputClass} max-w-xs`}
                  placeholder="Unlimited"
                />
              </div>
            )}

            <div className="flex items-center gap-3">
              <input
                id="template-is-mandatory"
                type="checkbox"
                checked={isMandatory}
                onChange={(e) => setIsMandatory(e.target.checked)}
                className={checkboxClass}
              />
              <label htmlFor="template-is-mandatory" className="text-sm text-theme-text-primary">
                Mandatory attendance
              </label>
            </div>

            <div className="flex items-center gap-3">
              <input
                id="template-allow-guests"
                type="checkbox"
                checked={allowGuests}
                onChange={(e) => setAllowGuests(e.target.checked)}
                className={checkboxClass}
              />
              <label htmlFor="template-allow-guests" className="text-sm text-theme-text-primary">
                Allow guests
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Reminders (collapsible) */}
      <div>
        <button
          type="button"
          onClick={() => setShowReminderSection((prev) => !prev)}
          className="flex items-center gap-2 text-sm font-semibold text-theme-text-primary uppercase tracking-wider hover:text-theme-text-secondary transition-colors w-full"
        >
          {showReminderSection ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
          Reminders
        </button>
        {showReminderSection && (
          <div className="mt-4 space-y-4 pl-6">
            <div className="flex items-center gap-3">
              <input
                id="template-send-reminders"
                type="checkbox"
                checked={sendReminders}
                onChange={(e) => setSendReminders(e.target.checked)}
                className={checkboxClass}
              />
              <label htmlFor="template-send-reminders" className="text-sm text-theme-text-primary">
                Send reminders
              </label>
            </div>

            {sendReminders && (
              <div>
                <label htmlFor="template-reminder-schedule" className={labelClass}>
                  Reminder Schedule (hours before event, comma-separated)
                </label>
                <input
                  id="template-reminder-schedule"
                  type="text"
                  value={reminderSchedule}
                  onChange={(e) => setReminderSchedule(e.target.value)}
                  className={inputClass}
                  placeholder="24, 2"
                />
                <p className="mt-1 text-xs text-theme-text-muted">
                  Enter hours before the event when reminders should be sent.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Check-in Settings (collapsible) */}
      <div>
        <button
          type="button"
          onClick={() => setShowCheckInSection((prev) => !prev)}
          className="flex items-center gap-2 text-sm font-semibold text-theme-text-primary uppercase tracking-wider hover:text-theme-text-secondary transition-colors w-full"
        >
          {showCheckInSection ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
          Check-in Settings
        </button>
        {showCheckInSection && (
          <div className="mt-4 space-y-4 pl-6">
            <div>
              <label htmlFor="template-checkin-window" className={labelClass}>
                Check-in Window Type
              </label>
              <select
                id="template-checkin-window"
                value={checkInWindowType}
                onChange={(e) => setCheckInWindowType(e.target.value)}
                className={`${selectClass} max-w-xs`}
              >
                {CHECK_IN_WINDOW_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {checkInWindowType === 'window' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="template-checkin-before" className={labelClass}>
                    Minutes Before Start
                  </label>
                  <input
                    id="template-checkin-before"
                    type="number"
                    min={0}
                    value={checkInMinutesBefore}
                    onChange={(e) => setCheckInMinutesBefore(e.target.value)}
                    className={inputClass}
                    placeholder="15"
                  />
                </div>
                <div>
                  <label htmlFor="template-checkin-after" className={labelClass}>
                    Minutes After Start
                  </label>
                  <input
                    id="template-checkin-after"
                    type="number"
                    min={0}
                    value={checkInMinutesAfter}
                    onChange={(e) => setCheckInMinutesAfter(e.target.value)}
                    className={inputClass}
                    placeholder="30"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <input
                id="template-require-checkout"
                type="checkbox"
                checked={requireCheckout}
                onChange={(e) => setRequireCheckout(e.target.checked)}
                className={checkboxClass}
              />
              <label htmlFor="template-require-checkout" className="text-sm text-theme-text-primary">
                Require checkout
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Form Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t border-theme-surface-border">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-4 py-2 text-sm font-medium text-theme-text-secondary bg-theme-surface border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {isSubmitting ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  );
};
