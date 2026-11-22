/**
 * The form an event is entered with, and the two payloads built from it: a
 * create omits blanks, an update sends a cleared field as null (CLAUDE.md
 * pitfall #1). Both send every link set the form owns, so a removed person,
 * apparatus, photo or document is removed.
 */
import { blankToNull } from '../../../utils/formValues';
import type { DatePrecision, EventCreate, EventFullView, EventLinks, EventUpdate } from '../types';

export interface LinkedRecord {
  id: string;
  label: string;
}

export interface LinkedPerson {
  member_id: string;
  display_name: string;
  role: string;
}

export interface EventForm {
  title: string;
  description: string;
  start_date: string | null;
  start_precision: DatePrecision;
  start_circa: boolean;
  end_date: string | null;
  end_precision: DatePrecision;
  end_circa: boolean;
  place: string;
  station_id: string;
  event_type_id: string;
  research_notes: string;
  source_id: string;
  members: LinkedPerson[];
  apparatus: LinkedRecord[];
  media: LinkedRecord[];
  documents: LinkedRecord[];
}

export const EMPTY_EVENT_FORM: EventForm = {
  title: '',
  description: '',
  start_date: null,
  start_precision: 'day',
  start_circa: false,
  end_date: null,
  end_precision: 'day',
  end_circa: false,
  place: '',
  station_id: '',
  event_type_id: '',
  research_notes: '',
  source_id: '',
  members: [],
  apparatus: [],
  media: [],
  documents: [],
};

const links = (form: EventForm): Required<EventLinks> => ({
  members: form.members.map((m) => ({ member_id: m.member_id, role: m.role.trim() || null })),
  apparatus_ids: form.apparatus.map((a) => a.id),
  media_ids: form.media.map((m) => m.id),
  document_ids: form.documents.map((d) => d.id),
});

/** For a new event. The start date is required, so the caller checks it
 * first; this returns null without one. */
export const eventForCreate = (form: EventForm): EventCreate | null => {
  if (!form.start_date) return null;
  return {
    title: form.title.trim(),
    start_date: form.start_date,
    start_precision: form.start_precision,
    start_circa: form.start_circa,
    end_date: form.end_date || undefined,
    end_precision: form.end_precision,
    end_circa: form.end_circa,
    description: form.description.trim() || undefined,
    place: form.place.trim() || undefined,
    station_id: form.station_id || undefined,
    event_type_id: form.event_type_id || undefined,
    research_notes: form.research_notes.trim() || undefined,
    source_id: form.source_id || undefined,
    ...links(form),
  };
};

export const eventForUpdate = (form: EventForm): EventUpdate => ({
  title: form.title.trim(),
  start_date: form.start_date ?? undefined,
  start_precision: form.start_precision,
  start_circa: form.start_circa,
  end_date: form.end_date,
  end_precision: form.end_precision,
  end_circa: form.end_circa,
  description: blankToNull(form.description),
  place: blankToNull(form.place),
  station_id: form.station_id || null,
  event_type_id: form.event_type_id || null,
  research_notes: blankToNull(form.research_notes),
  source_id: form.source_id || null,
  ...links(form),
});

/** The edit form, filled from an event as the server sent it. */
export const eventFormFrom = (item: EventFullView): EventForm => ({
  title: item.title,
  description: item.description ?? '',
  start_date: item.start_date,
  start_precision: item.start_precision,
  start_circa: item.start_circa,
  end_date: item.end_date,
  end_precision: item.end_precision,
  end_circa: item.end_circa,
  place: item.place ?? '',
  station_id: item.station_id ?? '',
  event_type_id: item.event_type_id ?? '',
  research_notes: item.research_notes ?? '',
  source_id: item.source_id ?? '',
  members: item.members.map((m) => ({ member_id: m.member_id, display_name: m.display_name, role: m.role ?? '' })),
  apparatus: item.apparatus.map((a) => ({ id: a.apparatus_id, label: a.name })),
  media: item.media.map((m) => ({ id: m.id, label: m.title })),
  documents: item.documents.map((d) => ({ id: d.id, label: d.title })),
});
