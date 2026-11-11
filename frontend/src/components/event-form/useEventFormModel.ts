/**
 * The event form's state, derived values, effects, validation and payload
 * builders, apart from its markup. `EventForm` renders the sections under
 * `./sections` against this model; a second form composes the same sections
 * against the same model rather than re-implementing any of it.
 *
 * Hook order here is the order the form has always called them in, so ids
 * from `useId` and the order effects run in are unchanged by the split.
 */

import { useEffect, useId, useState, useMemo, useRef } from 'react';
import type { FormEvent } from 'react';
import type {
  EventCreate,
  RecurringEventCreate,
  RecurrencePattern,
  EventType,
  EventCategoryConfig,
  RSVPStatus,
  EventAttachment,
} from '../../types/event';
import { eventService, locationsService } from '../../services/api';
import { EventType as EventTypeEnum } from '../../constants/enums';
import type { Location } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandling';
import { useTimezone } from '../../hooks/useTimezone';
import { useAuthStore } from '../../stores/authStore';
import { formatForDateTimeInput, localToUTC } from '../../utils/dateFormatting';
import { useOrganizerOptions } from '../../hooks/useOrganizerOptions';
import { mapServerFieldErrors } from '../../utils/serverFieldErrors';
import {
  EMPTY_TRAINING_DETAILS,
  hasExplicitTrainingDetails,
  toTrainingDetailsPayload,
  type TrainingDetailsValue,
} from '../training/trainingDetailsValue';
import { asArray } from '../../utils/asArray';
import { buildingNotInName } from '../../utils/locationLabel';
import {
  DEFAULT_FORM_DATA,
  DEFAULT_MEMBERSHIP_TYPES,
  EVENT_FIELDS,
  EVENT_FIELD_IDS,
  EVENT_TYPES,
  type EventField,
} from './eventFormConstants';
import type { EventFormModelOptions } from './eventFormTypes';

