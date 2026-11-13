/**
 * Roster import: download the template, upload a file, and return to drafts
 * in progress or to committed imports.
 *
 * Nothing reaches the archive at upload. The file becomes a draft the
 * Historian reviews row by row on the next screen.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Download, FileUp, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { EmptyState } from '../../../components/ux/EmptyState';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { saveBlob } from '../../../utils/saveBlob';
import { historyService } from '../services/api';
import type { ImportSummary } from '../types';

const MAX_MB = 5;

function importSummaryText(item: ImportSummary): string {
  const counts = item.summary ?? {};
  const parts = [
    ['created', 'new'],
    ['mapped', 'linked to accounts'],
    ['matched', 'added to existing records'],
    ['skipped', 'skipped'],
    ['removed', 'removed afterwards'],
  ]
    .filter(([key]) => (counts[key ?? ''] ?? 0) > 0)
    .map(([key, label]) => `${counts[key ?? ''] ?? 0} ${label ?? ''}`);
  return parts.join(', ') || 'Nothing written';
}

export const HistoryImportListPage: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const inputRef = useRef<HTMLInputElement>(null);
  const [imports, setImports] = useState<ImportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    historyService
      .listImports()
      .then((items) => {
        setImports(items);
        setError(null);
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Unable to load imports.')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const downloadTemplate = async () => {
    try {
      saveBlob(await historyService.downloadImportTemplate(), 'history-roster-template.csv');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not download the template.'));
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Choose a CSV file. In Excel or Google Sheets, use Save As / Download as CSV.');
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`The file is over the ${MAX_MB} MB limit. Split it into smaller files.`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const draft = await historyService.uploadImport(file);
      void navigate(`/history/import/${draft.id}`);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not read this file.'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const drafts = imports.filter((i) => i.status === 'draft');
  const committed = imports.filter((i) => i.status === 'committed');

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'History', path: '/history' },
          { label: 'Past members', path: '/history/people' },
          { label: 'Import' },
        ]}
      />
      <div className="page-header mb-4">
        <h1 className="page-header-title text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <FileUp className="h-6 w-6 shrink-0" aria-hidden="true" />
          Import a Roster
        </h1>
      </div>

      <section className="card mb-6 p-4 sm:p-5" aria-labelledby="upload-heading">
        <h2 id="upload-heading" className="text-theme-text-primary mb-2 text-lg font-semibold">
          Upload a file
        </h2>
        <p className="text-theme-text-secondary mb-3 text-sm">
          A CSV with one person per line, up to 5,000 people. Dates can be written as a year (<code>1952</code>), a
          month (<code>1952-06</code> or <code>June 1952</code>) or a day, with <code>c.</code> in front when
          approximate; write <code>present</code> for someone still serving. Separate several titles with <code>;</code>
          . Nothing is added to the archive until you review the file and import it.
        </p>
        {error && (
          <div role="alert" className="alert-danger mb-3 rounded-md p-3 text-sm">
            {error}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <label
            className={`btn-primary inline-flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
              uploading ? 'pointer-events-none opacity-60' : ''
            }`}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {uploading ? 'Reading…' : 'Choose CSV file'}
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              disabled={uploading}
              onChange={(e) => void upload(e.target.files?.[0])}
            />
          </label>
          <button
            type="button"
            onClick={() => void downloadTemplate()}
            className="btn-secondary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download template
          </button>
        </div>
      </section>

      {!loading && imports.length === 0 ? (
        <EmptyState icon={FileUp} title="No imports yet" description="Upload a roster to start." />
      ) : (
        <>
          {drafts.length > 0 && (
            <section className="mb-6" aria-labelledby="drafts-heading">
              <h2 id="drafts-heading" className="text-theme-text-primary mb-2 text-lg font-semibold">
                In review
              </h2>
              <ul className="card divide-theme-surface-border divide-y">
                {drafts.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <Link
                        to={`/history/import/${item.id}`}
                        className="text-theme-text-primary touch-target-phone inline-flex items-center font-medium underline-offset-2 hover:underline"
                      >
                        {item.source_filename}
                      </Link>
                      <p className="text-theme-text-secondary text-sm">
                        {item.row_count} {item.row_count === 1 ? 'person' : 'people'} · uploaded{' '}
                        {formatDate(item.created_at, tz)}
                        {item.expires_at && <> · deleted if untouched by {formatDate(item.expires_at, tz)}</>}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {committed.length > 0 && (
            <section aria-labelledby="committed-heading">
              <h2 id="committed-heading" className="text-theme-text-primary mb-2 text-lg font-semibold">
                Imported
              </h2>
              <ul className="card divide-theme-surface-border divide-y" aria-busy={loading}>
                {committed.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <Link
                        to={`/history/import/${item.id}`}
                        className="text-theme-text-primary touch-target-phone inline-flex items-center font-medium underline-offset-2 hover:underline"
                      >
                        {item.source_filename}
                      </Link>
                      <p className="text-theme-text-secondary text-sm">
                        {item.committed_at ? formatDate(item.committed_at, tz) : ''} · {importSummaryText(item)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default HistoryImportListPage;
