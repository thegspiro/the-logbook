/**
 * ExportControls Component
 *
 * Provides CSV and Print/PDF export buttons for report data.
 */

import React from 'react';
import { Download, Printer } from 'lucide-react';
import { exportReportAsCsv, exportReportAsPrintablePdf } from '../utils/export';

interface ExportControlsProps {
  reportTitle: string;
  rows: Array<Record<string, unknown>>;
  columns?: Array<{ key: string; header: string }>;
  disabled?: boolean;
}

export const ExportControls: React.FC<ExportControlsProps> = ({
  reportTitle,
  rows,
  columns,
  disabled = false,
}) => {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={disabled || rows.length === 0}
        onClick={() => exportReportAsCsv(reportTitle, rows, columns)}
        className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover focus:ring-theme-focus-ring inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        CSV
      </button>
      <button
        type="button"
        disabled={disabled || rows.length === 0}
        onClick={() => exportReportAsPrintablePdf(reportTitle, rows, columns)}
        className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover focus:ring-theme-focus-ring inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Printer className="h-3.5 w-3.5" aria-hidden="true" />
        Print / PDF
      </button>
    </div>
  );
};
