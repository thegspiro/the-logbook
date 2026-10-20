/**
 * QuickBooks chart of accounts — the Account List report the Treasurer
 * uploads so account names are checked before a file goes to QuickBooks
 * (`GET/POST/DELETE /finance/export/chart-of-accounts`, `finance.manage`).
 *
 * The journal-entry import matches accounts by name, so a misspelled or
 * renamed account otherwise fails inside QuickBooks after the file has left.
 * Which names are missing is the backend's call, made by the same resolver
 * the export runs and shown on the readiness tables above; this section only
 * uploads, shows and removes the chart.
 *
 * Loaded on its own so a failure here never hides the mappings above it.
 */

import React, { useCallback, useEffect, useId, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useTimezone } from '@/hooks/useTimezone';
import { formatDateTime, formatNumber } from '@/utils/dateFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { exportMappingService } from '../services/api';
import type { QuickBooksChart } from '../types';

const CHART_ACCEPT = '.xlsx,.csv';

interface ChartOfAccountsSectionProps {
  /** Called after the chart changes, so the readiness tables can be reloaded. */
  onChanged: () => void;
}

export const ChartOfAccountsSection: React.FC<ChartOfAccountsSectionProps> = ({ onChanged }) => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const inputId = useId();
  const [chart, setChart] = useState<QuickBooksChart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setChart(await exportMappingService.chart());
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load the chart of accounts.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared so choosing the same file again (after fixing it) fires a change.
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const next = await exportMappingService.uploadChart(file);
      setChart(next);
      toast.success(`Chart of accounts uploaded: ${formatNumber(next.accounts.length)} accounts`);
      onChanged();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not read the chart of accounts.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const confirmed = await confirm({
      title: 'Remove the chart of accounts?',
      message:
        'Exports stop checking account names against QuickBooks. A misspelled account is then only caught when QuickBooks rejects the import.',
      confirmLabel: 'Remove chart',
      cancelLabel: 'Keep it',
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await exportMappingService.clearChart();
      setChart({ uploadedAt: null, uploadedByName: null, accounts: [] });
      toast.success('Chart of accounts removed');
      onChanged();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not remove the chart of accounts.'));
    } finally {
      setBusy(false);
    }
  };

  const uploaded = Boolean(chart?.uploadedAt) && (chart?.accounts.length ?? 0) > 0;

  return (
    <section aria-labelledby="chart-heading" className="card space-y-4 p-6">
      <div>
        <h2 id="chart-heading" className="text-theme-text-primary text-lg font-semibold">
          QuickBooks chart of accounts
        </h2>
        <p className="text-theme-text-secondary mt-1 text-sm">
          In QuickBooks Online, open <span className="font-medium">Reports › Account List</span> and export it to Excel
          or CSV, then upload the file here. Exports are then refused while any account named on this page is missing
          from it, so a misspelling is caught here rather than by QuickBooks. Upload it again after adding or renaming
          an account in QuickBooks.
        </p>
      </div>

      {error && (
        <p role="alert" className="alert-danger text-sm">
          {error}
        </p>
      )}

      {chart && (
        <p className="text-theme-text-primary text-sm">
          {uploaded && chart.uploadedAt
            ? `${formatNumber(chart.accounts.length)} accounts, uploaded ${formatDateTime(chart.uploadedAt, tz)}${
                chart.uploadedByName ? ` by ${chart.uploadedByName}` : ''
              }.`
            : 'No chart of accounts uploaded. Account names are not checked against QuickBooks.'}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor={inputId}
          className={`btn-secondary focus-within:ring-theme-focus-ring inline-flex cursor-pointer items-center gap-2 focus-within:ring-2 ${
            busy ? 'pointer-events-none opacity-60' : ''
          }`}
        >
          <input
            id={inputId}
            type="file"
            accept={CHART_ACCEPT}
            className="sr-only"
            onChange={(e) => void upload(e)}
            disabled={busy}
          />
          <Upload className="h-4 w-4" aria-hidden="true" />
          {busy ? 'Working…' : uploaded ? 'Upload a new chart' : 'Upload chart of accounts'}
        </label>
        {uploaded && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Remove chart
          </button>
        )}
      </div>

      {uploaded && chart && (
        <details className="text-sm">
          <summary className="text-theme-text-secondary hover:text-theme-text-primary touch:min-h-11 cursor-pointer">
            Show the accounts
          </summary>
          <ul className="text-theme-text-primary mt-2 max-h-72 space-y-1 overflow-y-auto pl-1">
            {chart.accounts.map((account) => (
              <li key={account.name}>
                {account.name}
                {account.accountType && <span className="text-theme-text-secondary"> · {account.accountType}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
};

export default ChartOfAccountsSection;
