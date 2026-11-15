/**
 * Editing a document: its catalogue and the people it concerns.
 *
 * A change to the title, description, date, author, recipient or
 * transcription is recorded as substantial whatever is chosen here: the
 * server decides, so a public document keeps its cleared version until the
 * change is cleared.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import toast from 'react-hot-toast';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { getErrorMessage } from '../../../utils/errorHandling';
import { DocumentCatalogueFields } from '../components/DocumentCatalogueFields';
import { EditKindChoice } from '../components/EditKindChoice';
import { PersonTagPicker, type PickedPerson } from '../components/PersonTagPicker';
import { historyDocumentService, historyMediaService } from '../services/api';
import type { DocumentFullView, EditKind, HistoryDocumentType, HistorySource } from '../types';
import {
  documentCatalogueForUpdate,
  documentCatalogueFrom,
  type DocumentCatalogueForm,
} from '../utils/documentCatalogue';

export const HistoryDocumentEditPage: React.FC = () => {
  const { documentId = '' } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<DocumentFullView | null>(null);
  const [form, setForm] = useState<DocumentCatalogueForm | null>(null);
  const [people, setPeople] = useState<PickedPerson[]>([]);
  const [sources, setSources] = useState<HistorySource[]>([]);
  const [types, setTypes] = useState<HistoryDocumentType[]>([]);
  const [editKind, setEditKind] = useState<EditKind>('minor');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    historyDocumentService
      .getDocument(documentId)
      .then((loaded) => {
        if (loaded.view !== 'full') {
          setError('Only the archive’s keepers can edit a document.');
          return;
        }
        setItem(loaded);
        setForm(documentCatalogueFrom(loaded));
        setPeople(loaded.tags);
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Unable to load this document.')));
    void historyMediaService
      .listSources(true)
      .then(setSources)
      .catch(() => setSources([]));
    void historyDocumentService
      .listTypes(true)
      .then(setTypes)
      .catch(() => setTypes([]));
  }, [documentId]);

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
      await historyDocumentService.updateDocument(item.id, {
        ...documentCatalogueForUpdate(form),
        edit_kind: editKind,
        edit_note: editNote.trim() || undefined,
      });
      if (tagsChanged) {
        await historyDocumentService.replaceTags(
          item.id,
          people.map((p) => p.member_id)
        );
      }
      toast.success('Saved');
      void navigate(`/history/documents/${item.id}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save this document'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'History', path: '/history' },
          { label: 'Documents', path: '/history/documents' },
          { label: item.title, path: `/history/documents/${item.id}` },
          { label: 'Edit' },
        ]}
      />
      <h1 className="text-theme-text-primary mb-4 text-2xl font-bold">Edit {item.title}</h1>
      <form onSubmit={(e) => void save(e)} className="space-y-4">
        <section className="card p-4 sm:p-5">
          <DocumentCatalogueFields
            value={form}
            onChange={setForm}
            sources={sources}
            types={types}
            titleRequired
            disabled={saving}
          />
        </section>
        <section className="card p-4 sm:p-5" aria-labelledby="edit-document-people-heading">
          <h2 id="edit-document-people-heading" className="text-theme-text-primary mb-2 text-lg font-semibold">
            People
          </h2>
          <PersonTagPicker value={people} onChange={setPeople} disabled={saving} />
          {tagsChanged && (
            <p className="text-theme-text-secondary mt-2 text-xs">Changing who is tagged is a substantial change.</p>
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
            onClick={() => void navigate(`/history/documents/${item.id}`)}
            className="btn-secondary rounded-md px-4 py-2 text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default HistoryDocumentEditPage;
