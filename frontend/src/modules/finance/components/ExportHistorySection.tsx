/**
 * Export history — every QuickBooks transactions export, newest first.
 *
 * `GET /finance/export/logs` (`finance.manage`). A log row is written before
 * the first byte of the file is sent and finished when the stream ends, so a
 * row can read "not finished" (the stream never completed), "interrupted"
 * (some rows reached the browser before an error or a closed tab) or
 * "failed" (nothing was delivered). The status words are the backend's
 * states; this section only labels them.
 *
 * Loaded on its own so a failure here never hides the mappings above it.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { getErrorMessage } from '@/utils/errorHandling';
import { formatDate, formatDateTime, formatNumber } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
import { EmptyState } from '@/components/ux/EmptyState';
import { exportMappingService } from '../services/api';
import type { ExportLog } from '../types';

/** One page of history; older exports are reached with "Show older". */
const PAGE_SIZE = 25;

const HEADER_CELL = 'text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase';
const CELL = 'text-theme-text-primary px-4 py-3 text-sm';

const STATUS_LABELS: Record<string, string> = {
  successful: 'Complete',
  partial: 'Interrupted',
  failed: 'Failed',
  pending: 'Not finished',
};

const STATUS_COLORS: Record<string, string> = {
  successful: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  partial: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
};

const STATUS_HINTS: Record<string, string> = {
  partial:
    'Some transactions reached the browser before it stopped. Run the period again rather than importing this file.',
  failed: 'Nothing was delivered.',
  pending: 'The download never finished. Run the period again.',
};

export const ExportHistorySection: React.FC = () => {
  const tz = useTimezone();
  const [logs, setLogs] = useState<ExportLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadPage = useCallback(async (skip: number) => {
    const page = await exportMappingService.logs({ skip, limit: PAGE_SIZE });
    setHasMore(page.length === PAGE_SIZE);
    return page;
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadPage(0)
      .then((page) => {
        if (!cancelled) setLogs(page);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Could not load the export history.'));
      });
    return () => {
      cancelled = true;
    };
  }, [loadPage]);

  const showOlder = async () => {
    if (!logs) return;
    setLoadingMore(true);
    try {
      const page = await loadPage(logs.length);
      setLogs([...logs, ...page]);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load older exports.'));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section aria-labelledby="export-history-heading" className="space-y-3">
      <h2 id="export-history-heading" className="text-theme-text-primary text-lg font-semibold">
        Export history
      </h2>
      {error && <p className="alert-danger rounded-lg p-4 text-sm">{error}</p>}
      {logs === null ? (
        !error && <p className="text-theme-text-secondary text-sm">Loading export history…</p>
      ) : logs.length === 0 ? (
        <EmptyState
          icon={History}
          title="No exports yet"
          description="Each transactions export is listed here once it has run, with its period, transaction count and whether it finished."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="rwd-table w-full">
              <thead>
                <tr className="border-theme-surface-border border-b">
                  <th scope="col" className={HEADER_CELL}>
                    Exported
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Period
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Transactions
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Status
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    By
                  </th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-theme-surface-border border-b last:border-b-0">
                    <td data-label="Exported" className={`rwd-table-lead ${CELL} font-medium`}>
                      {formatDateTime(log.exportedAt, tz)}
                    </td>
                    <td data-label="Period" className={CELL}>
                      {formatDate(log.dateRangeStart, tz)} – {formatDate(log.dateRangeEnd, tz)}
                    </td>
                    <td data-label="Transactions" className={CELL}>
                      {formatNumber(log.recordCount)}
                    </td>
                    <td data-label="Status" className={CELL}>
                      <span
                        className={`badge ${STATUS_COLORS[log.status] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-300'}`}
                      >
                        {STATUS_LABELS[log.status] ?? log.status}
                      </span>
                      {(log.errorMessage || STATUS_HINTS[log.status]) && (
                        <span className="text-theme-text-secondary mt-1 block text-xs">
                          {log.errorMessage || STATUS_HINTS[log.status]}
                        </span>
                      )}
                    </td>
                    <td data-label="By" className={CELL}>
                      {log.exportedByName || <span className="text-theme-text-secondary">Unknown</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {logs && hasMore && (
        <button type="button" onClick={() => void showOlder()} disabled={loadingMore} className="btn-secondary">
          Show older exports
        </button>
      )}
    </section>
  );
};
