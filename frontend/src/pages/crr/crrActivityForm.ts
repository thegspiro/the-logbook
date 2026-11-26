/**
 * The CRR activity form's rules, kept free of React so they can be tested on
 * their own: its starting values, and the request it sends.
 */

import type { CrrActivityCreate, CrrActivityType, CrrFormOptions } from '../../types/crr';
import { formatForDateTimeInput, localToUTC } from '../../utils/dateFormatting';

export interface MemberRow {
  userId: string;
  minutes: string;
}

export interface CrrActivityFormValues {
  activityTypeId: string;
  /** "YYYY-MM-DDTHH:mm" in the department's timezone. */
  occurredAt: string;
  counts: Record<string, string>;
  tagIds: string[];
  zipCode: string;
  city: string;
  state: string;
  hasResidentDetails: boolean;
  streetAddress: string;
  residentName: string;
  residentPhone: string;
  residentEmail: string;
  notes: string;
  members: MemberRow[];
}

/** Minutes a member is credited by default when they log their own activity. */
export const DEFAULT_MINUTES = 60;

/**
 * A fresh form. ``at`` is when it happened by default: now for a log entry,
 * the event's start for an activity recorded from an event, which is usually
 * entered afterwards and would otherwise be filed on the wrong day (owner
 * decision, 2026-11-26).
 */
export const initialValues = (
  options: CrrFormOptions,
  timezone: string,
  currentUserId: string | null,
  at: Date = new Date()
): CrrActivityFormValues => ({
  activityTypeId: '',
  occurredAt: formatForDateTimeInput(at, timezone),
  counts: {},
  tagIds: [],
  zipCode: '',
  city: options.default_city ?? '',
  state: options.default_state ?? '',
  hasResidentDetails: false,
  streetAddress: '',
  residentName: '',
  residentPhone: '',
  residentEmail: '',
  notes: '',
  members:
    currentUserId && options.members.some((m) => m.id === currentUserId)
      ? [{ userId: currentUserId, minutes: String(DEFAULT_MINUTES) }]
      : [],
});

/**
 * Choosing a type starts its counts empty and takes its default tags — those
 * the form offers. A type can still carry a retired default tag, which the
 * form does not show and the server refuses on a new activity.
 */
export const withType = (
  values: CrrActivityFormValues,
  activityType: CrrActivityType | undefined,
  offeredTags: readonly { id: string }[]
) => {
  const offered = new Set(offeredTags.map((t) => t.id));
  return {
    ...values,
    activityTypeId: activityType?.id ?? '',
    counts: {},
    tagIds: activityType ? activityType.tag_ids.filter((id) => offered.has(id)) : [],
  };
};

export interface BuildResult {
  payload: CrrActivityCreate | null;
  error: string | null;
}

/**
 * The create request. Blank optional text is omitted (pitfall #1: a create
 * payload never sends ""), blank counts are left out, and the members — whose
 * time is credited to Admin Hours — are sent only for a log entry, never for
 * an activity at an event, whose attendance already credits it.
 */
export const buildCreatePayload = (values: CrrActivityFormValues, timezone: string, eventId?: string): BuildResult => {
  if (!values.activityTypeId) return { payload: null, error: 'Choose an activity type.' };
  const occurredAt = localToUTC(values.occurredAt, timezone);
  if (!occurredAt) return { payload: null, error: 'Enter when it happened.' };
  if (values.zipCode.trim() && !/^\d{5}(-\d{4})?$/.test(values.zipCode.trim())) {
    return { payload: null, error: 'Enter a five-digit ZIP code.' };
  }

  const counts: Record<string, number> = {};
  for (const [measureId, raw] of Object.entries(values.counts)) {
    if (raw.trim() === '') continue;
    const quantity = Number(raw);
    if (!Number.isInteger(quantity) || quantity < 0) {
      return { payload: null, error: 'Counts must be whole numbers, zero or more.' };
    }
    counts[measureId] = quantity;
  }

  const members: Record<string, number> = {};
  if (!eventId) {
    for (const row of values.members) {
      if (!row.userId) continue;
      if (row.userId in members) {
        return { payload: null, error: 'A member is listed twice. Remove one of the rows.' };
      }
      const minutes = Number(row.minutes);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
        return { payload: null, error: 'Time spent must be between 0 and 1440 minutes.' };
      }
      members[row.userId] = minutes;
    }
  }

  const details = values.hasResidentDetails;
  return {
    error: null,
    payload: {
      activity_type_id: values.activityTypeId,
      occurred_at: occurredAt,
      event_id: eventId || undefined,
      counts,
      tag_ids: values.tagIds,
      zip_code: values.zipCode.trim() || undefined,
      city: values.city.trim() || undefined,
      state: values.state.trim() || undefined,
      has_resident_details: details,
      street_address: (details && values.streetAddress.trim()) || undefined,
      resident_name: (details && values.residentName.trim()) || undefined,
      resident_phone: (details && values.residentPhone.trim()) || undefined,
      resident_email: (details && values.residentEmail.trim()) || undefined,
      notes: values.notes.trim() || undefined,
      members,
    },
  };
};
