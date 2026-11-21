/**
 * Form state for an apparatus event template, and the conversions to and from
 * the API. Kept apart from the components so the rules — what a blank seat
 * count means, what a duplicate starts as, how nights become UTC instants —
 * are tested without rendering anything.
 */

import {
  ApparatusEventEvocMode,
  ApparatusEventSeatType,
  type ApparatusEventTemplate,
  type ApparatusEventTemplatePayload,
  type EditorOptions,
  type NightSpec,
} from '../../types/apparatusEvent';
import { EventType } from '../../constants/enums';
import { localToUTC } from '../../utils/dateFormatting';

/** Mirrors the backend's per-template cap (schemas/apparatus_event.py). */
export const MAX_TOTAL_SEATS = 60;
export const MAX_NIGHTS = 60;

/** The event types an apparatus event can be. Training credits training
 * records instead of Admin Hours, so the backend refuses it. */
export const APPARATUS_EVENT_TYPES: EventType[] = [
  EventType.PUBLIC_EDUCATION,
  EventType.CEREMONY,
  EventType.FUNDRAISER,
  EventType.RECRUITMENT,
  EventType.SOCIAL,
  EventType.OTHER,
];

let keySeed = 0;
/** A stable React key for a row that has no server id yet. */
export const nextKey = (): string => {
  keySeed += 1;
  return `row-${keySeed}`;
};

export interface SeatDraft {
  key: string;
  name: string;
  seat_type: ApparatusEventSeatType;
  /** A string while typing, so a cleared box is not instantly a 0. */
  count: string;
  note: string;
}

export interface UnitDraft {
  key: string;
  apparatus_id: string;
  seats: SeatDraft[];
}

export interface TemplateDraft {
  name: string;
  description: string;
  event_type: EventType;
  default_start_time: string;
  duration_minutes: string;
  location: string;
  admin_hours_category_id: string;
  evoc_mode: ApparatusEventEvocMode;
  allow_self_signup: boolean;
  show_on_schedule: boolean;
  units: UnitDraft[];
  duplicated_from_id: string;
}

export const blankSeat = (name = '', seatType: ApparatusEventSeatType = ApparatusEventSeatType.GENERAL): SeatDraft => ({
  key: nextKey(),
  name,
  seat_type: seatType,
  count: '1',
  note: '',
});

export const blankUnit = (apparatusId = ''): UnitDraft => ({
  key: nextKey(),
  apparatus_id: apparatusId,
  seats: [blankSeat('Driver', ApparatusEventSeatType.DRIVER)],
});

export const blankDraft = (apparatusId = ''): TemplateDraft => ({
  name: '',
  description: '',
  event_type: EventType.PUBLIC_EDUCATION,
  default_start_time: '18:00',
  duration_minutes: '180',
  location: '',
  admin_hours_category_id: '',
  evoc_mode: ApparatusEventEvocMode.ENFORCE,
  allow_self_signup: true,
  show_on_schedule: true,
  units: [blankUnit(apparatusId)],
  duplicated_from_id: '',
});

export const draftFromTemplate = (template: ApparatusEventTemplate): TemplateDraft => ({
  name: template.name,
  description: template.description ?? '',
  event_type: (APPARATUS_EVENT_TYPES as string[]).includes(template.event_type)
    ? (template.event_type as EventType)
    : EventType.OTHER,
  default_start_time: template.default_start_time ?? '',
  duration_minutes: String(template.duration_minutes),
  location: template.location ?? '',
  admin_hours_category_id: template.admin_hours_category_id ?? '',
  evoc_mode: template.evoc_mode,
  allow_self_signup: template.allow_self_signup,
  show_on_schedule: template.show_on_schedule,
  units: template.units.map((unit) => ({
    key: nextKey(),
    apparatus_id: unit.apparatus_id,
    seats: unit.seats.map((seat) => ({
      key: nextKey(),
      name: seat.name,
      seat_type: seat.seat_type,
      count: String(seat.count),
      note: seat.note ?? '',
    })),
  })),
  duplicated_from_id: '',
});

/** A copy starts as the original under a new name, remembering its source. */
export const duplicateDraft = (template: ApparatusEventTemplate, name: string): TemplateDraft => ({
  ...draftFromTemplate(template),
  name,
  duplicated_from_id: template.id,
});

