/**
 * Every tap of a member ID card at a station or a room kiosk, refusals
 * included — "my card didn't work at the meeting" is the question this
 * answers, so a refused tap is as much a row as a check-in.
 *
 * Dates are picked in the department's timezone and sent as UTC instants: the
 * "to" day is inclusive on screen, so its end is the start of the next day,
 * which the server treats as exclusive.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, Download, History, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { EmptyState } from '../../../../components/ux/EmptyState';
import { Pagination } from '../../../../components/ux/Pagination';
import { useTimezone } from '../../../../hooks/useTimezone';
import { addCalendarDays, formatDateTime, localToUTC } from '../../../../utils/dateFormatting';
import { getErrorMessage } from '../../../../utils/errorHandling';
import { saveBlob } from '../../../../utils/saveBlob';
import { NfcCheckInStatus, NfcTapSource } from '../../../../constants/enums';
import {
  NFC_TAP_OUTCOME_LABELS,
  NFC_TAP_SOURCE_LABELS,
  NFC_TAP_TONE_COLORS,
  checkInResultTone,
} from '../../constants/idCards';
import { nfcCardService } from '../../services/nfcCardService';
import type { NfcCardTap, NfcCardTapFilters } from '../../types/idCard';

const PAGE_SIZE = 50;

/** A card or member the log is narrowed to, with the name to show for it. */
export interface TapLogScope {
  tagId?: string | undefined;
  userId?: string | undefined;
  label: string;
}

interface TapLogTabProps {
  scope: TapLogScope | null;
  onClearScope: () => void;
}

export const TapLogTab: React.FC<TapLogTabProps> = ({ scope, onClearScope }) => {
  const tz = useTimezone();
  const [outcome, setOutcome] = useState<NfcCheckInStatus | ''>('');
  const [source, setSource] = useState<NfcTapSource | ''>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [taps, setTaps] = useState<NfcCardTap[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // A filter change fires a load for the old page and then one for page 1;
  // only the latest request's answer may reach the table.
  const requestSeq = useRef(0);

  const filters = useCallback(
    (): NfcCardTapFilters => ({
      tagId: scope?.tagId,
      userId: scope?.userId,
      outcome: outcome || undefined,
      source: source || undefined,
      since: fromDate ? localToUTC(`${fromDate}T00:00`, tz) || undefined : undefined,
      until: toDate ? localToUTC(`${addCalendarDays(toDate, 1)}T00:00`, tz) || undefined : undefined,
    }),
    [scope, outcome, source, fromDate, toDate, tz]
  );

  // A changed filter starts again from the first page.
  useEffect(() => {
    setPage(1);
  }, [scope, outcome, source, fromDate, toDate]);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      setLoading(true);
      setError(null);
      const data = await nfcCardService.listTaps(filters(), PAGE_SIZE, (page - 1) * PAGE_SIZE);
      if (seq !== requestSeq.current) return;
      setTaps(data.items);
      setTotal(data.total);
    } catch (err: unknown) {
      if (seq !== requestSeq.current) return;
      setError(getErrorMessage(err, 'Unable to load the tap log'));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleExport = async () => {
    setExporting(true);
    try {
      saveBlob(await nfcCardService.exportTaps(filters()), 'id-card-taps.csv');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to export the tap log'));
    } finally {
      setExporting(false);
    }
  };

  const cardText = (tap: NfcCardTap): string => {
    if (tap.cardUidPreview) return `${tap.cardLabel || 'ID card'} …${tap.cardUidPreview}`;
    if (tap.unknownCardKey) return `Unknown card ${tap.unknownCardKey}`;
    return '—';
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        {scope && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-theme-text-secondary text-sm">Showing taps for</span>
            <span className="badge bg-theme-surface-secondary text-theme-text-primary inline-flex items-center gap-1">
              {scope.label}
              <button
                type="button"
                className="btn-icon"
                aria-label={`Stop filtering by ${scope.label}`}
                onClick={onClearScope}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </span>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="tap-outcome" className="form-label">
              Outcome
            </label>
            <select
              id="tap-outcome"
              className="form-input"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as NfcCheckInStatus | '')}
            >
              <option value="">All outcomes</option>
              {Object.values(NfcCheckInStatus).map((value) => (
                <option key={value} value={value}>
                  {NFC_TAP_OUTCOME_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="tap-source" className="form-label">
              Reader
            </label>
            <select
              id="tap-source"
              className="form-input"
              value={source}
              onChange={(e) => setSource(e.target.value as NfcTapSource | '')}
            >
              <option value="">All readers</option>
              {Object.values(NfcTapSource).map((value) => (
                <option key={value} value={value}>
                  {NFC_TAP_SOURCE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="tap-from" className="form-label">
              From
            </label>
            <input
              id="tap-from"
              type="date"
              className="form-input"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="tap-to" className="form-label">
              To
            </label>
            <input
              id="tap-to"
              type="date"
              className="form-input"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-secondary btn-auto inline-flex items-center gap-1.5"
            disabled={exporting || total === 0}
            onClick={() => void handleExport()}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert-danger flex items-start gap-2">
          <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-theme-alert-danger-text text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && taps.length === 0 && (
        <div className="card p-4">
          <EmptyState
            headingLevel={3}
            icon={History}
            title="No taps match"
            description="Taps are recorded from when this page was introduced, and kept for the period set under Settings."
          />
        </div>
      )}

      {taps.length > 0 && (
        <div className="card overflow-hidden">
          <table className="rwd-table w-full text-sm">
            <thead>
              <tr className="text-theme-text-secondary text-left">
                <th className="p-3">Time</th>
                <th className="p-3">Outcome</th>
                <th className="p-3">Member</th>
                <th className="p-3">Card</th>
                <th className="p-3">Where</th>
                <th className="p-3">Checked into</th>
              </tr>
            </thead>
            <tbody className="divide-theme-surface-border divide-y">
              {taps.map((tap) => (
                <tr key={tap.id}>
                  <td className="text-theme-text-secondary p-3 whitespace-nowrap" data-label="Time">
                    {formatDateTime(tap.tappedAt, tz)}
                  </td>
                  <td className="p-3" data-label="Outcome">
                    <span className={`badge ${NFC_TAP_TONE_COLORS[checkInResultTone(tap.outcome)]}`}>
                      {NFC_TAP_OUTCOME_LABELS[tap.outcome]}
                    </span>
                  </td>
                  <td className="p-3" data-label="Member">
                    {tap.userId && tap.memberName ? (
                      <Link to={`/members/${tap.userId}`} className="text-theme-text-primary hover:underline">
                        {tap.memberName}
                      </Link>
                    ) : (
                      <span className="text-theme-text-muted">—</span>
                    )}
                  </td>
                  <td className="text-theme-text-secondary p-3" data-label="Card">
                    <span className="font-mono">{cardText(tap)}</span>
                  </td>
                  <td className="text-theme-text-secondary p-3" data-label="Where">
                    {NFC_TAP_SOURCE_LABELS[tap.source]}
                    {tap.locationName ? ` · ${tap.locationName}` : ''}
                    {tap.operatorName ? ` · run by ${tap.operatorName}` : ''}
                  </td>
                  <td className="text-theme-text-secondary p-3" data-label="Checked into">
                    {tap.targetName || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <Pagination currentPage={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
      )}
    </div>
  );
};
