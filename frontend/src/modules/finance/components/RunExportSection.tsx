/**
 * Running the QuickBooks export: pick the days, download the journal-entry
 * import file the server builds (`POST /finance/export/transactions`).
 *
 * The period is whole days in the department's timezone, converted here to
 * the instants the API takes (utils/exportPeriod.ts). Whether the export can
 * run is the server's call: a payment whose category has no accounts refuses
 * the whole file, and the refusal names what to fix, which this shows as is.
 */

import React, { useState } from 'react';
import { Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useTimezone } from '@/hooks/useTimezone';
import { getTodayLocalDate } from '@/utils/dateFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { saveFile } from '@/utils/fileDownload';
import { exportMappingService } from '../services/api';
import { exportRange, MAX_EXPORT_DAYS, periodLength, previousMonth } from '../utils/exportPeriod';

interface RunExportSectionProps {
  /** Called after a file is produced, so the history beside it can refresh. */
  onExported: () => void;
}

export const RunExportSection: React.FC<RunExportSectionProps> = ({ onExported }) => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const [period, setPeriod] = useState(() => previousMonth(getTodayLocalDate(tz)));
  const [includeExported, setIncludeExported] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rangeError =
    !period.start || !period.end
      ? 'Choose the first and last day.'
      : period.end < period.start
        ? 'The last day must be on or after the first.'
        : periodLength(period.start, period.end) > MAX_EXPORT_DAYS
          ? `An export covers at most ${String(MAX_EXPORT_DAYS)} days; choose a shorter period.`
          : null;

  const run = async () => {
    if (rangeError) return;
    if (
      includeExported &&
      !(await confirm({
        title: 'Send payments again?',
        message:
          'Payments an earlier export already carried go into this file too. QuickBooks imports them a second time unless they were never imported, or you delete the earlier entries first.',
        confirmLabel: 'Include them',
        cancelLabel: 'Leave them out',
        variant: 'warning',
      }))
    ) {
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const file = await exportMappingService.run({
        ...exportRange(period.start, period.end, tz),
        includeExported,
      });
      saveFile(file);
      toast.success('QuickBooks file downloaded');
      onExported();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not produce the QuickBooks file.'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section aria-labelledby="run-export-heading" className="card space-y-4 p-6">
      <div>
        <h2 id="run-export-heading" className="text-theme-text-primary text-lg font-semibold">
          Run an export
        </h2>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Downloads a journal-entry file of the payments made in the period, to import in QuickBooks Online under{' '}
          <span className="font-medium">Settings › Import data › Journal entries</span>. Payments an earlier export
          already carried are left out, so overlapping periods do not import twice.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="export-start" className="form-label">
            First day
          </label>
          <input
            id="export-start"
            type="date"
            className="form-input"
            value={period.start}
            onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))}
          />
        </div>
        <div>
          <label htmlFor="export-end" className="form-label">
            Last day
          </label>
          <input
            id="export-end"
            type="date"
            className="form-input"
            value={period.end}
            onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))}
          />
        </div>
        <button
          type="button"
          className="btn-primary flex items-center gap-2"
          disabled={running || Boolean(rangeError)}
          onClick={() => void run()}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {running ? 'Preparing…' : 'Download QuickBooks file'}
        </button>
      </div>
      <label className="text-theme-text-primary flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="form-checkbox"
          checked={includeExported}
          onChange={(e) => setIncludeExported(e.target.checked)}
        />
        Include payments already sent to QuickBooks
      </label>
      {rangeError && <p className="text-theme-text-secondary text-sm">{rangeError}</p>}
      {error && (
        <p role="alert" className="alert-danger text-sm">
          {error}
        </p>
      )}
    </section>
  );
};

export default RunExportSection;
