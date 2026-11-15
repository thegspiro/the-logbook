/**
 * Uploading up to 25 documents at once, with one set of catalogue fields and
 * people for the batch. Each file is its own request, one after another, and
 * becomes a draft.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Loader2, Upload, XCircle } from 'lucide-react';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { DocumentCatalogueFields } from '../components/DocumentCatalogueFields';
import { PersonTagPicker, type PickedPerson } from '../components/PersonTagPicker';
import { MAX_QUEUE_FILES, useUploadQueue } from '../hooks/useUploadQueue';
import { historyDocumentService, historyMediaService } from '../services/api';
import type { HistoryDocumentType, HistorySource } from '../types';
import {
  DOCUMENT_EXTENSIONS,
  EMPTY_DOCUMENT_CATALOGUE,
  documentCatalogueForCreate,
  documentPrecheck,
  type DocumentCatalogueForm,
} from '../utils/documentCatalogue';

export const HistoryDocumentUploadPage: React.FC = () => {
  const [sources, setSources] = useState<HistorySource[]>([]);
  const [types, setTypes] = useState<HistoryDocumentType[]>([]);
  const [form, setForm] = useState<DocumentCatalogueForm>(EMPTY_DOCUMENT_CATALOGUE);
  const [people, setPeople] = useState<PickedPerson[]>([]);

  useEffect(() => {
    void historyMediaService
      .listSources()
      .then(setSources)
      .catch(() => setSources([]));
    void historyDocumentService
      .listTypes()
      .then(setTypes)
      .catch(() => setTypes([]));
  }, []);

  const { queue, running, tooMany, choose, start, waiting, done } = useUploadQueue(
    documentPrecheck,
    (file, batchId, onProgress) =>
      historyDocumentService.uploadDocument(
        file,
        { ...documentCatalogueForCreate(form), tag_member_ids: people.map((p) => p.member_id) },
        batchId,
        onProgress
      )
  );

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'History', path: '/history' },
          { label: 'Documents', path: '/history/documents' },
          { label: 'Upload' },
        ]}
      />
      <h1 className="text-theme-text-primary mb-4 flex items-center gap-2 text-2xl font-bold">
        <Upload className="h-6 w-6 shrink-0" aria-hidden="true" />
        Upload Documents
      </h1>

      <section className="card mb-4 p-4 sm:p-5" aria-labelledby="document-files-heading">
        <h2 id="document-files-heading" className="text-theme-text-primary mb-1 text-lg font-semibold">
          Files
        </h2>
        <p className="text-theme-text-secondary mb-3 text-sm">
          Up to {MAX_QUEUE_FILES} at a time: PDFs, or scans as JPEG, PNG or WebP, up to 50 MB each. Convert Word and
          other files to PDF first. The original is kept exactly as uploaded and only the Historian can download it;
          everyone else opens a copy with its hidden author, software and location details, scripts and attachments
          removed.
        </p>
        <input
          type="file"
          multiple
          accept={DOCUMENT_EXTENSIONS.join(',')}
          onChange={(e) => choose(e.target.files)}
          disabled={running}
          aria-label="Choose files"
          className="form-input"
        />
        {tooMany && (
          <p role="alert" className="alert-warning mt-2 rounded-md p-2 text-sm">
            Only the first {MAX_QUEUE_FILES} files were added. Upload the rest as another batch.
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
                  {item.state === 'done' && item.createdId && (
                    <Link to={`/history/documents/${item.createdId}`} className="underline">
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

      <section className="card mb-4 p-4 sm:p-5" aria-labelledby="document-catalogue-heading">
        <h2 id="document-catalogue-heading" className="text-theme-text-primary mb-3 text-lg font-semibold">
          Catalogue for every file
        </h2>
        <DocumentCatalogueFields
          value={form}
          onChange={setForm}
          sources={sources}
          types={types}
          titleRequired={false}
          disabled={running}
        />
      </section>

      <section className="card mb-4 p-4 sm:p-5" aria-labelledby="document-people-heading">
        <h2 id="document-people-heading" className="text-theme-text-primary mb-1 text-lg font-semibold">
          People in every file
        </h2>
        <p className="text-theme-text-secondary mb-3 text-sm">Who the documents are by, to or about.</p>
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
          <Link to="/history/documents" className="text-theme-text-primary text-sm underline">
            Go to the documents
          </Link>
        )}
      </div>
    </div>
  );
};

export default HistoryDocumentUploadPage;
