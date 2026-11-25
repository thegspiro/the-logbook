/**
 * Writing or editing an article: its title and byline, a cover photo, the
 * body block by block, what it links to, and the references it cites.
 *
 * On an edit, a change to anything a reader sees, its body and links
 * included, is recorded as substantial whatever is chosen here: the server
 * decides, so a public article keeps its cleared version until the change is
 * cleared.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { getErrorMessage } from '../../../utils/errorHandling';
import { ApparatusPicker } from '../components/ApparatusPicker';
import { ArchivePhotoPicker } from '../components/ArchivePhotoPicker';
import { ArticleBlocksEditor } from '../components/ArticleBlocksEditor';
import { EditKindChoice } from '../components/EditKindChoice';
import { PersonTagPicker } from '../components/PersonTagPicker';
import { RecordLinksPicker } from '../components/RecordLinksPicker';
import { historyArticleService, mediaFileUrl } from '../services/api';
import type { ArticleFullView, EditKind } from '../types';
import {
  articleForCreate,
  articleFormFrom,
  articleForUpdate,
  emptyArticleForm,
  type ArticleForm,
} from '../utils/articleCatalogue';

const MAX_CITATIONS = 100;

export const HistoryArticleFormPage: React.FC = () => {
  const { articleId } = useParams();
  const isEdit = Boolean(articleId);
  const navigate = useNavigate();
  const [item, setItem] = useState<ArticleFullView | null>(null);
  const [form, setForm] = useState<ArticleForm | null>(isEdit ? null : emptyArticleForm);
  const [pickingCover, setPickingCover] = useState(false);
  const [editKind, setEditKind] = useState<EditKind>('minor');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!articleId) return;
    historyArticleService
      .getArticle(articleId)
      .then((loaded) => {
        if (loaded.view !== 'full') {
          setError('Only the archive’s keepers can edit an article.');
          return;
        }
        setItem(loaded);
        setForm(articleFormFrom(loaded));
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Unable to load this article.')));
  }, [articleId]);

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

  const set = <K extends keyof ArticleForm>(key: K, value: ArticleForm[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const setCitation = (index: number, text: string) =>
    set(
      'citations',
      form.citations.map((c, i) => (i === index ? text : c))
    );
  const moveCitation = (index: number, step: -1 | 1) => {
    const target = index + step;
    if (target < 0 || target >= form.citations.length) return;
    const next = [...form.citations];
    const [moved] = next.splice(index, 1);
    if (moved !== undefined) next.splice(target, 0, moved);
    set('citations', next);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Enter a title');
      return;
    }
    setSaving(true);
    try {
      const saved = item
        ? await historyArticleService.updateArticle(item.id, {
            ...articleForUpdate(form),
            edit_kind: editKind,
            edit_note: editNote.trim() || undefined,
          })
        : await historyArticleService.createArticle(articleForCreate(form));
      toast.success(item ? 'Saved' : 'Article saved as a draft');
      void navigate(`/history/articles/${saved.id}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save this article'));
    } finally {
      setSaving(false);
    }
  };

  const heading = item ? `Edit ${item.title}` : 'Write an article';

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'History', path: '/history' },
          { label: 'Articles', path: '/history/articles' },
          ...(item
            ? [{ label: item.title, path: `/history/articles/${item.id}` }, { label: 'Edit' }]
            : [{ label: 'New' }]),
        ]}
      />
      <h1 className="text-theme-text-primary mb-4 text-2xl font-bold">{heading}</h1>
      <form onSubmit={(e) => void save(e)} className="space-y-4">
        <section className="card grid gap-4 p-4 sm:grid-cols-2 sm:p-5" aria-label="Title, byline and cover">
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
          <label className="block sm:col-span-2">
            <span className="form-label">Subtitle</span>
            <input
              value={form.subtitle}
              maxLength={300}
              onChange={(e) => set('subtitle', e.target.value)}
              className="form-input"
              disabled={saving}
            />
          </label>
          <div className="block">
            <label className="block">
              <span className="form-label">Byline</span>
              <input
                value={form.byline}
                maxLength={200}
                onChange={(e) => set('byline', e.target.value)}
                aria-describedby="article-byline-hint"
                className="form-input"
                disabled={saving}
              />
            </label>
            <span id="article-byline-hint" className="text-theme-text-secondary mt-1 block text-xs">
              {item
                ? 'Who wrote it. Leave it blank for no byline.'
                : 'Who wrote it. Left blank, your name is used. A retired member without an account can be named here.'}
            </span>
          </div>
          <div className="block sm:col-span-2">
            <label className="block">
              <span className="form-label">Summary</span>
              <textarea
                value={form.summary}
                rows={2}
                maxLength={2000}
                onChange={(e) => set('summary', e.target.value)}
                aria-describedby="article-summary-hint"
                className="form-input"
                disabled={saving}
              />
            </label>
            <span id="article-summary-hint" className="text-theme-text-secondary mt-1 block text-xs">
              A sentence or two for the article list and the top of a printed copy.
            </span>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <span className="form-label">Cover photo</span>
            {form.cover ? (
              <div className="flex flex-wrap items-center gap-3">
                <img
                  src={mediaFileUrl(form.cover.id, form.cover.has_thumbnail ? 'thumbnail' : 'view')}
                  alt={form.cover.title}
                  className="h-20 w-20 rounded-md object-cover"
                />
                <span className="text-theme-text-primary min-w-0 flex-1 text-sm break-words">{form.cover.title}</span>
                <button
                  type="button"
                  onClick={() => set('cover', null)}
                  disabled={saving}
                  className="btn-secondary rounded-md px-3 py-1.5 text-sm"
                >
                  Remove the cover
                </button>
              </div>
            ) : pickingCover ? (
              <ArchivePhotoPicker
                label="Find a cover photo"
                disabled={saving}
                onCancel={() => setPickingCover(false)}
                onPick={(media) => {
                  set('cover', media);
                  setPickingCover(false);
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setPickingCover(true)}
                disabled={saving}
                className="btn-secondary rounded-md px-3 py-1.5 text-sm"
              >
                Choose a cover photo
              </button>
            )}
          </div>
        </section>

        <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="article-form-body-heading">
          <h2 id="article-form-body-heading" className="text-theme-text-primary text-lg font-semibold">
            The article
          </h2>
          <p className="text-theme-text-secondary text-sm">
            Readers see every word and photo here. Name a member of the public only if the clearance list should check
            it; otherwise keep their name in the research notes. A public article can show only photos cleared for the
            public.
          </p>
          <ArticleBlocksEditor value={form.blocks} onChange={(next) => set('blocks', next)} disabled={saving} />
        </section>

        <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="article-form-links-heading">
          <h2 id="article-form-links-heading" className="text-theme-text-primary text-lg font-semibold">
            In this article
          </h2>
          <div className="space-y-2">
            <h3 className="text-theme-text-primary text-base font-semibold">People</h3>
            <PersonTagPicker
              value={form.members}
              onChange={(next) =>
                set(
                  'members',
                  next.map((p) => ({ member_id: p.member_id, display_name: p.display_name }))
                )
              }
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <h3 className="text-theme-text-primary text-base font-semibold">Events</h3>
            <RecordLinksPicker
              kind="event"
              value={form.events}
              onChange={(next) => set('events', next)}
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <h3 className="text-theme-text-primary text-base font-semibold">Apparatus</h3>
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
          </div>
          <div className="space-y-2">
            <h3 className="text-theme-text-primary text-base font-semibold">Documents</h3>
            <RecordLinksPicker
              kind="document"
              value={form.documents}
              onChange={(next) => set('documents', next)}
              disabled={saving}
            />
          </div>
        </section>

        <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="article-form-sources-heading">
          <h2 id="article-form-sources-heading" className="text-theme-text-primary text-lg font-semibold">
            Sources
          </h2>
          <p className="text-theme-text-secondary text-sm">
            The documents and events linked above, and the photos shown, are listed as sources on their own. Add
            anything else here: a book, a newspaper of a given date, an interview.
          </p>
          {form.citations.length > 0 && (
            <ol className="space-y-2" aria-label="References">
              {form.citations.map((citation, index) => (
                <li key={index} className="flex items-center gap-1">
                  <input
                    value={citation}
                    maxLength={500}
                    onChange={(e) => setCitation(index, e.target.value)}
                    aria-label={`Reference ${index + 1}`}
                    className="form-input min-w-0 flex-1"
                    disabled={saving}
                  />
                  <button
                    type="button"
                    className="btn-icon touch-target-phone"
                    aria-label={`Move reference ${index + 1} up`}
                    disabled={saving || index === 0}
                    onClick={() => moveCitation(index, -1)}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn-icon touch-target-phone"
                    aria-label={`Move reference ${index + 1} down`}
                    disabled={saving || index === form.citations.length - 1}
                    onClick={() => moveCitation(index, 1)}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn-icon touch-target-phone"
                    aria-label={`Remove reference ${index + 1}`}
                    disabled={saving}
                    onClick={() =>
                      set(
                        'citations',
                        form.citations.filter((_, i) => i !== index)
                      )
                    }
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
          )}
          <button
            type="button"
            onClick={() => set('citations', [...form.citations, ''])}
            disabled={saving || form.citations.length >= MAX_CITATIONS}
            className="btn-secondary inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add a reference
          </button>
        </section>

        <section className="card p-4 sm:p-5" aria-label="Research notes">
          <div className="block">
            <label className="block">
              <span className="form-label">Research notes (Historian only)</span>
              <textarea
                value={form.research_notes}
                rows={3}
                maxLength={20000}
                onChange={(e) => set('research_notes', e.target.value)}
                aria-describedby="article-notes-hint"
                className="form-input"
                disabled={saving}
              />
            </label>
            <span id="article-notes-hint" className="text-theme-text-secondary mt-1 block text-xs">
              Never shown to readers and never printed.
            </span>
          </div>
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
            {saving ? 'Saving…' : item ? 'Save' : 'Save as a draft'}
          </button>
          <button
            type="button"
            onClick={() => void navigate(item ? `/history/articles/${item.id}` : '/history/articles')}
            className="btn-secondary rounded-md px-4 py-2 text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default HistoryArticleFormPage;
