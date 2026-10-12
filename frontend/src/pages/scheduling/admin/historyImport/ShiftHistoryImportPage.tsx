/**
 * Shift History Import
 *
 * Where a department starting on the platform brings in the shifts it worked
 * before it got here: a spreadsheet with one row per member per shift. An
 * upload is stored as a draft and nothing reaches the schedule until the admin
 * has reviewed it and committed it on the review page, so a file can take
 * several sittings to clean. A committed import is final; its shifts are
 * corrected one at a time like any other shift.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Download, FileSpreadsheet, Trash2, Upload } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import SchedulingHeader from '../../SchedulingHeader';
import { EmptyState, FileDropzone, SkeletonPage } from '../../../../components/ux';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import { HISTORY_IMPORT_STATUS_COLORS } from '../../../../constants/enums';
import { useTimezone } from '../../../../hooks/useTimezone';
import { historyImportService } from '../../../../modules/scheduling/services/historyImportApi';
import type { HistoryImportSummary } from '../../../../modules/scheduling/types/historyImport';
import { HistoryImportStatus } from '../../../../modules/scheduling/types/historyImport';
import { formatDateTime } from '../../../../utils/dateFormatting';
import { getErrorMessage } from '../../../../utils/errorHandling';
import { timezoneOptions, zoneLabel } from './historyImportTimezones';

const MAX_UPLOAD_MB = 10;

const ShiftHistoryImportPage: React.FC = () => {
  const tz = useTimezone();
  const navigate = useNavigate();
  const { confirm } = useConfirm();

  const [imports, setImports] = useState<HistoryImportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [fileTimezone, setFileTimezone] = useState('');
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      setImports(await historyImportService.listImports());
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
    if (!file) return;
    setUploading(true);
    try {
      const created = await historyImportService.upload(file, fileTimezone || undefined);
      toast.success(`Read ${created.row_count} rows from ${created.source_filename}`);
      void navigate(`/scheduling/admin/history-import/${created.id}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not read that file'));
    } finally {
      setUploading(false);
    }
  };

  const handleTemplate = async () => {
    try {
      const blob = await historyImportService.downloadTemplate();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'shift_history_template.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not download the template'));
    }
  };

  const handleDiscard = async (item: HistoryImportSummary) => {
    const ok = await confirm({
      title: 'Discard this draft?',
      message: `The draft for ${item.source_filename} and every decision made on it will be deleted. Nothing was written to the schedule, so no shifts are affected.`,
      confirmLabel: 'Discard draft',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await historyImportService.discard(item.id);
      setImports((current) => current.filter((i) => i.id !== item.id));
      toast.success('Draft discarded');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not discard the draft'));
    }
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <SchedulingHeader
          title="Shift History Import"
          backTo="/scheduling/admin"
          backLabel="Back to scheduling administration"
          description="Bring in shifts worked before the department used this system"
        />

        <div className="space-y-6">
          <section className="card p-4 sm:p-6" aria-labelledby="history-upload-heading">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 id="history-upload-heading" className="text-theme-text-primary text-lg font-semibold">
                  Upload a file
                </h2>
                <p className="text-theme-text-secondary mt-1 text-sm">
                  A CSV with one row per member per shift: who, which unit, the date, and the start and end times.
                  Nothing is added to the schedule until you review the file and commit it. Up to 10,000 rows per file —
                  split a larger history by year.
                </p>
              </div>
              <button type="button" className="btn-secondary shrink-0" onClick={() => void handleTemplate()}>
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Download template
              </button>
            </div>

            <FileDropzone
              accept=".csv,text/csv"
              maxSizeMB={MAX_UPLOAD_MB}
              label="Drop a CSV here or click to browse"
              onFilesSelected={(files) => setFile(files[0] ?? null)}
            />

            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="sm:w-80">
                <label htmlFor="history-upload-timezone" className="form-label">
                  Times in the file are in
                </label>
                <select
                  id="history-upload-timezone"
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
              <button
                type="button"
                className="btn-primary"
                disabled={!file || uploading}
                onClick={() => void handleUpload()}
              >
                <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                {uploading ? 'Reading file…' : 'Upload and review'}
              </button>
            </div>
          </section>

          <section aria-labelledby="history-imports-heading">
            <h2 id="history-imports-heading" className="text-theme-text-primary mb-3 text-lg font-semibold">
              Imports
            </h2>
            {loading ? (
              <SkeletonPage rows={3} showStats={false} />
            ) : imports.length === 0 ? (
              <EmptyState
                icon={FileSpreadsheet}
                title="No imports yet"
                description="Upload a file above to start one."
                headingLevel={3}
              />
            ) : (
              <ul className="card divide-theme-surface-border divide-y">
                {imports.map((item) => (
                  <li key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-theme-text-primary truncate font-medium">{item.source_filename}</span>
                        <span className={`badge border ${HISTORY_IMPORT_STATUS_COLORS[item.status] ?? ''}`}>
                          {item.status === HistoryImportStatus.COMMITTED ? 'Committed' : 'Draft'}
                        </span>
                      </div>
                      <p className="text-theme-text-secondary mt-1 text-sm">
                        {item.row_count} rows · times in {zoneLabel(item.timezone)} · uploaded{' '}
                        {formatDateTime(item.created_at, tz)}
                        {item.committed_at ? ` · committed ${formatDateTime(item.committed_at, tz)}` : ''}
                      </p>
                      {item.summary && (
                        <p className="text-theme-text-secondary mt-1 text-sm">
                          {item.summary.shifts_created ?? 0} shifts created, {item.summary.shifts_updated ?? 0} added
                          to, {item.summary.attendance_created ?? 0} attendance records,{' '}
                          {item.summary.external_hours_created ?? 0} outside-agency entries,{' '}
                          {item.summary.members_created ?? 0} former members added
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Link to={`/scheduling/admin/history-import/${item.id}`} className="btn-secondary">
                        {item.status === HistoryImportStatus.DRAFT ? 'Review' : 'View'}
                      </Link>
                      {item.status === HistoryImportStatus.DRAFT && (
                        <button
                          type="button"
                          className="btn-icon text-theme-text-secondary"
                          aria-label={`Discard draft ${item.source_filename}`}
                          onClick={() => void handleDiscard(item)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default ShiftHistoryImportPage;
