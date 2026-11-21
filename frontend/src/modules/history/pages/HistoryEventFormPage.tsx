/**
 * Adding or editing an event: its dates, type, place and station, and the
 * people (each with a role), apparatus, photos and documents it links to.
 *
 * On an edit, a change to anything a reader sees, its links included, is
 * recorded as substantial whatever is chosen here: the server decides, so a
 * public event keeps its cleared version until the change is cleared.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import toast from 'react-hot-toast';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { getErrorMessage } from '../../../utils/errorHandling';
import { ApparatusPicker } from '../components/ApparatusPicker';
import { EditKindChoice } from '../components/EditKindChoice';
import { EventPeopleEditor } from '../components/EventPeopleEditor';
import { ListEntrySelect } from '../components/ListEntrySelect';
import { PartialDateInput } from '../components/PartialDateInput';
import { RecordLinksPicker } from '../components/RecordLinksPicker';
import { historyEventService, historyListService, historyMediaService } from '../services/api';
import type { EditKind, EventFullView, HistoryListEntry, HistorySource } from '../types';
import {
  EMPTY_EVENT_FORM,
  eventForCreate,
  eventFormFrom,
  eventForUpdate,
  type EventForm,
} from '../utils/eventCatalogue';

export const HistoryEventFormPage: React.FC = () => {
  const { eventId } = useParams();
  const isEdit = Boolean(eventId);
  const navigate = useNavigate();
  const [item, setItem] = useState<EventFullView | null>(null);
  const [form, setForm] = useState<EventForm | null>(isEdit ? null : EMPTY_EVENT_FORM);
  const [stations, setStations] = useState<HistoryListEntry[]>([]);
  const [types, setTypes] = useState<HistoryListEntry[]>([]);
  const [sources, setSources] = useState<HistorySource[]>([]);
  const [editKind, setEditKind] = useState<EditKind>('minor');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void historyListService
      .list('stations', true)
      .then(setStations)
      .catch(() => setStations([]));
    void historyListService
      .list('event-types', true)
      .then(setTypes)
      .catch(() => setTypes([]));
    void historyMediaService
      .listSources(true)
      .then(setSources)
      .catch(() => setSources([]));
    if (!eventId) return;
    historyEventService
      .getEvent(eventId)
      .then((loaded) => {
        if (loaded.view !== 'full') {
          setError('Only the archive’s keepers can edit an event.');
          return;
        }
        setItem(loaded);
        setForm(eventFormFrom(loaded));
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Unable to load this event.')));
  }, [eventId]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <div role="alert" className="alert-danger rounded-md p-3 text-sm">
          {error}
        </div>
      </div>
    );
  }
  if (!form) return <SkeletonPage />;

  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Enter a title');
      return;
    }
    if (!form.start_date) {
      toast.error('Enter the date the event began, a year at least');
      return;
    }
    setSaving(true);
    try {
      let saved: EventFullView;
      if (item) {
        saved = await historyEventService.updateEvent(item.id, {
          ...eventForUpdate(form),
          edit_kind: editKind,
          edit_note: editNote.trim() || undefined,
        });
      } else {
        const payload = eventForCreate(form);
        if (!payload) return;
        saved = await historyEventService.createEvent(payload);
      }
      toast.success(item ? 'Saved' : 'Event added as a draft');
      void navigate(`/history/events/${saved.id}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save this event'));
    } finally {
      setSaving(false);
    }
  };

  const heading = item ? `Edit ${item.title}` : 'Add an event';

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'History', path: '/history' },
          { label: 'Events', path: '/history/events' },
          ...(item
            ? [{ label: item.title, path: `/history/events/${item.id}` }, { label: 'Edit' }]
            : [{ label: 'New' }]),
        ]}
      />
      <h1 className="text-theme-text-primary mb-4 text-2xl font-bold">{heading}</h1>
      <form onSubmit={(e) => void save(e)} className="space-y-4">
        <section className="card grid gap-4 p-4 sm:grid-cols-2 sm:p-5" aria-label="The event">
          <label className="block sm:col-span-2">
            <span className="form-label">
              Title<span aria-hidden="true"> *</span>
            </span>
            <input
              value={form.title}
              maxLength={200}
              required
              onChange={(e) => set('title', e.target.value)}
              className="form-input"
              disabled={saving}
            />
          </label>
          <PartialDateInput
            label="Began *"
            value={form.start_date}
            precision={form.start_precision}
            circa={form.start_circa}
            disabled={saving}
            onChange={(next) =>
              setForm({ ...form, start_date: next.value, start_precision: next.precision, start_circa: next.circa })
            }
          />
          <PartialDateInput
            label="Ended (if it ran over days or years)"
            value={form.end_date}
            precision={form.end_precision}
            circa={form.end_circa}
            disabled={saving}
            onChange={(next) =>
              setForm({ ...form, end_date: next.value, end_precision: next.precision, end_circa: next.circa })
            }
          />
          <ListEntrySelect
            label="Type"
            path="event-types"
            noun="event type"
            entries={types}
            value={form.event_type_id}
            onChange={(id) => set('event_type_id', id)}
            onAdded={(entry) => setTypes((current) => [...current, entry])}
            disabled={saving}
          />
          <ListEntrySelect
            label="Station"
            path="stations"
            noun="station"
            entries={stations}
            value={form.station_id}
            onChange={(id) => set('station_id', id)}
            onAdded={(entry) => setStations((current) => [...current, entry])}
            disabled={saving}
          />
          <label className="block sm:col-span-2">
            <span className="form-label">Place</span>
            <input
              value={form.place}
              maxLength={255}
              onChange={(e) => set('place', e.target.value)}
              className="form-input"
              disabled={saving}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="form-label">What happened</span>
            <textarea
              value={form.description}
              rows={6}
              maxLength={20000}
              onChange={(e) => set('description', e.target.value)}
              aria-describedby="event-description-hint"
              className="form-input"
              disabled={saving}
            />
          </label>
          <p id="event-description-hint" className="text-theme-text-secondary -mt-3 text-xs sm:col-span-2">
            Readers see this. Name a member of the public here only if the clearance list should check it; otherwise
            keep their name in the research notes.
          </p>
          <label className="block">
            <span className="form-label">Source or donor</span>
            <select
              value={form.source_id}
              onChange={(e) => set('source_id', e.target.value)}
              className="form-input"
              disabled={saving}
            >
              <option value="">Not recorded</option>
              {sources
                .filter((s) => !s.is_retired || s.id === form.source_id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="form-label">Research notes (Historian only)</span>
            <textarea
              value={form.research_notes}
              rows={3}
              maxLength={20000}
              onChange={(e) => set('research_notes', e.target.value)}
              className="form-input"
              disabled={saving}
            />
          </label>
        </section>

        <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="event-form-people-heading">
          <h2 id="event-form-people-heading" className="text-theme-text-primary text-lg font-semibold">
            People
          </h2>
          <EventPeopleEditor value={form.members} onChange={(next) => set('members', next)} disabled={saving} />
        </section>

        <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="event-form-apparatus-heading">
          <h2 id="event-form-apparatus-heading" className="text-theme-text-primary text-lg font-semibold">
            Apparatus
          </h2>
          <ApparatusPicker
            value={form.apparatus.map((a) => ({ apparatus_id: a.id, name: a.label }))}
            onChange={(next) =>
              set(
                'apparatus',
                next.map((a) => ({ id: a.apparatus_id, label: a.name }))
              )
            }
            disabled={saving}
          />
        </section>

        <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="event-form-records-heading">
          <h2 id="event-form-records-heading" className="text-theme-text-primary text-lg font-semibold">
            Photos and documents
          </h2>
          <RecordLinksPicker
            kind="media"
            value={form.media}
            onChange={(next) => set('media', next)}
            disabled={saving}
          />
          <RecordLinksPicker
            kind="document"
            value={form.documents}
            onChange={(next) => set('documents', next)}
            disabled={saving}
          />
        </section>

        {item && (
          <EditKindChoice
            kind={editKind}
            onKindChange={setEditKind}
            note={editNote}
            onNoteChange={setEditNote}
            isPublic={item.publication_level === 'public'}
          />
        )}
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="btn-primary rounded-md px-4 py-2 text-sm font-medium">
            {saving ? 'Saving…' : item ? 'Save' : 'Add event'}
          </button>
          <button
            type="button"
            onClick={() => void navigate(item ? `/history/events/${item.id}` : '/history/events')}
            className="btn-secondary rounded-md px-4 py-2 text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default HistoryEventFormPage;
