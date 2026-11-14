/**
 * Editing a photo, recording or video: its catalogue and who is in it.
 *
 * A change to the title, description or date is recorded as substantial
 * whatever is chosen here: the server decides, so a public item keeps its
 * cleared version until the change is cleared.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import toast from 'react-hot-toast';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { getErrorMessage } from '../../../utils/errorHandling';
import { EditKindChoice } from '../components/EditKindChoice';
import { MediaCatalogueFields } from '../components/MediaCatalogueFields';
import { catalogueForUpdate, type CatalogueForm } from '../utils/mediaCatalogue';
import { PersonTagPicker, type PickedPerson } from '../components/PersonTagPicker';
import { historyMediaService } from '../services/api';
import type { EditKind, HistorySource, MediaFullView } from '../types';

const toForm = (item: MediaFullView): CatalogueForm => ({
  title: item.title,
  description: item.description ?? '',
  taken_date: item.taken_date,
  taken_date_precision: item.taken_date_precision,
  taken_date_circa: item.taken_date_circa,
  place: item.place ?? '',
  creator: item.creator ?? '',
  source_id: item.source_id ?? '',
  rights_note: item.rights_note ?? '',
  accession_number: item.accession_number ?? '',
  original_location: item.original_location ?? '',
  research_notes: item.research_notes ?? '',
});

export const HistoryMediaEditPage: React.FC = () => {
  const { mediaId = '' } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<MediaFullView | null>(null);
  const [form, setForm] = useState<CatalogueForm | null>(null);
  const [people, setPeople] = useState<PickedPerson[]>([]);
  const [sources, setSources] = useState<HistorySource[]>([]);
  const [editKind, setEditKind] = useState<EditKind>('minor');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    historyMediaService
      .getMedia(mediaId)
      .then((loaded) => {
        if (loaded.view !== 'full') {
          setError('Only the archive’s keepers can edit an item.');
          return;
        }
        setItem(loaded);
        setForm(toForm(loaded));
        setPeople(loaded.tags);
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Unable to load this item.')));
    void historyMediaService
      .listSources(true)
      .then(setSources)
      .catch(() => setSources([]));
  }, [mediaId]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <div role="alert" className="alert-danger rounded-md p-3 text-sm">
          {error}
        </div>
      </div>
    );
  }
  if (!item || !form) return <SkeletonPage />;

  const tagsChanged = people.map((p) => p.member_id).join(',') !== item.tags.map((t) => t.member_id).join(',');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Enter a title');
      return;
    }
    setSaving(true);
    try {
      await historyMediaService.updateMedia(item.id, {
        ...catalogueForUpdate(form),
        edit_kind: editKind,
        edit_note: editNote.trim() || undefined,
      });
      if (tagsChanged) {
        await historyMediaService.replaceTags(
          item.id,
          people.map((p) => p.member_id)
        );
      }
      toast.success('Saved');
      void navigate(`/history/media/${item.id}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save this item'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'History', path: '/history' },
          { label: 'Photos and media', path: '/history/media' },
          { label: item.title, path: `/history/media/${item.id}` },
          { label: 'Edit' },
        ]}
      />
      <h1 className="text-theme-text-primary mb-4 text-2xl font-bold">Edit {item.title}</h1>
      <form onSubmit={(e) => void save(e)} className="space-y-4">
        <section className="card p-4 sm:p-5">
          <MediaCatalogueFields value={form} onChange={setForm} sources={sources} titleRequired disabled={saving} />
        </section>
        <section className="card p-4 sm:p-5" aria-labelledby="edit-people-heading">
          <h2 id="edit-people-heading" className="text-theme-text-primary mb-2 text-lg font-semibold">
            People
          </h2>
          <PersonTagPicker value={people} onChange={setPeople} disabled={saving} />
          {tagsChanged && (
            <p className="text-theme-text-secondary mt-2 text-xs">
              Changing who is tagged is a substantial change. Each new person’s photo-use answer shows on the item’s
              page after saving.
            </p>
          )}
        </section>
        <section>
          <EditKindChoice
            kind={editKind}
            onKindChange={setEditKind}
            note={editNote}
            onNoteChange={setEditNote}
            isPublic={item.publication_level === 'public'}
          />
        </section>
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="btn-primary rounded-md px-4 py-2 text-sm font-medium">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => void navigate(`/history/media/${item.id}`)}
            className="btn-secondary rounded-md px-4 py-2 text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default HistoryMediaEditPage;
