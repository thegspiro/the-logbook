/**
 * EventForm Component
 *
 * Reusable form for creating and editing events.
 * Supports location picker, role-based eligibility, RSVP settings,
 * check-in window configuration, and reminder settings.
 */

import React, { useEffect, useState, useMemo } from 'react';
import {
  FileText,
  Clock,
  MapPin,
  Users,
  Mail,
  QrCode,
  Bell,
  Repeat,
  AlertTriangle,
} from 'lucide-react';
import type { EventCreate, RecurringEventCreate, RecurrencePattern, EventType, EventCategoryConfig, RSVPStatus } from '../types/event';
import { eventService, locationsService } from '../services/api';
import { EventType as EventTypeEnum, RSVPStatus as RSVPStatusEnum, CheckInWindowType } from '../constants/enums';
import type { Location } from '../services/api';
import { getEventTypeLabel } from '../utils/eventHelpers';
import { getErrorMessage } from '../utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { formatForDateTimeInput, localToUTC } from '../utils/dateFormatting';

export interface ConflictEvent {
  id: string;
  title: string;
  start_datetime: string;
  end_datetime: string;
}

interface EventFormProps {
  initialData?: Partial<EventCreate> | undefined;
  onSubmit: (data: EventCreate) => Promise<void>;
  onSubmitRecurring?: (data: RecurringEventCreate) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
  isSubmitting?: boolean;
  showRecurrence?: boolean;
  /** Events the user has RSVP'd to, used for conflict detection */
  userEvents?: ConflictEvent[] | undefined;
  /** When editing, the ID of the current event (excluded from conflict checks) */
  editingEventId?: string | undefined;
}

const EVENT_TYPES: EventType[] = [
  EventTypeEnum.BUSINESS_MEETING,
  EventTypeEnum.PUBLIC_EDUCATION,
  EventTypeEnum.TRAINING,
  EventTypeEnum.SOCIAL,
  EventTypeEnum.FUNDRAISER,
  EventTypeEnum.CEREMONY,
  EventTypeEnum.OTHER,
];

const DEFAULT_FORM_DATA: EventCreate = {
  title: '',
  description: '',
  event_type: EventTypeEnum.BUSINESS_MEETING,
  custom_category: undefined,
  location_id: undefined,
  location: '',
  location_details: '',
  start_datetime: '',
  end_datetime: '',
  requires_rsvp: false,
  rsvp_deadline: '',
  max_attendees: undefined,
  allowed_rsvp_statuses: [RSVPStatusEnum.GOING, RSVPStatusEnum.NOT_GOING],
  is_mandatory: false,
  allow_guests: false,
  send_reminders: true,
  reminder_schedule: [24],
  check_in_window_type: 'flexible',
  check_in_minutes_before: 15,
  check_in_minutes_after: 15,
  require_checkout: false,
  is_draft: false,
};

/* Shared Tailwind classes for consistency */
const inputClass =
  'w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring';

const selectClass =
  'w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring';

const labelClass = 'block text-sm font-semibold text-theme-text-primary mb-2';

const checkboxClass =
  'w-4 h-4 rounded-sm border-theme-input-border bg-theme-input-bg text-blue-600 focus:ring-theme-focus-ring';

