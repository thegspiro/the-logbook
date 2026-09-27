/**
 * Not Seen report — `/inventory/admin/not-seen`.
 *
 * Active items nobody has handled in a chosen number of days. "Seen" is the
 * backend's definition (`inventory_last_seen_service.py`), not re-derived here
 * (CLAUDE.md pitfall #29): the latest staff NFC tap, assignment or return,
 * checkout or check-in, or pool issuance or return. Edits to an item's record
 * do not count.
 *
 * Works whether or not NFC tags are switched on — custody events alone make it
 * useful — and says so, because a department without tags will otherwise
 * wonder why a tag-looking report appeared.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, Download, EyeOff, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryService } from '../../../services/api';
import { useTimezone } from '../../../hooks/useTimezone';
import { Breadcrumbs } from '../../../components/ux';
import { formatDateTime, getTodayLocalDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { getStatusLabel, type InventoryCategory } from '../types';
import type { LastSeenSource, NotSeenReport } from '../types/nfc';

const DAY_OPTIONS = [30, 90, 180, 365] as const;
const DEFAULT_DAYS = 180;
const ROWS_SHOWN = 500;

const SOURCE_LABELS: Record<LastSeenSource, string> = {
  nfc_tap: 'NFC tap',
  assignment: 'Assigned',
  return: 'Returned',
  checkout: 'Checked out',
  check_in: 'Checked in',
  issuance: 'Issued',
  issuance_return: 'Issuance returned',
};

export const InventoryNotSeenPage: React.FC = () => {
  const tz = useTimezone();
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [categoryId, setCategoryId] = useState('');
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [report, setReport] = useState<NotSeenReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    inventoryService
      .getCategories()
      .then(setCategories)
      .catch(() => {
        // The filter is optional; the report works without it.
      });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(
        await inventoryService.getNotSeenReport({
          days,
          category_id: categoryId || undefined,
          limit: ROWS_SHOWN,
        })
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load the report.'));
    } finally {
      setLoading(false);
    }
  }, [days, categoryId]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await inventoryService.exportNotSeenReport({ days, category_id: categoryId || undefined });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inventory-not-seen-${days}d-${getTodayLocalDate(tz)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('CSV exported');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not export the report.'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6">
      <Breadcrumbs />

      <header>
        <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <EyeOff className="h-5 w-5" /> Items Not Seen
        </h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Items nobody has tapped, assigned, returned, checked out, checked in or issued lately. Editing an item’s
          record does not count as seeing it. Retired items are left out.
        </p>
      </header>

      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div>
          <label className="form-label" htmlFor="not-seen-days">
            Not seen in
          </label>
          <select
            id="not-seen-days"
            className="form-input"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="form-label" htmlFor="not-seen-category">
            Category
          </label>
          <select
            id="not-seen-category"
            className="form-input"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void exportCsv()}
          disabled={exporting || loading || !report || report.total === 0}
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="h-4 w-4" aria-hidden="true" />
          )}
          Download CSV
        </button>
      </div>

      {error && (
        <div className="alert-danger flex items-start gap-2" role="alert">
          <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-theme-alert-danger-text text-sm">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-label="Loading" />
        </div>
      ) : report ? (
        <section className="card p-4" aria-labelledby="not-seen-results">
          <h2 id="not-seen-results" className="text-theme-text-primary mb-3 text-sm font-semibold">
            {report.total === 0
              ? `Every active item has been seen in the last ${days} days.`
              : `${report.total} item(s) not seen since ${formatDateTime(report.cutoff, tz)}${
                  report.total > report.items.length
                    ? ` — first ${report.items.length} shown; the CSV has them all`
                    : ''
                }`}
          </h2>
          {report.items.length > 0 && (
            <table className="rwd-table w-full text-sm">
              <thead>
                <tr className="text-theme-text-secondary text-left">
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Storage area</th>
                  <th className="py-2 pr-3">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-theme-surface-border divide-y">
                {report.items.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Item" className="py-2 pr-3">
                      <Link to={`/inventory/items/${row.id}`} className="text-theme-text-primary font-medium">
                        {row.name}
                      </Link>
                      <span className="text-theme-text-secondary block text-xs">
                        {[row.serial_number && `S/N ${row.serial_number}`, row.category_name]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </td>
                    <td data-label="Status" className="text-theme-text-primary py-2 pr-3">
                      {getStatusLabel(row.status)}
                    </td>
                    <td data-label="Storage area" className="text-theme-text-primary py-2 pr-3">
                      {row.storage_area_name ?? '—'}
                    </td>
                    <td data-label="Last seen" className="text-theme-text-primary py-2 pr-3">
                      {row.last_seen_at ? (
                        <>
                          {formatDateTime(row.last_seen_at, tz)}
                          <span className="text-theme-text-secondary block text-xs">
                            {row.last_seen_source ? SOURCE_LABELS[row.last_seen_source] : ''}
                            {row.days_since_seen !== null ? ` · ${row.days_since_seen} days ago` : ''}
                          </span>
                        </>
                      ) : (
                        'Never'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
    </div>
  );
};

export default InventoryNotSeenPage;