export const useEventFormModel = ({
  initialData,
  onSubmit,
  onSubmitRecurring,
  initialRecurrence,
  userEvents,
  editingEventId,
  showOrganizerPickers,
  attendanceLocked,
  eventTypeLocked,
}: EventFormModelOptions) => {
  const tz = useTimezone();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const organizerOptions = useOrganizerOptions(showOrganizerPickers);
  const [organizerId, setOrganizerId] = useState('');
  const [alternateId, setAlternateId] = useState('');
  // Create Training Session lives in the Training admin hub, which only a
  // training.manage holder can open; anyone else is pointed at who can.
  const canCreateTrainingSession = useAuthStore((state) => state.checkPermission('training.manage'));

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
  // Each refusal shown under the field it is about, with aria-invalid and the
  // message tied to the control (forms review F-3/F-4), rather than one banner
  // at the top of a long form.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<EventField, string>>>({});
  const showFieldErrors = (errors: Partial<Record<EventField, string>>, unmatched: string[] = []) => {
    setFieldErrors(errors);
    // An error summary at the top, announced as an alert, for whoever does not
    // reach the field by focus; the message itself stays under its field.
    const messages = Object.values(errors);
    const summary = messages.length === 1 ? (messages[0] ?? '') : `Fix the ${messages.length} fields marked below.`;
    setError([summary, ...unmatched].filter(Boolean).join(' ') || null);
    const first = (Object.keys(EVENT_FIELD_IDS) as EventField[]).find((field) => errors[field]);
    if (first) {
      // The "Other" location box and the fallback box share the field.
      const id = first === 'location' && locations.length === 0 ? 'location-text-fallback' : EVENT_FIELD_IDS[first];
      window.setTimeout(() => document.getElementById(id)?.focus(), 0);
    }
  };
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationMode, setLocationMode] = useState<'select' | 'other'>(initialData?.location ? 'other' : 'select');
  const [visibleTypes, setVisibleTypes] = useState<EventType[]>(EVENT_TYPES);
  // Whether the guest switches currently hold values this form chose for a
  // recruitment event rather than values the coordinator set. Only auto-applied
  // values may be withdrawn again when the type changes away — a coordinator
  // who deliberately opened an open house to guests keeps it open.
  const [guestDefaultsAuto, setGuestDefaultsAuto] = useState(false);
  const [guestSwitchesTouched, setGuestSwitchesTouched] = useState(false);
  const [customCategories, setCustomCategories] = useState<EventCategoryConfig[]>([]);
  const [visibleCustomCategories, setVisibleCustomCategories] = useState<string[]>([]);
  const [membershipTypes, setMembershipTypes] = useState(DEFAULT_MEMBERSHIP_TYPES);
  // Whether membershipTypes is the department's own list rather than the
  // built-in fallback, which does not match every department's tiers.
  const [membershipTypesLoaded, setMembershipTypesLoaded] = useState(false);
  const [isRecurring, setIsRecurring] = useState(initialRecurrence?.is_recurring || false);
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern>(
    initialRecurrence?.recurrence_pattern || 'weekly'
  );
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(initialRecurrence?.recurrence_end_date || '');
  const [isRolling, setIsRolling] = useState(initialRecurrence?.rolling_recurrence || false);
  const [recurrenceCustomDays, setRecurrenceCustomDays] = useState<number[]>(
    initialRecurrence?.recurrence_custom_days || []
  );
  const [recurrenceWeekday, setRecurrenceWeekday] = useState(initialRecurrence?.recurrence_weekday ?? 0);
  const [recurrenceWeekOrdinal, setRecurrenceWeekOrdinal] = useState(initialRecurrence?.recurrence_week_ordinal ?? 1);
  const [recurrenceMonth, setRecurrenceMonth] = useState(initialRecurrence?.recurrence_month ?? 1);
  const [recurrenceExceptions, setRecurrenceExceptions] = useState<string[]>(
    initialRecurrence?.recurrence_exceptions || []
  );
  const [newExceptionDate, setNewExceptionDate] = useState('');
  const [trainingDetails, setTrainingDetails] = useState<TrainingDetailsValue>(EMPTY_TRAINING_DETAILS);
  const checkInLeadTimeEdited = useRef(initialData?.check_in_minutes_before !== undefined);
  const lockNoticeId = useId();
  const scheduleLockHintId = useId();
  const checkInLockHintId = useId();
  const typeLockHintId = useId();
  const reminderAudienceEdited = useRef(initialData?.reminder_target !== undefined);

  // Existing attachments from initialData (shown when editing)
  const existingAttachments: EventAttachment[] = initialData?.attachments || [];

  // Ref for the description textarea (used by formatting toolbar)
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Insert markdown syntax around the current selection in the description textarea,
   * or insert a template at the cursor position.
   */
  const insertMarkdown = (syntax: 'bold' | 'italic' | 'list' | 'link') => {
    const textarea = descriptionRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const selected = value.slice(start, end);

    let insertion: string;
    let cursorOffset: number;

    switch (syntax) {
      case 'bold':
        insertion = `**${selected || 'bold text'}**`;
        cursorOffset = selected ? insertion.length : 2;
        break;
      case 'italic':
        insertion = `*${selected || 'italic text'}*`;
        cursorOffset = selected ? insertion.length : 1;
        break;
      case 'list':
        insertion = `\n- ${selected || 'list item'}`;
        cursorOffset = selected ? insertion.length : 3;
        break;
      case 'link':
        if (selected) {
          insertion = `[${selected}](url)`;
          cursorOffset = insertion.length - 4; // position cursor inside (url)
        } else {
          insertion = '[link text](url)';
          cursorOffset = 1; // position cursor after [
        }
        break;
    }

    const newValue = value.slice(0, start) + insertion + value.slice(end);
    update({ description: newValue });

    // Restore focus and cursor position after React re-renders
    requestAnimationFrame(() => {
      textarea.focus();
      const pos = start + cursorOffset;
      textarea.setSelectionRange(pos, pos);
    });
  };

  // Conflict detection: check if the selected time range overlaps with user's existing events.
  // Form values are datetime-local strings in the org's timezone; userEvents have UTC ISO strings.
  // Convert form values to UTC before comparing.
  const conflicts = useMemo(() => {
    if (!userEvents || !formData.start_datetime || !formData.end_datetime) return [];
    const startUTC = localToUTC(formData.start_datetime, tz);
    const endUTC = localToUTC(formData.end_datetime, tz);
    const startA = new Date(startUTC).getTime();
    const endA = new Date(endUTC).getTime();
    if (isNaN(startA) || isNaN(endA) || endA <= startA) return [];
    return userEvents.filter((evt) => {
      if (editingEventId && evt.id === editingEventId) return false;
      const startB = new Date(evt.start_datetime).getTime();
      const endB = new Date(evt.end_datetime).getTime();
      return startA < endB && endA > startB;
    });
  }, [userEvents, formData.start_datetime, formData.end_datetime, editingEventId, tz]);

  useEffect(() => {
    void loadLocations();
    eventService
      .getVisibleEventTypesWithCategories()
      .then((data) => {
        // A body that is not this shape (a captive portal's HTML page) gets
        // the same fallback as a failed request — every type shown — rather
        // than replacing the default with undefined and crashing the form.
        if (Array.isArray(data?.visible_event_types)) setVisibleTypes(data.visible_event_types);
        setCustomCategories(asArray(data?.custom_event_categories ?? []));
        setVisibleCustomCategories(asArray(data?.visible_custom_categories ?? []));
        if (Array.isArray(data?.membership_types) && data.membership_types.length) {
          setMembershipTypes(data.membership_types);
          setMembershipTypesLoaded(true);
        }
      })
      .catch(() => {
        /* fall back to showing all types */
      });
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
    if (Object.keys(partial).some((key) => key in fieldErrors)) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(partial)) delete next[key as EventField];
        return next;
      });
    }
  };

  // Keep the standard one-hour window unless another meeting runs directly
  // into it. In that case the lead is capped at the actual gap (up to a
  // 15-minute shortened standard) so check-in can never open while the
  // earlier meeting is still in progress — a back-to-back meeting yields 0.
  useEffect(() => {
    if (checkInLeadTimeEdited.current || !formData.start_datetime) return;
    const start = new Date(localToUTC(formData.start_datetime, tz)).getTime();
    // Smallest gap (ms) to a business meeting ending within the hour before
    // this event starts; null when there is no such meeting.
    let precedingGapMs: number | null = null;
    for (const event of userEvents || []) {
      if (event.id === editingEventId) continue;
      if (event.event_type && event.event_type !== EventTypeEnum.BUSINESS_MEETING) continue;
      const end = new Date(event.end_datetime).getTime();
      if (end <= start && end > start - 60 * 60 * 1000) {
        const gap = start - end;
        if (precedingGapMs === null || gap < precedingGapMs) precedingGapMs = gap;
      }
    }
    const standardLeadTime =
      precedingGapMs === null ? 60 : Math.min(15, Math.max(0, Math.floor(precedingGapMs / 60000)));
    setFormData((prev) =>
      prev.check_in_minutes_before === standardLeadTime ? prev : { ...prev, check_in_minutes_before: standardLeadTime }
    );
  }, [editingEventId, formData.start_datetime, tz, userEvents]);

  /**
   * Recruitment events exist to feed the prospective-members pipeline, and the
   * only route there is guest sign-in, so a new one arrives with both switches
   * on rather than making the coordinator find them in Check-In further down.
   *
   * Three limits keep that from becoming a setting nobody chose. It applies
   * only when creating: flipping kiosk behaviour on an event that already
   * exists would change what a printed QR code does, mid-season, invisibly. It
   * stops as soon as the coordinator touches either switch. And it withdraws
   * only what it applied — retyping a recruitment night as social clears the
   * defaults this function set, never a choice somebody made by hand. The
   * prompt beside the picker states the resulting behaviour either way, so
   * nothing here happens silently.
   */
  const handleEventTypeChange = (nextType: EventType) => {
    const changes: Partial<EventCreate> = { event_type: nextType };
    // Templates prefill initialData too; only an event ID means edit mode.
    const isCreating = !editingEventId;

    if (isCreating && !guestSwitchesTouched) {
      if (nextType === EventTypeEnum.RECRUITMENT) {
        changes.allow_guest_check_in = true;
        changes.guest_check_in_creates_prospect = true;
        setGuestDefaultsAuto(true);
      } else if (guestDefaultsAuto) {
        changes.allow_guest_check_in = false;
        changes.guest_check_in_creates_prospect = false;
        setGuestDefaultsAuto(false);
      }
    }
    update(changes);
  };

  /** Any hand-set guest value is the coordinator's, and outranks the default. */
  const updateGuestSwitches = (partial: Partial<EventCreate>) => {
    setGuestSwitchesTouched(true);
    setGuestDefaultsAuto(false);
    update(partial);
  };

  const handleStartDateChange = (startDate: string) => {
    const changes: Partial<EventCreate> = { start_datetime: startDate };
    if (!formData.end_datetime && startDate) {
      // Auto-set end date to 2 hours later if not already set
      const startUtc = localToUTC(startDate, tz);
      const end = new Date(new Date(startUtc).getTime() + 2 * 60 * 60 * 1000);
      changes.end_datetime = formatForDateTimeInput(end, tz);
    } else if (formData.start_datetime && formData.end_datetime && startDate) {
      // Moving the start carries the end with it, keeping the event's length.
      // Left behind, the end stayed on the old day — before a start moved
      // later, which a template's pre-filled times made the usual case
      // (workflow review W21).
      const shiftMs =
        new Date(localToUTC(startDate, tz)).getTime() - new Date(localToUTC(formData.start_datetime, tz)).getTime();
      const end = new Date(new Date(localToUTC(formData.end_datetime, tz)).getTime() + shiftMs);
      changes.end_datetime = formatForDateTimeInput(end, tz);
    }
    update(changes);
  };

  const setDuration = (hours: number) => {
    if (!formData.start_datetime) {
      setError('Set a start date first');
      return;
    }
    const startUtc = localToUTC(formData.start_datetime, tz);
    const end = new Date(new Date(startUtc).getTime() + hours * 60 * 60 * 1000);
    update({ end_datetime: formatForDateTimeInput(end, tz) });
  };

  const handleRecurrenceEndDateChange = (value: string) => {
    setRecurrenceEndDate(value);
    setFieldErrors(({ recurrence_end_date: _cleared, ...rest }) => rest);
  };

  const toggleRsvpStatus = (status: RSVPStatus, checked: boolean) => {
    const statuses = formData.allowed_rsvp_statuses || [];
    if (checked) {
      update({ allowed_rsvp_statuses: [...statuses, status] });
    } else {
      update({ allowed_rsvp_statuses: statuses.filter((s) => s !== status) });
    }
  };

  // Unless the reminder audience was chosen by hand, it follows the mandatory
  // switch: everyone is reminded of a mandatory event, sign-ups otherwise.
  const handleMandatoryChange = (isMandatory: boolean) => {
    update({
      is_mandatory: isMandatory,
      mandatory_membership_types: isMandatory ? formData.mandatory_membership_types : undefined,
      ...(!reminderAudienceEdited.current
        ? { reminder_target: isMandatory ? 'all' : 'going', send_reminders: true }
        : {}),
    });
  };

  const handleCheckInMinutesBeforeChange = (value: string) => {
    checkInLeadTimeEdited.current = true;
    update({ check_in_minutes_before: parseInt(value) || 0 });
  };

  const handleReminderTargetChange = (target: 'going' | 'all' | 'none') => {
    reminderAudienceEdited.current = true;
    update({ send_reminders: target !== 'none', reminder_target: target });
  };

  // The backend reads a mandatory event with no member types as mandatory for
  // every member. Course-cohort classes, among others, are stored that way, so
  // an event loaded like that keeps meaning everyone rather than refusing every
  // save until somebody narrows it. Creating an event still asks for a choice.
  const storedMandatoryForEveryone =
    Boolean(editingEventId) && Boolean(initialData?.is_mandatory) && !initialData?.mandatory_membership_types?.length;
  // A saved type the department has since removed or renamed would otherwise
  // be required by the server while no box shows it, with no way to untick it.
  // Drawn from what was saved as well as what is ticked, so unticking one keeps
  // its box (and keyboard focus) and it can be ticked again.
  const unlistedMandatoryTypes = [
    ...new Set([...(initialData?.mandatory_membership_types ?? []), ...(formData.mandatory_membership_types ?? [])]),
  ].filter((saved) => !membershipTypes.some((listed) => listed.value === saved));
  // The same for a category the department no longer lists: it would read as
  // None, or with no categories listed at all, show no control while the save
  // still carries it. Drawn from what was saved too, so choosing None keeps
  // the option there to choose again.
  const unlistedCategories = [...new Set([initialData?.custom_category, formData.custom_category])].filter(
    (saved): saved is string => Boolean(saved) && !customCategories.some((listed) => listed.value === saved)
  );

  const toggleMandatoryMembershipType = (membershipType: string, checked: boolean) => {
    const selected = formData.mandatory_membership_types || [];
    update({
      mandatory_membership_types: checked
        ? [...selected, membershipType]
        : selected.filter((type) => type !== membershipType),
    });
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

  // A facility room's Location name includes its full containment path and
  // facility (for example, "Storage — Office — Station 1"). That context is
  // useful when an organization has multiple facilities, but is redundant and
  // harder to scan when every facility-backed location belongs to one building.
  const hasSingleFacility = useMemo(
    () => new Set(locations.map((location) => location.facility_id).filter(Boolean)).size === 1,
    [locations]
  );

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
    const roomName = hasSingleFacility && loc.facility_room_id ? loc.name.split(' — ', 1)[0] : loc.name;
    if (hasSingleFacility && loc.facility_room_id) return roomName;
    const parts = [roomName];
    const building = buildingNotInName(loc.name, loc.building);
    if (building) parts.push(`(${building})`);
    const addr = [loc.address, loc.city].filter(Boolean).join(', ');
    if (addr) parts.push(`— ${addr}`);
    return parts.join(' ');
  };

  // Mirrors EventCreate.validate_dates on the backend, which is the only place
  // it applies: EventUpdate and RecurringEventCreate accept an RSVP event with
  // no deadline (a single fixed deadline has no meaning across a series).
  const rsvpDeadlineRequired = formData.requires_rsvp && !editingEventId && !(isRecurring && onSubmitRecurring);

  // Training details are picked only while creating: an existing event's are
  // edited on its detail page, where the attendance lock can be checked. This
  // form still leaves them off a rolling series, which the backend accepts
  // since 2026-11-11; the single training-event form replaces this block.
  const showsTrainingDetails = formData.event_type === EventTypeEnum.TRAINING && !editingEventId;
  const submitsRollingSeries = isRecurring && Boolean(onSubmitRecurring) && isRolling;

  /**
   * Every field check, collected so all of them show at once and focus goes to
   * the first; the form is noValidate, so these replace the browser's bubbles
   * (forms review F-3). Reports rather than shows: the caller decides when.
   */
  const validate = (): Partial<Record<EventField, string>> => {
    const invalid: Partial<Record<EventField, string>> = {};
    if (!formData.title.trim()) invalid.title = 'Enter a title for the event.';
    if (!formData.start_datetime) invalid.start_datetime = 'Choose when the event starts.';
    if (!formData.end_datetime) invalid.end_datetime = 'Choose when the event ends.';
    // Not on a finalized event: its times are locked, left out of the save and
    // validated by the server as stored, and the minute-precision pair the
    // pickers show can read as zero length across the hour clocks fall back —
    // an error the user would have no enabled control left to clear.
    else if (
      !attendanceLocked &&
      formData.start_datetime &&
      new Date(formData.end_datetime) <= new Date(formData.start_datetime)
    ) {
      invalid.end_datetime = 'End must be after the start.';
    }

    if (rsvpDeadlineRequired && !formData.rsvp_deadline) {
      invalid.rsvp_deadline = 'Set an RSVP deadline, or turn off Require RSVP.';
    } else if (formData.requires_rsvp && formData.rsvp_deadline) {
      if (new Date(formData.rsvp_deadline) >= new Date(formData.start_datetime)) {
        invalid.rsvp_deadline = 'The RSVP deadline must be before the event starts.';
      }
    }
    if (isRecurring && onSubmitRecurring && !isRolling && !recurrenceEndDate) {
      invalid.recurrence_end_date = 'Choose the date the series ends.';
    }
    return invalid;
  };

  /** The refusal for a mandatory event with no member type chosen, or null. */
  const checkMandatory = (): string | null => {
    if (formData.is_mandatory && !formData.mandatory_membership_types?.length && !storedMandatoryForEveryone) {
      return 'Select at least one member type for mandatory attendance';
    }
    return null;
  };

  /**
   * The cleaned-up, UTC-converted payload the form would save, as a single
   * event or as a series, or the refusal that stops it. Assumes `validate()`
   * and `checkMandatory()` have passed.
   */
  const buildPayload = (): { single: EventCreate } | { recurring: RecurringEventCreate } | { error: string } => {
    // Clean up data before submit
    const submitData = { ...formData };

    // Left on "Me (default)", the key is omitted and the API makes the
    // creator the organizer.
    if (showOrganizerPickers) {
      submitData.organizer_id = organizerId || undefined;
      submitData.alternate_organizer_id = alternateId || undefined;
    }

    // Only an explicit pick attaches a training session; an untouched section
    // leaves the event to be credited under its title as Continuing Education.
    delete submitData.training_details;
    if (showsTrainingDetails && !submitsRollingSeries && hasExplicitTrainingDetails(trainingDetails)) {
      submitData.training_details = toTrainingDetailsPayload(trainingDetails);
    }

    // What a blank or inapplicable field becomes. A create omits it; an edit
    // sends null, because the update path reads an omitted key as "leave
    // alone" and the old value came back behind a success toast (CLAUDE.md
    // pitfall #1). Only an event ID means edit mode: templates prefill too.
    const cleared = editingEventId ? null : undefined;

    // Clear location fields based on mode. On an edit, switching between a
    // listed location and "Other" must clear the one no longer in use.
    if (locationMode === 'select') {
      submitData.location = cleared;
    } else {
      submitData.location_id = cleared;
    }

    // Only the deadline is cleared when a response is not required. Capacity,
    // guests and the allowed statuses all still apply, because an event that
    // does not *require* an RSVP still accepts voluntary ones — clearing them
    // here would silently uncap the event and revoke guests on every save.
    // A deadline is the one field that genuinely has no meaning without an
    // expectation to be late for.
    if (!submitData.requires_rsvp) {
      submitData.rsvp_deadline = cleared;
    }

    // Clear empty strings
    if (!submitData.description) submitData.description = cleared;
    if (!submitData.location_id) submitData.location_id = cleared;
    if (!submitData.location) submitData.location = cleared;
    if (!submitData.location_details) submitData.location_details = cleared;
    if (!submitData.rsvp_deadline) submitData.rsvp_deadline = cleared;
    if (!submitData.custom_category) submitData.custom_category = cleared;
    // An emptied capacity box is undefined in form state; it means unlimited.
    if (typeof submitData.max_attendees !== 'number' || Number.isNaN(submitData.max_attendees)) {
      submitData.max_attendees = cleared;
    }

    // Convert local datetime-local values to UTC before sending to backend
    submitData.start_datetime = localToUTC(submitData.start_datetime, tz);
    submitData.end_datetime = localToUTC(submitData.end_datetime, tz);
    if (submitData.rsvp_deadline) {
      submitData.rsvp_deadline = localToUTC(submitData.rsvp_deadline, tz);
    }

    if (!(isRecurring && onSubmitRecurring)) return { single: submitData };

    if (recurrencePattern === 'custom' && recurrenceCustomDays.length === 0) {
      return { error: 'Select at least one day for custom recurrence' };
    }
    const needsWeekday = recurrencePattern === 'monthly_weekday' || recurrencePattern === 'annually_weekday';
    return {
      recurring: {
        ...submitData,
        recurrence_pattern: recurrencePattern,
        recurrence_end_date: isRolling ? undefined : localToUTC(recurrenceEndDate + 'T23:59', tz),
        rolling_recurrence: isRolling || undefined,
        recurrence_custom_days: recurrencePattern === 'custom' ? recurrenceCustomDays : undefined,
        recurrence_weekday: needsWeekday ? recurrenceWeekday : undefined,
        recurrence_week_ordinal: needsWeekday ? recurrenceWeekOrdinal : undefined,
        recurrence_month: recurrencePattern === 'annually_weekday' ? recurrenceMonth : undefined,
        recurrence_exceptions: recurrenceExceptions.length > 0 ? recurrenceExceptions : undefined,
      },
    };
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const invalid = validate();
    if (Object.keys(invalid).length > 0) {
      showFieldErrors(invalid);
      return;
    }

    const mandatoryError = checkMandatory();
    if (mandatoryError) {
      setError(mandatoryError);
      return;
    }

    try {
      // Built inside the try, as the series half always was: a date the
      // browser accepts but `Date` cannot represent throws from localToUTC,
      // and that shows as the form's error rather than a dead submit button.
      const payload = buildPayload();
      if ('error' in payload) {
        setError(payload.error);
        return;
      }
      if ('recurring' in payload) {
        // buildPayload returns a series only when onSubmitRecurring is set.
        await onSubmitRecurring?.(payload.recurring);
      } else {
        await onSubmit(payload.single);
      }
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, EVENT_FIELDS);
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
        showFieldErrors(mapped.fieldErrors, mapped.unmatched);
      } else {
        setError(mapped?.unmatched.join(' ') || getErrorMessage(err, 'An error occurred'));
      }
    }
  };

  // Not `update`: the checkbox has always written a whole new object from this
  // render's formData rather than a functional update, and is_draft is never a
  // field error, so update's clearing would have nothing to clear. Routing it
  // through update would change the write's form for no gain.
  const setIsDraft = (isDraft: boolean) => {
    setFormData({ ...formData, is_draft: isDraft });
  };

  return {
    // Host options the sections read
    initialRecurrence,
    editingEventId,
    showOrganizerPickers,
    attendanceLocked,
    eventTypeLocked,
    // Environment
    tz,
    currentUserId,
    organizerOptions,
    canCreateTrainingSession,
    // Form values
    formData,
    setIsDraft,
    update,
    error,
    fieldErrors,
    organizerId,
    setOrganizerId,
    alternateId,
    setAlternateId,
    trainingDetails,
    setTrainingDetails,
    // Reference data
    locations,
    locationMode,
    visibleTypes,
    customCategories,
    visibleCustomCategories,
    membershipTypes,
    membershipTypesLoaded,
    existingAttachments,
    // Recurrence
    isRecurring,
    setIsRecurring,
    recurrencePattern,
    setRecurrencePattern,
    recurrenceEndDate,
    handleRecurrenceEndDateChange,
    isRolling,
    setIsRolling,
    recurrenceCustomDays,
    setRecurrenceCustomDays,
    recurrenceWeekday,
    setRecurrenceWeekday,
    recurrenceWeekOrdinal,
    setRecurrenceWeekOrdinal,
    recurrenceMonth,
    setRecurrenceMonth,
    recurrenceExceptions,
    setRecurrenceExceptions,
    newExceptionDate,
    setNewExceptionDate,
    // Ids tying the lock notices to the controls they explain
    lockNoticeId,
    scheduleLockHintId,
    checkInLockHintId,
    typeLockHintId,
    // Description toolbar
    descriptionRef,
    insertMarkdown,
    // Derived values
    conflicts,
    storedMandatoryForEveryone,
    unlistedMandatoryTypes,
    unlistedCategories,
    selectedLocation,
    rsvpDeadlineRequired,
    showsTrainingDetails,
    submitsRollingSeries,
    formatLocationAddress,
    formatLocationLabel,
    // Handlers
    handleEventTypeChange,
    updateGuestSwitches,
    handleStartDateChange,
    setDuration,
    toggleRsvpStatus,
    handleMandatoryChange,
    handleCheckInMinutesBeforeChange,
    handleReminderTargetChange,
    toggleMandatoryMembershipType,
    handleLocationSelect,
    // Submission, in the order handleSubmit runs them; a second form can run
    // the same checks and build the same payload without a FormEvent.
    validate,
    checkMandatory,
    buildPayload,
    handleSubmit,
  };
};

export type EventFormModel = ReturnType<typeof useEventFormModel>;