const seatCount = (seat: SeatDraft): number => {
  const n = Number.parseInt(seat.count, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const totalSeats = (draft: TemplateDraft): number =>
  draft.units.reduce((sum, unit) => sum + unit.seats.reduce((s, seat) => s + seatCount(seat), 0), 0);

/**
 * Everything wrong with the draft, in reading order. Empty means it can be
 * sent; the server checks the same rules again.
 */
export const validateDraft = (draft: TemplateDraft): string[] => {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push('Give the template a name.');
  const minutes = Number.parseInt(draft.duration_minutes, 10);
  if (!Number.isFinite(minutes) || minutes < 15 || minutes > 1440) {
    errors.push('Duration must be between 15 minutes and 24 hours.');
  }
  if (draft.units.length === 0) errors.push('Add at least one apparatus.');
  const chosen = draft.units.map((u) => u.apparatus_id).filter(Boolean);
  if (chosen.length !== draft.units.length) errors.push('Choose an apparatus for every row.');
  if (new Set(chosen).size !== chosen.length) errors.push('Each apparatus can appear only once.');
  draft.units.forEach((unit) => {
    if (unit.seats.length === 0) errors.push('Every apparatus needs at least one seat.');
    unit.seats.forEach((seat) => {
      if (!seat.name.trim()) errors.push('Every seat needs a name.');
      if (seatCount(seat) < 1 || seatCount(seat) > 20)
        errors.push(`"${seat.name || 'Seat'}" needs a count from 1 to 20.`);
    });
  });
  if (totalSeats(draft) > MAX_TOTAL_SEATS) errors.push(`A template can have at most ${MAX_TOTAL_SEATS} seats.`);
  return Array.from(new Set(errors));
};

/**
 * The payload the API takes. Blank optional text is omitted (pitfall #1):
 * the PUT replaces the whole template, so an omitted field is stored empty,
 * which is exactly what a cleared box means.
 */
export const toPayload = (draft: TemplateDraft): ApparatusEventTemplatePayload => ({
  name: draft.name.trim(),
  description: draft.description.trim() || undefined,
  event_type: draft.event_type,
  default_start_time: draft.default_start_time || undefined,
  duration_minutes: Number.parseInt(draft.duration_minutes, 10),
  location: draft.location.trim() || undefined,
  admin_hours_category_id: draft.admin_hours_category_id || undefined,
  evoc_mode: draft.evoc_mode,
  allow_self_signup: draft.allow_self_signup,
  show_on_schedule: draft.show_on_schedule,
  duplicated_from_id: draft.duplicated_from_id || undefined,
  units: draft.units.map((unit) => ({
    apparatus_id: unit.apparatus_id,
    seats: unit.seats.map((seat) => ({
      name: seat.name.trim(),
      seat_type: seat.seat_type,
      count: seatCount(seat),
      note: seat.note.trim() || undefined,
    })),
  })),
});

/** Seats set to 0 dropped, and an apparatus left with none dropped with them. */
export const withoutEmptySeats = (draft: TemplateDraft): TemplateDraft => ({
  ...draft,
  units: draft.units
    .map((unit) => ({ ...unit, seats: unit.seats.filter((seat) => Number.parseInt(seat.count, 10) > 0) }))
    .filter((unit) => unit.seats.length > 0),
});

// ---------------------------------------------------------------------------
// Nights
// ---------------------------------------------------------------------------

export interface NightDraft {
  key: string;
  /** YYYY-MM-DD, the department's calendar day. */
  date: string;
  /** HH:MM, the department's wall clock. */
  start_time: string;
  duration_minutes: string;
  location: string;
}

const addDays = (isoDate: string, days: number): string => {
  const [y, m, d] = isoDate.split('-').map(Number);
  // Noon UTC so adding days never trips over a daylight-saving boundary.
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12));
  date.setUTCDate(date.getUTCDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

/** `count` dates, a week apart, starting on `firstDate`. */
export const weeklyDates = (firstDate: string, count: number): string[] =>
  Array.from({ length: Math.max(0, count) }, (_, i) => addDays(firstDate, i * 7));

/**
 * A night as UTC instants. The wall-clock start is read in the department's
 * timezone, so "6:00 PM" stays 6:00 PM across a daylight-saving change.
 * Returns null for a night that is not filled in.
 */
export const nightToSpec = (night: NightDraft, timezone: string): NightSpec | null => {
  const minutes = Number.parseInt(night.duration_minutes, 10);
  if (!night.date || !night.start_time || !Number.isFinite(minutes) || minutes <= 0) return null;
  const start = localToUTC(`${night.date}T${night.start_time}`, timezone);
  if (!start) return null;
  const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
  return {
    start_datetime: start,
    end_datetime: end,
    location: night.location.trim() || undefined,
  };
};

/**
 * True when nothing would credit a crew's hours: no category is chosen and the
 * backend reports no mapping for the event type (`mapped_event_types`, the same
 * rule crediting uses). Null options mean "not loaded yet", which warns nobody.
 */
export const hoursWouldNotBeCredited = (
  categoryId: string,
  eventType: string,
  options: EditorOptions | null
): boolean => options !== null && !categoryId && !options.mapped_event_types.includes(eventType);