const RECURRENCE_PATTERNS: { value: RecurrencePattern; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 Weeks' },
  { value: 'monthly', label: 'Monthly (same date)' },
  { value: 'monthly_weekday', label: 'Monthly (by weekday)' },
  { value: 'annually', label: 'Annually (same date)' },
  { value: 'annually_weekday', label: 'Annually (by weekday)' },
  { value: 'custom', label: 'Custom Days' },
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const ORDINALS = [
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
  { value: 4, label: '4th' },
  { value: 5, label: '5th' },
  { value: -1, label: 'Last' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const EventForm: React.FC<EventFormProps> = ({
  initialData,
  onSubmit,
  onSubmitRecurring,
  onCancel,
  submitLabel = 'Create Event',
  isSubmitting = false,
  showRecurrence = false,
  userEvents,
  editingEventId,
}) => {
  const tz = useTimezone();

  // Convert any ISO date strings from the API into datetime-local format
  // in the user's timezone so the inputs display correctly.
  const normalizedInitial = initialData
    ? {
        ...initialData,
        start_datetime: initialData.start_datetime
          ? formatForDateTimeInput(initialData.start_datetime, tz)
          : initialData.start_datetime,
        end_datetime: initialData.end_datetime
          ? formatForDateTimeInput(initialData.end_datetime, tz)
          : initialData.end_datetime,
        rsvp_deadline: initialData.rsvp_deadline
          ? formatForDateTimeInput(initialData.rsvp_deadline, tz)
          : initialData.rsvp_deadline,
      }
    : undefined;

  const [formData, setFormData] = useState<EventCreate>({
    ...DEFAULT_FORM_DATA,
    ...normalizedInitial,
  });
  const [error, setError] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationMode, setLocationMode] = useState<'select' | 'other'>(
    initialData?.location ? 'other' : 'select'
  );
  const [visibleTypes, setVisibleTypes] = useState<EventType[]>(EVENT_TYPES);
  const [customCategories, setCustomCategories] = useState<EventCategoryConfig[]>([]);
  const [visibleCustomCategories, setVisibleCustomCategories] = useState<string[]>([]);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern>('weekly');
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [recurrenceCustomDays, setRecurrenceCustomDays] = useState<number[]>([]);
  const [recurrenceWeekday, setRecurrenceWeekday] = useState(0);
  const [recurrenceWeekOrdinal, setRecurrenceWeekOrdinal] = useState(1);
  const [recurrenceMonth, setRecurrenceMonth] = useState(1);
  const [recurrenceExceptions, setRecurrenceExceptions] = useState<string[]>([]);
  const [newExceptionDate, setNewExceptionDate] = useState('');

  // Conflict detection: check if the selected time range overlaps with user's existing events
  const conflicts = useMemo(() => {
    if (!userEvents || !formData.start_datetime || !formData.end_datetime) return [];
    const startA = new Date(formData.start_datetime).getTime();
    const endA = new Date(formData.end_datetime).getTime();
    if (isNaN(startA) || isNaN(endA) || endA <= startA) return [];
    return userEvents.filter((evt) => {
      if (editingEventId && evt.id === editingEventId) return false;
      const startB = new Date(evt.start_datetime).getTime();
      const endB = new Date(evt.end_datetime).getTime();
      return startA < endB && endA > startB;
    });
  }, [userEvents, formData.start_datetime, formData.end_datetime, editingEventId]);

  useEffect(() => {
    void loadLocations();
    eventService.getVisibleEventTypesWithCategories()
      .then((data) => {
        setVisibleTypes(data.visible_event_types);
        setCustomCategories(data.custom_event_categories || []);
        setVisibleCustomCategories(data.visible_custom_categories || []);
      })
      .catch(() => { /* fall back to showing all types */ });
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

  const update = (partial: Partial<EventCreate>) => {
    setFormData((prev) => ({ ...prev, ...partial }));
  };

  const handleStartDateChange = (startDate: string) => {
    const changes: Partial<EventCreate> = { start_datetime: startDate };
    // Auto-set end date to 2 hours later if not already set
    if (!formData.end_datetime && startDate) {
      const start = new Date(startDate);
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      changes.end_datetime = formatForDateTimeInput(end);
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
    update({ end_datetime: formatForDateTimeInput(end) });
  };

  const toggleRsvpStatus = (status: RSVPStatus, checked: boolean) => {
    const statuses = formData.allowed_rsvp_statuses || [];
    if (checked) {
      update({ allowed_rsvp_statuses: [...statuses, status] });
    } else {
      update({ allowed_rsvp_statuses: statuses.filter((s) => s !== status) });
    }
  };

  const handleLocationSelect = (value: string) => {
    if (value === '__other__') {
      setLocationMode('other');
      update({ location_id: undefined, location: '' });
    } else if (value === '') {
      setLocationMode('select');
      update({ location_id: undefined, location: undefined });
    } else {
      setLocationMode('select');
      update({ location_id: value, location: undefined });
    }
  };

  const selectedLocation = locations.find((l) => l.id === formData.location_id);

  const formatLocationAddress = (loc: Location) => {
    const parts: string[] = [];
    if (loc.address) parts.push(loc.address);
    if (loc.city) parts.push(loc.city);
    if (loc.state && loc.zip) {
      parts.push(`${loc.state} ${loc.zip}`);
    } else if (loc.state) {
      parts.push(loc.state);
    }
    return parts.join(', ');
  };

  const formatLocationLabel = (loc: Location) => {
    const parts = [loc.name];
    if (loc.building) parts.push(`(${loc.building})`);
    const addr = [loc.address, loc.city].filter(Boolean).join(', ');
    if (addr) parts.push(`— ${addr}`);
    return parts.join(' ');
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

    // Convert local datetime-local values to UTC before sending to backend
    submitData.start_datetime = localToUTC(submitData.start_datetime, tz);
    submitData.end_datetime = localToUTC(submitData.end_datetime, tz);
    if (submitData.rsvp_deadline) {
      submitData.rsvp_deadline = localToUTC(submitData.rsvp_deadline, tz);
    }

    try {
      if (isRecurring && onSubmitRecurring) {
        if (!recurrenceEndDate) {
          setError('Recurrence end date is required');
          return;
        }
        if (recurrencePattern === 'custom' && recurrenceCustomDays.length === 0) {
          setError('Select at least one day for custom recurrence');
          return;
        }
        const needsWeekday = recurrencePattern === 'monthly_weekday' || recurrencePattern === 'annually_weekday';
        const recurringData: RecurringEventCreate = {
          ...submitData,
          recurrence_pattern: recurrencePattern,
          recurrence_end_date: localToUTC(recurrenceEndDate + 'T23:59', tz),
          recurrence_custom_days: recurrencePattern === 'custom' ? recurrenceCustomDays : undefined,
          recurrence_weekday: needsWeekday ? recurrenceWeekday : undefined,
          recurrence_week_ordinal: needsWeekday ? recurrenceWeekOrdinal : undefined,
          recurrence_month: recurrencePattern === 'annually_weekday' ? recurrenceMonth : undefined,
          recurrence_exceptions: recurrenceExceptions.length > 0 ? recurrenceExceptions : undefined,
        };
        await onSubmitRecurring(recurringData);
      } else {
        await onSubmit(submitData);
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'An error occurred');
      setError(message);
    }
  };

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-8">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* === Event Details === */}
      <section className="space-y-6">
        <h2 className="text-xl font-bold text-theme-text-primary flex items-center space-x-2">
          <FileText className="w-5 h-5 text-red-700" />
          <span>Event Details</span>
        </h2>

        {/* Title */}
        <div>
          <label htmlFor="event-title" className={labelClass}>
            Title <span className="text-red-700 dark:text-red-500">*</span>
          </label>
          <input
            type="text"
            id="event-title"
            required
            maxLength={200}
            value={formData.title}
            onChange={(e) => update({ title: e.target.value })}
            className={inputClass}
            placeholder="e.g., Monthly Business Meeting"
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="event-description" className={labelClass}>
            Description
          </label>
          <textarea
            id="event-description"
            rows={4}
            value={formData.description || ''}
            onChange={(e) => update({ description: e.target.value })}
            className={inputClass}
            placeholder="What is this event about?"
          />
        </div>

        {/* Event Type */}
        <div>
          <label htmlFor="event-type" className={labelClass}>
            Event Type <span className="text-red-700 dark:text-red-500">*</span>
          </label>
          <select
            id="event-type"
            required
            value={formData.event_type}
            onChange={(e) => update({ event_type: e.target.value as EventType })}
            className={selectClass}
          >
            {EVENT_TYPES.filter((t) => visibleTypes.includes(t)).map((type) => (
              <option key={type} value={type}>
                {getEventTypeLabel(type)}
              </option>
            ))}
            {EVENT_TYPES.some((t) => !visibleTypes.includes(t)) && (
              <optgroup label="Other">
                {EVENT_TYPES.filter((t) => !visibleTypes.includes(t)).map((type) => (
                  <option key={type} value={type}>
                    {getEventTypeLabel(type)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {formData.event_type === EventTypeEnum.TRAINING && (
            <div className="mt-2 bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
              <p className="text-sm text-purple-700 dark:text-purple-300">
                For training events with course tracking, use "Create Training Session" instead.
              </p>
            </div>
          )}
        </div>

        {/* Custom Category (optional) */}
        {customCategories.length > 0 && (
          <div>
            <label htmlFor="custom-category" className={labelClass}>
              Category
            </label>
            <select
              id="custom-category"
              value={formData.custom_category || ''}
              onChange={(e) => update(e.target.value ? { custom_category: e.target.value } : { custom_category: undefined })}
              className={selectClass}
            >
              <option value="">None</option>
              {customCategories.filter((c) => visibleCustomCategories.includes(c.value)).map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
              {customCategories.some((c) => !visibleCustomCategories.includes(c.value)) && (
                <optgroup label="Other">
                  {customCategories.filter((c) => !visibleCustomCategories.includes(c.value)).map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        )}
      </section>

      <hr className="border-theme-surface-border" />

      {/* === Schedule === */}
      <section className="space-y-6">
        <h2 className="text-xl font-bold text-theme-text-primary flex items-center space-x-2">
          <Clock className="w-5 h-5 text-red-700" />
          <span>Schedule</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="start-datetime" className={labelClass}>
              Start Date & Time <span className="text-red-700 dark:text-red-500">*</span>
            </label>
            <input
              type="datetime-local"
              step="900"
              id="start-datetime"
              required
              value={formData.start_datetime}
              onChange={(e) => handleStartDateChange(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="end-datetime" className={labelClass}>
              End Date & Time <span className="text-red-700 dark:text-red-500">*</span>
            </label>
            <input
              type="datetime-local"
              step="900"
              id="end-datetime"
              required
              value={formData.end_datetime}
              onChange={(e) => update({ end_datetime: e.target.value })}
              className={inputClass}
            />
          </div>
        </div>

        {/* Conflict Warning */}
        {conflicts.length > 0 && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4" role="status">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200">
                  Schedule Conflict Detected
                </p>
                <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                  This time overlaps with {conflicts.length === 1 ? 'an event' : 'events'} you have RSVP&apos;d to:
                </p>
                <ul className="mt-2 space-y-1">
                  {conflicts.map((evt) => (
                    <li key={evt.id} className="text-sm text-yellow-700 dark:text-yellow-300">
                      &bull; {evt.title} ({formatForDateTimeInput(evt.start_datetime, tz)} &ndash; {formatForDateTimeInput(evt.end_datetime, tz)})
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Quick Duration */}
        <div>
          <span className={labelClass}>Quick Duration</span>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 4, 8].map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setDuration(h)}
                className="px-4 py-2 text-sm font-medium text-theme-text-secondary border border-theme-surface-border rounded-lg hover:bg-theme-surface-secondary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring transition-colors"
              >
                {h} {h === 1 ? 'hour' : 'hours'}
              </button>
            ))}
          </div>
        </div>

        {/* Recurrence */}
        {showRecurrence && (
          <>
            <div className="flex items-center space-x-3 pt-2">
              <input
                type="checkbox"
                id="is-recurring"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
                className={checkboxClass}
              />
              <label htmlFor="is-recurring" className="text-sm text-theme-text-secondary flex items-center gap-2">
                <Repeat className="w-4 h-4" />
                Make this a recurring event
              </label>
            </div>

            {isRecurring && (
              <div className="space-y-4 pl-6 border-l-2 border-red-500/30">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="recurrence-pattern" className={labelClass}>
                      Repeats <span className="text-red-700 dark:text-red-500">*</span>
                    </label>
                    <select
                      id="recurrence-pattern"
                      value={recurrencePattern}
                      onChange={(e) => setRecurrencePattern(e.target.value as RecurrencePattern)}
                      className={selectClass}
                    >
                      {RECURRENCE_PATTERNS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="recurrence-end-date" className={labelClass}>
                      Repeat Until <span className="text-red-700 dark:text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      id="recurrence-end-date"
                      value={recurrenceEndDate}
                      onChange={(e) => setRecurrenceEndDate(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>

                {recurrencePattern === 'custom' && (
                  <div>
                    <label className={labelClass}>Days of the Week</label>
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAYS.map((day, index) => (
                        <button
                          key={day}
                          type="button"
                          onClick={() => {
                            setRecurrenceCustomDays((prev) =>
                              prev.includes(index) ? prev.filter((d) => d !== index) : [...prev, index]
                            );
                          }}
                          className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
                            recurrenceCustomDays.includes(index)
                              ? 'bg-red-700 text-white border-red-700'
                              : 'text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-secondary'
                          }`}
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {(recurrencePattern === 'monthly_weekday' || recurrencePattern === 'annually_weekday') && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="recurrence-ordinal" className={labelClass}>
                        Which Occurrence
                      </label>
                      <select
                        id="recurrence-ordinal"
                        value={recurrenceWeekOrdinal}
                        onChange={(e) => setRecurrenceWeekOrdinal(parseInt(e.target.value))}
                        className={selectClass}
                      >
                        {ORDINALS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="recurrence-weekday" className={labelClass}>
                        Day of Week
                      </label>
                      <select
                        id="recurrence-weekday"
                        value={recurrenceWeekday}
                        onChange={(e) => setRecurrenceWeekday(parseInt(e.target.value))}
                        className={selectClass}
                      >
                        {WEEKDAYS.map((day, index) => (
                          <option key={day} value={index}>{day}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {recurrencePattern === 'annually_weekday' && (
                  <div className="max-w-xs">
                    <label htmlFor="recurrence-month" className={labelClass}>
                      Month
                    </label>
                    <select
                      id="recurrence-month"
                      value={recurrenceMonth}
                      onChange={(e) => setRecurrenceMonth(parseInt(e.target.value))}
                      className={selectClass}
                    >
                      {MONTHS.map((m, index) => (
                        <option key={m} value={index + 1}>{m}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Exception Dates */}
                <div>
                  <label className={labelClass}>Exception Dates (dates to skip)</label>
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="date"
                      value={newExceptionDate}
                      onChange={(e) => setNewExceptionDate(e.target.value)}
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (newExceptionDate && !recurrenceExceptions.includes(newExceptionDate)) {
                          setRecurrenceExceptions((prev) => [...prev, newExceptionDate]);
                          setNewExceptionDate('');
                        }
                      }}
                      disabled={!newExceptionDate}
                      className="px-4 py-2 text-sm font-medium rounded-lg bg-red-700 text-white hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      Add
                    </button>
                  </div>
                  {recurrenceExceptions.length > 0 && (
                    <ul className="space-y-1">
                      {recurrenceExceptions.map((date) => (
                        <li key={date} className="flex items-center justify-between bg-theme-surface-secondary rounded px-3 py-1.5 text-sm">
                          <span className="text-theme-text-primary">{date}</span>
                          <button
                            type="button"
                            onClick={() => setRecurrenceExceptions((prev) => prev.filter((d) => d !== date))}
                            className="text-red-500 hover:text-red-700 text-xs font-medium"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    Individual events will be created for each occurrence. You can edit or cancel them independently after creation.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <hr className="border-theme-surface-border" />

      {/* === Location === */}
      <section className="space-y-6">
        <h2 className="text-xl font-bold text-theme-text-primary flex items-center space-x-2">
          <MapPin className="w-5 h-5 text-red-700" />
          <span>Location</span>
        </h2>

        <div>
          <label htmlFor="location-select" className={labelClass}>
            Location
          </label>
          {locations.length > 0 ? (
            <select
              id="location-select"
              value={locationMode === 'other' ? '__other__' : (formData.location_id || '')}
              onChange={(e) => handleLocationSelect(e.target.value)}
              className={selectClass}
            >
              <option value="">-- Select a location --</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {formatLocationLabel(loc)}
                </option>
              ))}
              <option value="__other__">Other (off-site / enter manually)</option>
            </select>
          ) : (
            <input
              type="text"
              id="location-text-fallback"
              maxLength={300}
              value={formData.location || ''}
              onChange={(e) => update({ location: e.target.value })}
              className={inputClass}
              placeholder="e.g., Station 1 Conference Room"
            />
          )}
        </div>

        {/* Show selected location details */}
        {locationMode === 'select' && selectedLocation && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-blue-700 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-theme-text-primary">{selectedLocation.name}</p>
                {selectedLocation.building && (
                  <p className="text-sm text-theme-text-secondary mt-0.5">Building: {selectedLocation.building}</p>
                )}
                {formatLocationAddress(selectedLocation) && (
                  <p className="text-sm text-theme-text-secondary mt-0.5">{formatLocationAddress(selectedLocation)}</p>
                )}
                <div className="flex flex-wrap gap-4 mt-2">
                  {selectedLocation.room_number && (
                    <span className="inline-flex items-center text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-500/10 px-2.5 py-1 rounded-full">
                      Room {selectedLocation.room_number}
                    </span>
                  )}
                  {selectedLocation.capacity && (
                    <span className="inline-flex items-center text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-500/10 px-2.5 py-1 rounded-full">
                      Capacity: {selectedLocation.capacity}
                    </span>
                  )}
                  {selectedLocation.floor && (
                    <span className="inline-flex items-center text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-500/10 px-2.5 py-1 rounded-full">
                      Floor {selectedLocation.floor}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Free-text location when "Other" is selected */}
        {locationMode === 'other' && locations.length > 0 && (
          <div>
            <label htmlFor="location-text" className={labelClass}>
              Location Name / Address
            </label>
            <input
              type="text"
              id="location-text"
              maxLength={300}
              value={formData.location || ''}
              onChange={(e) => update({ location: e.target.value })}
              className={inputClass}
              placeholder="e.g., City Hall — 123 Main St, Anytown"
            />
          </div>
        )}

        <div>
          <label htmlFor="location-details" className={labelClass}>
            Additional Directions
          </label>
          <input
            type="text"
            id="location-details"
            value={formData.location_details || ''}
            onChange={(e) => update({ location_details: e.target.value })}
            className={inputClass}
            placeholder="e.g., Enter through side door, Room 204"
          />
        </div>
      </section>

      <hr className="border-theme-surface-border" />

      {/* === Attendance === */}
      <section className="space-y-6">
        <h2 className="text-xl font-bold text-theme-text-primary flex items-center space-x-2">
          <Users className="w-5 h-5 text-red-700" />
          <span>Attendance</span>
        </h2>

        <div className="flex items-center space-x-3">
          <input
            type="checkbox"
            id="is-mandatory"
            checked={formData.is_mandatory}
            onChange={(e) => update({ is_mandatory: e.target.checked })}
            className={checkboxClass}
          />
          <label htmlFor="is-mandatory" className="text-sm text-theme-text-secondary">
            Mandatory attendance
          </label>
        </div>

      </section>

      <hr className="border-theme-surface-border" />

      {/* === RSVP Settings === */}
      <section className="space-y-6">
        <h2 className="text-xl font-bold text-theme-text-primary flex items-center space-x-2">
          <Mail className="w-5 h-5 text-red-700" />
          <span>RSVP Settings</span>
        </h2>

        <div className="flex items-center space-x-3">
          <input
            type="checkbox"
            id="requires-rsvp"
            checked={formData.requires_rsvp}
            onChange={(e) => update({ requires_rsvp: e.target.checked })}
            className={checkboxClass}
          />
          <label htmlFor="requires-rsvp" className="text-sm text-theme-text-secondary">
            Require RSVP
          </label>
        </div>

        {formData.requires_rsvp && (
          <div className="space-y-4 pl-6 border-l-2 border-red-500/30">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="rsvp-deadline" className={labelClass}>
                  RSVP Deadline
                </label>
                <input
                  type="datetime-local"
                  step="900"
                  id="rsvp-deadline"
                  value={formData.rsvp_deadline || ''}
                  onChange={(e) => update({ rsvp_deadline: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="max-attendees" className={labelClass}>
                  Max Attendees
                </label>
                <input
                  type="number"
                  id="max-attendees"
                  min="1"
                  value={formData.max_attendees || ''}
                  onChange={(e) => update({ max_attendees: e.target.value ? parseInt(e.target.value) : undefined })}
                  className={inputClass}
                  placeholder="Unlimited"
                />
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="allow-guests"
                checked={formData.allow_guests}
                onChange={(e) => update({ allow_guests: e.target.checked })}
                className={checkboxClass}
              />
              <label htmlFor="allow-guests" className="text-sm text-theme-text-secondary">
                Allow guests
              </label>
            </div>

            <fieldset>
              <legend className={labelClass}>RSVP Status Options</legend>
              <div className="flex gap-4">
                {([RSVPStatusEnum.GOING, RSVPStatusEnum.NOT_GOING, RSVPStatusEnum.MAYBE] as RSVPStatus[]).map((status) => (
                  <label key={status} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.allowed_rsvp_statuses?.includes(status) || false}
                      onChange={(e) => toggleRsvpStatus(status, e.target.checked)}
                      className={checkboxClass}
                    />
                    <span className="text-theme-text-secondary">
                      {status === RSVPStatusEnum.GOING ? 'Going' : status === RSVPStatusEnum.NOT_GOING ? 'Not Going' : 'Maybe'}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}
      </section>

      <hr className="border-theme-surface-border" />

      {/* === Check-In Settings === */}
      <section className="space-y-6">
        <h2 className="text-xl font-bold text-theme-text-primary flex items-center space-x-2">
          <QrCode className="w-5 h-5 text-red-700" />
          <span>Check-In Settings</span>
        </h2>

        <div>
          <label htmlFor="checkin-window" className={labelClass}>
            Check-In Window
          </label>
          <select
            id="checkin-window"
            value={formData.check_in_window_type || 'flexible'}
            onChange={(e) => update({ check_in_window_type: e.target.value as 'flexible' | 'strict' | 'window' })}
            className={selectClass}
          >
            <option value="flexible">Flexible - Anytime before event ends</option>
            <option value="strict">Strict - Only during actual event time</option>
            <option value="window">Window - Custom minutes before/after start</option>
          </select>
        </div>

        {formData.check_in_window_type === CheckInWindowType.WINDOW && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-6 border-l-2 border-red-500/30">
            <div>
              <label htmlFor="checkin-before" className={labelClass}>
                Minutes before start
              </label>
              <input
                type="number"
                id="checkin-before"
                min="0"
                max="120"
                value={formData.check_in_minutes_before || 15}
                onChange={(e) => update({ check_in_minutes_before: parseInt(e.target.value) || 15 })}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="checkin-after" className={labelClass}>
                Minutes after start
              </label>
              <input
                type="number"
                id="checkin-after"
                min="0"
                max="120"
                value={formData.check_in_minutes_after || 15}
                onChange={(e) => update({ check_in_minutes_after: parseInt(e.target.value) || 15 })}
                className={inputClass}
              />
            </div>
          </div>
        )}

        <div className="flex items-center space-x-3">
          <input
            type="checkbox"
            id="require-checkout"
            checked={formData.require_checkout}
            onChange={(e) => update({ require_checkout: e.target.checked })}
            className={checkboxClass}
          />
          <label htmlFor="require-checkout" className="text-sm text-theme-text-secondary">
            Require manual check-out
          </label>
        </div>
      </section>

      <hr className="border-theme-surface-border" />

      {/* === Notifications === */}
      <section className="space-y-6">
        <h2 className="text-xl font-bold text-theme-text-primary flex items-center space-x-2">
          <Bell className="w-5 h-5 text-red-700" />
          <span>Notifications</span>
        </h2>

        <div className="flex items-center space-x-3">
          <input
            type="checkbox"
            id="send-reminders"
            checked={formData.send_reminders}
            onChange={(e) => update({ send_reminders: e.target.checked })}
            className={checkboxClass}
          />
          <label htmlFor="send-reminders" className="text-sm text-theme-text-secondary">
            Send event reminders
          </label>
        </div>

        {formData.send_reminders && (
          <div className="pl-6 border-l-2 border-red-500/30 space-y-3">
            <label className={labelClass}>Reminder Schedule</label>

            {/* Selected reminders as tags */}
            {(formData.reminder_schedule || [24]).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {[...(formData.reminder_schedule || [24])]
                  .sort((a, b) => b - a)
                  .map((hours) => (
                    <span
                      key={hours}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/30"
                    >
                      {hours >= 168
                        ? `${Math.floor(hours / 168)} week${hours >= 336 ? 's' : ''}`
                        : hours >= 24
                          ? `${Math.floor(hours / 24)} day${hours >= 48 ? 's' : ''}`
                          : `${hours} hour${hours !== 1 ? 's' : ''}`}{' '}
                      before
                      <button
                        type="button"
                        onClick={() =>
                          update({
                            reminder_schedule: (formData.reminder_schedule || [24]).filter(
                              (h) => h !== hours
                            ),
                          })
                        }
                        className="ml-0.5 hover:text-red-900 dark:hover:text-red-100"
                        aria-label={`Remove ${hours}-hour reminder`}
                      >
                        &times;
                      </button>
                    </span>
                  ))}
              </div>
            )}

            {/* Add reminder dropdown */}
            <select
              id="add-reminder"
              value=""
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (val && !(formData.reminder_schedule || []).includes(val)) {
                  update({ reminder_schedule: [...(formData.reminder_schedule || []), val] });
                }
              }}
              className="form-input max-w-xs py-3"
            >
              <option value="">+ Add a reminder...</option>
              {[
                { value: 1, label: '1 hour before' },
                { value: 2, label: '2 hours before' },
                { value: 4, label: '4 hours before' },
                { value: 12, label: '12 hours before' },
                { value: 24, label: '1 day before' },
                { value: 48, label: '2 days before' },
                { value: 72, label: '3 days before' },
                { value: 168, label: '1 week before' },
              ]
                .filter(({ value }) => !(formData.reminder_schedule || []).includes(value))
                .map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </select>
          </div>
        )}
      </section>

      {/* === Actions === */}
      <div className="flex items-center justify-between gap-3 pt-6 border-t border-theme-surface-border">
        <label className="inline-flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={formData.is_draft || false}
            onChange={(e) => setFormData({ ...formData, is_draft: e.target.checked })}
            className="rounded border-theme-input-border text-red-600 focus:ring-red-500"
          />
          Save as Draft
        </label>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-3 border border-theme-surface-border rounded-lg text-sm font-medium text-theme-text-secondary bg-theme-surface hover:bg-theme-surface-secondary focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary border border-transparent disabled:cursor-not-allowed font-medium px-8 py-3 text-sm"
          >
            {isSubmitting ? 'Saving...' : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
};
