/**
 * Uploading up to 25 photos, recordings or videos at once, with one set of
 * catalogue fields and tags for the batch.
 *
 * Each file goes in its own request, one after another: the server accepts
 * 60 MB per request, and one refused file (wrong type, too large, unreadable)
 * must not stop the rest. Every file becomes a draft.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, CheckCircle2, Loader2, Upload, XCircle } from 'lucide-react';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { getErrorMessage } from '../../../utils/errorHandling';
import { MediaCatalogueFields } from '../components/MediaCatalogueFields';
import { EMPTY_CATALOGUE, catalogueForCreate, type CatalogueForm } from '../utils/mediaCatalogue';
import { AV_EXTENSIONS, MAX_FILES, PHOTO_EXTENSIONS, extensionOf, precheck } from '../utils/mediaUpload';
import { PersonTagPicker, type PickedPerson } from '../components/PersonTagPicker';
import { historyMediaService } from '../services/api';
import type { HistorySource } from '../types';

type QueueState = 'waiting' | 'uploading' | 'done' | 'failed';

interface QueueItem {
  key: string;
  file: File;
  state: QueueState;
  progress: number;
  error?: string | undefined;
  mediaId?: string | undefined;
}

const newBatchId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;

export const HistoryMediaUploadPage: React.FC = () => {
  const [sources, setSources] = useState<HistorySource[]>([]);
  const [form, setForm] = useState<CatalogueForm>(EMPTY_CATALOGUE);
  const [people, setPeople] = useState<PickedPerson[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [tooMany, setTooMany] = useState(false);

  useEffect(() => {
    void historyMediaService
      .listSources()
      .then(setSources)
      .catch(() => setSources([]));
  }, []);

  const choose = (files: FileList | null) => {
    if (!files) return;
    const picked = Array.from(files);
    setTooMany(picked.length > MAX_FILES);
    setQueue(
      picked.slice(0, MAX_FILES).map((file, index) => {
        const problem = precheck(file);
        return {
          key: `${index}-${file.name}-${file.size}`,
          file,
          state: problem ? 'failed' : 'waiting',
          progress: 0,
          error: problem ?? undefined,
        };
      })
    );
  };

  const update = (key: string, changes: Partial<QueueItem>) =>
    setQueue((current) => current.map((item) => (item.key === key ? { ...item, ...changes } : item)));

  const start = async () => {
    setRunning(true);
    const batchId = newBatchId();
    const catalogue = { ...catalogueForCreate(form), tag_member_ids: people.map((p) => p.member_id) };
    for (const item of queue) {
      if (item.state !== 'waiting') continue;
      update(item.key, { state: 'uploading', progress: 0 });
      try {
        const created = await historyMediaService.uploadMedia(item.file, catalogue, batchId, (fraction) =>
          update(item.key, { progress: fraction })
        );
        update(item.key, { state: 'done', progress: 1, mediaId: created.id });
      } catch (err: unknown) {
        update(item.key, { state: 'failed', error: getErrorMessage(err, 'Could not upload this file') });
      }
    }
    setRunning(false);
  };

  const waiting = queue.filter((q) => q.state === 'waiting').length;
  const done = queue.filter((q) => q.state === 'done').length;
  const hasAv = useMemo(() => queue.some((q) => AV_EXTENSIONS.includes(extensionOf(q.file.name))), [queue]);

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'History', path: '/history' },
          { label: 'Photos and media', path: '/history/media' },
          { label: 'Upload' },
        ]}
      />
      <h1 className="text-theme-text-primary mb-4 flex items-center gap-2 text-2xl font-bold">
        <Upload className="h-6 w-6 shrink-0" aria-hidden="true" />
        Upload Photos and Media
      </h1>

      <section className="card mb-4 p-4 sm:p-5" aria-labelledby="files-heading">
        <h2 id="files-heading" className="text-theme-text-primary mb-1 text-lg font-semibold">
          Files
        </h2>
        <p className="text-theme-text-secondary mb-3 text-sm">
          Up to {MAX_FILES} at a time. Photos: JPEG, PNG, WebP or TIFF, up to 20 MB. Audio: MP3, M4A, WAV or FLAC;
          video: MP4 or WebM, up to 55 MB. The original is kept exactly as uploaded and only the Historian can download
          it; a photo is shown to everyone else with its location and camera data removed.
        </p>
        <input
          type="file"
          multiple
          accept={[...PHOTO_EXTENSIONS, ...AV_EXTENSIONS].join(',')}
          onChange={(e) => choose(e.target.files)}
          disabled={running}
          aria-label="Choose files"
          className="form-input"
        />
        {tooMany && (
          <p role="alert" className="alert-warning mt-2 rounded-md p-2 text-sm">
            Only the first {MAX_FILES} files were added. Upload the rest as another batch.
          </p>
        )}
        {hasAv && (
          <p className="alert-warning mt-2 flex items-start gap-2 rounded-md p-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Audio and video are shown to members exactly as uploaded. A recording made on a phone can carry the place it
            was made; check before publishing one.
          </p>
        )}
        {queue.length > 0 && (
          <ul className="mt-3 space-y-1" aria-label="Upload queue">
            {queue.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center gap-2 text-sm">
                {item.state === 'done' && <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />}
                {item.state === 'failed' && <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />}
                {item.state === 'uploading' && <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
                <span className="text-theme-text-primary min-w-0 truncate font-medium">{item.file.name}</span>
                <span className="text-theme-text-secondary">
                  {item.state === 'waiting' && 'Ready'}
                  {item.state === 'uploading' && `${Math.round(item.progress * 100)}%`}
                  {item.state === 'done' && item.mediaId && (
                    <Link to={`/history/media/${item.mediaId}`} className="underline">
                      Uploaded
                    </Link>
                  )}
                  {item.state === 'failed' && item.error}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card mb-4 p-4 sm:p-5" aria-labelledby="catalogue-heading">
        <h2 id="catalogue-heading" className="text-theme-text-primary mb-3 text-lg font-semibold">
          Catalogue for every file
        </h2>
        <MediaCatalogueFields
          value={form}
          onChange={setForm}
          sources={sources}
          titleRequired={false}
          disabled={running}
        />
      </section>

      <section className="card mb-4 p-4 sm:p-5" aria-labelledby="people-heading">
        <h2 id="people-heading" className="text-theme-text-primary mb-1 text-lg font-semibold">
          People in every file
        </h2>
        <p className="text-theme-text-secondary mb-3 text-sm">
          Each item's page shows whether a tagged member has agreed to photo use.
        </p>
        <PersonTagPicker value={people} onChange={setPeople} disabled={running} />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void start()}
          disabled={running || waiting === 0}
          className="btn-primary rounded-md px-4 py-2 text-sm font-medium"
        >
          {running ? 'Uploading…' : `Upload ${waiting} ${waiting === 1 ? 'file' : 'files'}`}
        </button>
        {done > 0 && !running && (
          <Link to="/history/media" className="text-theme-text-primary text-sm underline">
            Go to the gallery
          </Link>
        )}
      </div>
    </div>
  );
};

export default HistoryMediaUploadPage;
