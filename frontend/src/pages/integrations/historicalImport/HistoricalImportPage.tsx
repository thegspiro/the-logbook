/**
 * Historical Data Import
 *
 * Where a department brings in the hours it logged in a previous system: one
 * export holding shifts, on-call time, training and administrative hours
 * together. An upload is stored and nothing is written anywhere until each kind
 * of hour is reviewed and committed by the import built for it. Reached from
 * the Integrations page; IT administrator only.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, FileSpreadsheet, Trash2, Upload } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import { EmptyState, FileDropzone, SkeletonPage } from '../../../components/ux';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useTimezone } from '../../../hooks/useTimezone';
import { historicalImportService } from '../../../modules/integrations/services/historicalImportApi';
import type { HistoricalImportSummary } from '../../../modules/integrations/types/historicalImport';
import { formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { timezoneOptions, zoneLabel } from '../../scheduling/admin/historyImport/historyImportTimezones';

const MAX_UPLOAD_MB = 40;

const HistoricalImportPage: React.FC = () => {
  const tz = useTimezone();
  const navigate = useNavigate();
  const { confirm } = useConfirm();

  const [imports, setImports] = useState<HistoricalImportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [sourceSystem, setSourceSystem] = useState('');
  const [fileTimezone, setFileTimezone] = useState('');
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = await historicalImportService.listImports();
      setImports(found);
      // A re-import must name the same system to be recognised, so offer the
      // name used last.
      setSourceSystem((current) => current || found[0]?.source_system || '');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not load imports'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpload = async () => {
    if (!file || !sourceSystem.trim()) return;
    setUploading(true);
    try {
      const created = await historicalImportService.upload(file, sourceSystem.trim(), fileTimezone || undefined);
      toast.success(`Read ${created.row_count} rows from ${created.source_filename}`);
      void navigate(`/integrations/historical-import/${created.id}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not read that file'));
    } finally {
      setUploading(false);
    }
  };

  const handleDiscard = async (item: HistoricalImportSummary) => {
    const ok = await confirm({
      title: 'Discard this import?',
      message: `The upload of ${item.source_filename} and any shift batches still in review are deleted. Batches already committed stay on the schedule, and their rows stay recorded as imported.`,
      confirmLabel: 'Discard import',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await historicalImportService.discard(item.id);
      setImports((current) => current.filter((i) => i.id !== item.id));
      toast.success('Import discarded');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not discard the import'));
    }
  };

  return (
    <div className="mx-auto min-h-screen max-w-5xl p-4 sm:p-6">
      <Link
        to="/integrations"
        className="text-theme-text-secondary hover:text-theme-text-primary mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All integrations
      </Link>
      <h1 className="text-theme-text-primary mb-1 text-2xl font-bold sm:text-3xl">Historical Data Import</h1>
      <p className="text-theme-text-secondary mb-6 text-sm">
        Bring in the hours members logged in your previous system — shifts, on-call time, training and administrative
        work — from one export. Nothing is written until you review each kind and commit it.
      </p>

      <div className="space-y-6">
        <section className="card p-4 sm:p-6" aria-labelledby="historical-upload-heading">
          <h2 id="historical-upload-heading" className="text-theme-text-primary text-lg font-semibold">
            Upload an export
          </h2>
          <p className="text-theme-text-secondary mt-1 mb-4 text-sm">
            A CSV with one row per entry: the member, the date and times, and a column for each kind of hours. Up to
            200,000 rows and {MAX_UPLOAD_MB}MB.
          </p>

          <FileDropzone
            accept=".csv,text/csv"
            maxSizeMB={MAX_UPLOAD_MB}
            label="Drop a CSV here or click to browse"
            onFilesSelected={(files) => setFile(files[0] ?? null)}
          />

          <div className="field-grid mt-4 gap-4">
            <div>
              <label htmlFor="historical-source-system" className="form-label">
                Which system is this from?
              </label>
              <input
                id="historical-source-system"
                className="form-input"
                maxLength={100}
                value={sourceSystem}
                placeholder="e.g. Hours database"
                onChange={(e) => setSourceSystem(e.target.value)}
              />
              <p className="text-theme-text-secondary mt-1 text-xs">
                Use the same name every time you import from this system, so rows already brought in are recognised.
              </p>
            </div>
            <div>
              <label htmlFor="historical-upload-timezone" className="form-label">
                Times in the file are in
              </label>
              <select
                id="historical-upload-timezone"
                className="form-input"
                value={fileTimezone}
                onChange={(e) => setFileTimezone(e.target.value)}
              >
                <option value="">The department's time zone</option>
                {timezoneOptions(tz).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              disabled={!file || !sourceSystem.trim() || uploading}
              onClick={() => void handleUpload()}
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              {uploading ? 'Reading file…' : 'Upload and review'}
            </button>
          </div>
        </section>

        <section aria-labelledby="historical-imports-heading">
          <h2 id="historical-imports-heading" className="text-theme-text-primary mb-3 text-lg font-semibold">
            Imports
          </h2>
          {loading ? (
            <SkeletonPage rows={3} showStats={false} />
          ) : imports.length === 0 ? (
            <EmptyState
              icon={FileSpreadsheet}
              title="No imports yet"
              description="Upload an export above to start one."
              headingLevel={3}
            />
          ) : (
            <ul className="card divide-theme-surface-border divide-y">
              {imports.map((item) => (
                <li key={item.id} className="split-row gap-3 p-4 sm:items-center">
                  <div className="split-row-main">
                    <span className="text-theme-text-primary block truncate font-medium">{item.source_filename}</span>
                    <p className="text-theme-text-secondary mt-1 text-sm">
                      {item.source_system} · {item.row_count} rows · times in {zoneLabel(item.timezone)} · uploaded{' '}
                      {formatDateTime(item.created_at, tz)}
                    </p>
                  </div>
                  <div className="split-row-aside flex flex-wrap gap-2">
                    <Link to={`/integrations/historical-import/${item.id}`} className="btn-secondary">
                      Open
                    </Link>
                    <button
                      type="button"
                      className="btn-icon text-theme-text-secondary"
                      aria-label={`Discard import ${item.source_filename}`}
                      onClick={() => void handleDiscard(item)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};

export default HistoricalImportPage;
