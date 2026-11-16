/**
 * ExportControls Component
 *
 * CSV and PDF downloads of the report on screen. Both are built and audited
 * on the server, which re-runs the report rather than printing rows the page
 * holds: the PDF gets the department's letterhead, page numbers, a header row
 * on every page and the department's time zone, and every download is
 * recorded, which a browser print could do none of.
 */

import React, { useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { saveFile } from '@/utils/fileDownload';
import { getErrorMessage } from '@/utils/errorHandling';
import { reportsApiService } from '../services/api';
import { ReportExportFormat, type ReportExportSource } from '../types';

interface ExportControlsProps {
  reportTitle: string;
  /** What produced the report on screen; null when nothing can be re-run. */
  source: ReportExportSource | null;
  /** True when the report has nothing to export. */
  disabled?: boolean;
}

const BUTTON_CLASS =
  'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover focus:ring-theme-focus-ring touch:min-h-11 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50';

export const ExportControls: React.FC<ExportControlsProps> = ({ reportTitle, source, disabled = false }) => {
  const [busy, setBusy] = useState<ReportExportFormat | null>(null);

  const download = async (format: ReportExportFormat) => {
    if (!source) return;
    setBusy(format);
    try {
      const fallbackName = `${reportTitle.replace(/\s+/g, '_').toLowerCase()}.${format}`;
      saveFile(await reportsApiService.exportReport(source, format, fallbackName));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not download the report'));
    } finally {
      setBusy(null);
    }
  };

  const unavailable = disabled || source === null || busy !== null;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={unavailable}
        aria-busy={busy === ReportExportFormat.CSV}
        onClick={() => void download(ReportExportFormat.CSV)}
        className={BUTTON_CLASS}
      >
        {busy === ReportExportFormat.CSV ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        CSV
      </button>
      <button
        type="button"
        disabled={unavailable}
        aria-busy={busy === ReportExportFormat.PDF}
        onClick={() => void download(ReportExportFormat.PDF)}
        className={BUTTON_CLASS}
      >
        {busy === ReportExportFormat.PDF ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        PDF
      </button>
    </div>
  );
};
