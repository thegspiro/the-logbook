/**
 * EventForm Component
 *
 * Reusable form for creating and editing events.
 * Supports location picker, role-based eligibility, RSVP settings,
 * check-in window configuration, and reminder settings.
 */

import React, { useEffect, useState } from 'react';
import type { EventCreate, EventType, RSVPStatus } from '../types/event';
import type { Role } from '../types/role';
import { roleService, locationsService } from '../services/api';
import type { Location } from '../services/api';
import { getEventTypeLabel } from '../utils/eventHelpers';

interface EventFormProps {
  initialData?: Partial<EventCreate>;
  onSubmit: (data: EventCreate) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
  isSubmitting?: boolean;
}

const EVENT_TYPES: EventType[] = [
  'business_meeting',
  'public_education',
  'training',
  'social',
  'fundraiser',
  'ceremony',
  'other',
];

const DEFAULT_FORM_DATA: EventCreate = {
  title: '',
  description: '',
  event_type: 'business_meeting',
  location_id: undefined,
  location: '',
  location_details: '',
  start_datetime: '',
  end_datetime: '',
  requires_rsvp: false,
  rsvp_deadline: '',
  max_attendees: undefined,
  allowed_rsvp_statuses: ['going', 'not_going'],
  is_mandatory: false,
  eligible_roles: undefined,
  allow_guests: false,
  send_reminders: true,
  reminder_hours_before: 24,
  check_in_window_type: 'flexible',
  check_in_minutes_before: 15,
  check_in_minutes_after: 15,
  require_checkout: false,
};

export const EventForm: React.FC<EventFormProps> = ({
  initialData,
  onSubmit,
  onCancel,
  submitLabel = 'Create Event',
  isSubmitting = false,
}) => {
  const [formData, setFormData] = useState<EventCreate>({
    ...DEFAULT_FORM_DATA,
    ...initialData,
  });
  const [error, setError] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [locationMode, setLocationMode] = useState<'select' | 'other'>(
    initialData?.location_id ? 'select' : initialData?.location ? 'other' : 'select'
  );

  useEffect(() => {
    loadLocations();
    loadRoles();
  }, []);

  const loadLocations = async () => {
    try {
      const data = await locationsService.getLocations({ is_active: true });
      setLocations(data);
      if (data.length === 0) {
        setLocationMode('other');
      }
    } catch {
      // Non-critical — fall back to free-text
      setLocationMode('other');
    }
  };

  const loadRoles = async () => {
    try {
      const data = await roleService.getRoles();
      setRoles(data);
    } catch {
      // Non-critical
    }
  };

  const update = (partial: Partial<EventCreate>) => {
    setFormData((prev) => ({ ...prev, ...partial }));
  };

  const handleStartDateChange = (startDate: string) => {
    const changes: Partial<EventCreate> = { start_datetime: startDate };
    // Auto-set end date to 2 hours later if not already set
    if (!formData.end_datetime && startDate) {
      const start = new Date(startDate);
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      changes.end_datetime = end.toISOString().slice(0, 16);
    }
    update(changes);
  };

  const setDuration = (hours: number) => {
    if (!formData.start_datetime) {
      setError('Please set a start date first');
      return;
    }
    const start = new Date(formData.start_datetime);
    const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
    update({ end_datetime: end.toISOString().slice(0, 16) });
  };

  const toggleRsvpStatus = (status: RSVPStatus, checked: boolean) => {
    const statuses = formData.allowed_rsvp_statuses || [];
    if (checked) {
      update({ allowed_rsvp_statuses: [...statuses, status] });
    } else {
      update({ allowed_rsvp_statuses: statuses.filter((s) => s !== status) });
    }
  };

  const toggleEligibleRole = (slug: string, checked: boolean) => {
    const current = formData.eligible_roles || [];
    if (checked) {
      update({ eligible_roles: [...current, slug] });
    } else {
      const updated = current.filter((r) => r !== slug);
      update({ eligible_roles: updated.length > 0 ? updated : undefined });
    }
  };

  const handleLocationModeChange = (mode: 'select' | 'other') => {
    setLocationMode(mode);
    if (mode === 'select') {
      update({ location: '', location_id: undefined });
    } else {
      update({ location_id: undefined });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate dates
    if (new Date(formData.end_datetime) <= new Date(formData.start_datetime)) {
      setError('End date must be after start date');
      return;
    }

    if (formData.requires_rsvp && formData.rsvp_deadline) {
      if (new Date(formData.rsvp_deadline) >= new Date(formData.start_datetime)) {
        setError('RSVP deadline must be before event start');
        return;
      }
    }

    // Clean up data before submit
    const submitData = { ...formData };

    // Clear location fields based on mode
    if (locationMode === 'select') {
      submitData.location = undefined;
    } else {
      submitData.location_id = undefined;
    }

    // Clear RSVP fields if not required
    if (!submitData.requires_rsvp) {
      submitData.rsvp_deadline = undefined;
      submitData.max_attendees = undefined;
      submitData.allow_guests = false;
      submitData.allowed_rsvp_statuses = undefined;
    }

    // Clear empty strings
    if (!submitData.description) submitData.description = undefined;
    if (!submitData.location) submitData.location = undefined;
    if (!submitData.location_details) submitData.location_details = undefined;
    if (!submitData.rsvp_deadline) submitData.rsvp_deadline = undefined;

    try {
      await onSubmit(submitData);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4" role="alert">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* === Basics === */}
      <section>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Event Details</h3>
        <div className="space-y-4">
          {/* Title */}
          <div>
            <label htmlFor="event-title" className="block text-sm font-medium text-gray-700">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="event-title"
              required
              maxLength={200}
              value={formData.title}
              onChange={(e) => update({ title: e.target.value })}
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
              placeholder="e.g., Monthly Business Meeting"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="event-description" className="block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              id="event-description"
              rows={3}
              value={formData.description || ''}
              onChange={(e) => update({ description: e.target.value })}
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
              placeholder="What is this event about?"
            />
          </div>

          {/* Event Type */}
          <div>
            <label htmlFor="event-type" className="block text-sm font-medium text-gray-700">
              Event Type <span className="text-red-500">*</span>
            </label>
            <select
              id="event-type"
              required
              value={formData.event_type}
              onChange={(e) => update({ event_type: e.target.value as EventType })}
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
            >
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {getEventTypeLabel(type)}
                </option>
              ))}
            </select>
            {formData.event_type === 'training' && (
              <p className="mt-1 text-xs text-purple-600">
                For training events with course tracking, use "Create Training Session" instead.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* === Schedule === */}
      <section>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Schedule</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="start-datetime" className="block text-sm font-medium text-gray-700">
                Start Date & Time <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                id="start-datetime"
                required
                value={formData.start_datetime}
                onChange={(e) => handleStartDateChange(e.target.value)}
                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
              />
            </div>
            <div>
              <label htmlFor="end-datetime" className="block text-sm font-medium text-gray-700">
                End Date & Time <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                id="end-datetime"
                required
                value={formData.end_datetime}
                onChange={(e) => update({ end_datetime: e.target.value })}
                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
              />
            </div>
          </div>

          {/* Quick Duration */}
          <div>
            <span className="block text-sm font-medium text-gray-700 mb-2">Quick Duration</span>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 4, 8].map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setDuration(h)}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  {h} {h === 1 ? 'hour' : 'hours'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* === Location === */}
      <section>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Location</h3>
        <div className="space-y-4">
          {locations.length > 0 && (
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="location-mode"
                  checked={locationMode === 'select'}
                  onChange={() => handleLocationModeChange('select')}
                  className="text-red-600 focus:ring-red-500"
                />
                Choose a location
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="location-mode"
                  checked={locationMode === 'other'}
                  onChange={() => handleLocationModeChange('other')}
                  className="text-red-600 focus:ring-red-500"
                />
                Other / Enter manually
              </label>
            </div>
          )}

          {locationMode === 'select' && locations.length > 0 ? (
            <div>
              <label htmlFor="location-select" className="block text-sm font-medium text-gray-700">
                Location
              </label>
              <select
                id="location-select"
                value={formData.location_id || ''}
                onChange={(e) => update({ location_id: e.target.value || undefined })}
                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
              >
                <option value="">-- Select a location --</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label htmlFor="location-text" className="block text-sm font-medium text-gray-700">
                Location
              </label>
              <input
                type="text"
                id="location-text"
                maxLength={300}
                value={formData.location || ''}
                onChange={(e) => update({ location: e.target.value })}
                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                placeholder="e.g., Station 1 Conference Room"
              />
            </div>
          )}

          <div>
            <label htmlFor="location-details" className="block text-sm font-medium text-gray-700">
              Additional Directions
            </label>
            <input
              type="text"
              id="location-details"
              value={formData.location_details || ''}
              onChange={(e) => update({ location_details: e.target.value })}
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
              placeholder="e.g., Enter through side door, Room 204"
            />
          </div>
        </div>
      </section>

      {/* === Attendance === */}
      <section>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Attendance</h3>
        <div className="space-y-4">
          <div className="flex items-center">
            <input
              type="checkbox"
              id="is-mandatory"
              checked={formData.is_mandatory}
              onChange={(e) => update({ is_mandatory: e.target.checked })}
              className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
            />
            <label htmlFor="is-mandatory" className="ml-2 block text-sm text-gray-700">
              Mandatory attendance
            </label>
          </div>

          {/* Eligible Roles */}
          {roles.length > 0 && (
            <div>
              <span className="block text-sm font-medium text-gray-700 mb-2">
                Eligible Roles
              </span>
              <p className="text-xs text-gray-500 mb-2">
                Leave all unchecked to allow all members. Check specific roles to restrict attendance.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {roles.map((role) => (
                  <label key={role.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={formData.eligible_roles?.includes(role.slug) || false}
                      onChange={(e) => toggleEligibleRole(role.slug, e.target.checked)}
                      className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                    />
                    {role.name}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* === RSVP Settings === */}
      <section>
        <h3 className="text-lg font-medium text-gray-900 mb-4">RSVP Settings</h3>
        <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center">
            <input
              type="checkbox"
              id="requires-rsvp"
              checked={formData.requires_rsvp}
              onChange={(e) => update({ requires_rsvp: e.target.checked })}
              className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
            />
            <label htmlFor="requires-rsvp" className="ml-2 block text-sm text-gray-700">
              Require RSVP
            </label>
          </div>

          {formData.requires_rsvp && (
            <div className="space-y-4 pl-6 border-l-2 border-gray-200">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="rsvp-deadline" className="block text-sm font-medium text-gray-700">
                    RSVP Deadline
                  </label>
                  <input
                    type="datetime-local"
                    id="rsvp-deadline"
                    value={formData.rsvp_deadline || ''}
                    onChange={(e) => update({ rsvp_deadline: e.target.value })}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="max-attendees" className="block text-sm font-medium text-gray-700">
                    Max Attendees
                  </label>
                  <input
                    type="number"
                    id="max-attendees"
                    min="1"
                    value={formData.max_attendees || ''}
                    onChange={(e) => update({ max_attendees: e.target.value ? parseInt(e.target.value) : undefined })}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                    placeholder="Unlimited"
                  />
                </div>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="allow-guests"
                  checked={formData.allow_guests}
                  onChange={(e) => update({ allow_guests: e.target.checked })}
                  className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                />
                <label htmlFor="allow-guests" className="ml-2 block text-sm text-gray-700">
                  Allow guests
                </label>
              </div>

              <fieldset>
                <legend className="block text-sm font-medium text-gray-700 mb-2">
                  RSVP Status Options
                </legend>
                <div className="flex gap-4">
                  {(['going', 'not_going', 'maybe'] as RSVPStatus[]).map((status) => (
                    <label key={status} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={formData.allowed_rsvp_statuses?.includes(status) || false}
                        onChange={(e) => toggleRsvpStatus(status, e.target.checked)}
                        className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                      />
                      {status === 'going' ? 'Going' : status === 'not_going' ? 'Not Going' : 'Maybe'}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
        </div>
      </section>

      {/* === Check-In Settings === */}
      <section>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Check-In Settings</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="checkin-window" className="block text-sm font-medium text-gray-700">
              Check-In Window
            </label>
            <select
              id="checkin-window"
              value={formData.check_in_window_type || 'flexible'}
              onChange={(e) => update({ check_in_window_type: e.target.value as 'flexible' | 'strict' | 'window' })}
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
            >
              <option value="flexible">Flexible - Anytime before event ends</option>
              <option value="strict">Strict - Only during actual event time</option>
              <option value="window">Window - Custom minutes before/after start</option>
            </select>
          </div>

          {formData.check_in_window_type === 'window' && (
            <div className="grid grid-cols-2 gap-4 pl-6 border-l-2 border-gray-200">
              <div>
                <label htmlFor="checkin-before" className="block text-sm font-medium text-gray-700">
                  Minutes before start
                </label>
                <input
                  type="number"
                  id="checkin-before"
                  min="0"
                  max="120"
                  value={formData.check_in_minutes_before || 15}
                  onChange={(e) => update({ check_in_minutes_before: parseInt(e.target.value) || 15 })}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor="checkin-after" className="block text-sm font-medium text-gray-700">
                  Minutes after start
                </label>
                <input
                  type="number"
                  id="checkin-after"
                  min="0"
                  max="120"
                  value={formData.check_in_minutes_after || 15}
                  onChange={(e) => update({ check_in_minutes_after: parseInt(e.target.value) || 15 })}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                />
              </div>
            </div>
          )}

          <div className="flex items-center">
            <input
              type="checkbox"
              id="require-checkout"
              checked={formData.require_checkout}
              onChange={(e) => update({ require_checkout: e.target.checked })}
              className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
            />
            <label htmlFor="require-checkout" className="ml-2 block text-sm text-gray-700">
              Require manual check-out
            </label>
          </div>
        </div>
      </section>

      {/* === Notifications === */}
      <section>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Notifications</h3>
        <div className="space-y-4">
          <div className="flex items-center">
            <input
              type="checkbox"
              id="send-reminders"
              checked={formData.send_reminders}
              onChange={(e) => update({ send_reminders: e.target.checked })}
              className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
            />
            <label htmlFor="send-reminders" className="ml-2 block text-sm text-gray-700">
              Send event reminders
            </label>
          </div>

          {formData.send_reminders && (
            <div className="pl-6 border-l-2 border-gray-200">
              <label htmlFor="reminder-hours" className="block text-sm font-medium text-gray-700">
                Reminder hours before event
              </label>
              <select
                id="reminder-hours"
                value={formData.reminder_hours_before || 24}
                onChange={(e) => update({ reminder_hours_before: parseInt(e.target.value) })}
                className="mt-1 block w-48 border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
              >
                <option value={1}>1 hour</option>
                <option value={2}>2 hours</option>
                <option value={4}>4 hours</option>
                <option value={12}>12 hours</option>
                <option value={24}>24 hours (1 day)</option>
                <option value={48}>48 hours (2 days)</option>
                <option value={72}>72 hours (3 days)</option>
                <option value={168}>168 hours (1 week)</option>
              </select>
            </div>
          )}
        </div>
      </section>

      {/* === Actions === */}
      <div className="flex justify-end gap-3 pt-6 border-t border-gray-200">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-6 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  );
};
