/**
 * The recall lookup: every unit of a lot, on the shelves and the apparatus.
 *
 * A manufacturer's recall names a lot number, and the question is where every
 * unit of it is right now. The search is a substring and case-insensitive
 * (done by the server), because a notice and a label rarely agree on case or
 * on a leading prefix.
 */

import React, { useState } from 'react';
import { ScanSearch } from 'lucide-react';
import { medicalSuppliesService } from '../../../services/medicalSuppliesService';
import { formatNumber } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { StockRowsTable } from './StockRowsTable';
import type { MedicalExpiringStockRow } from '../types';

/** The server refuses shorter: one character matches nearly every lot. */
const MIN_LENGTH = 2;

interface Result {
  query: string;
  rows: MedicalExpiringStockRow[];
}

interface LotRecallSearchProps {
  /** Passed to the results table: link truck rows to that apparatus's inventory. */
  linkToApparatus?: boolean;
}

export const LotRecallSearch: React.FC<LotRecallSearchProps> = ({ linkToApparatus = false }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = text.trim();
    if (query.length < MIN_LENGTH) {
      setError(`Enter at least ${MIN_LENGTH} characters of the lot number.`);
      return;
    }
    // One search at a time: the button is disabled while one runs, so a slow
    // answer can never land over a newer one.
    setBusy(true);
    setError(null);
    try {
      setResult({ query, rows: await medicalSuppliesService.searchLots(query) });
    } catch (err: unknown) {
      setResult(null);
      setError(getErrorMessage(err, 'The lot search failed'));
    } finally {
      setBusy(false);
    }
  };

  const units = result?.rows.reduce((sum, row) => sum + row.quantity, 0) ?? 0;

  return (
    <section aria-label="Lot lookup" className="mb-4 space-y-3">
      <form onSubmit={(e) => void search(e)} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <label htmlFor="lot-recall-input" className="form-label">
            Find a lot
          </label>
          <input
            id="lot-recall-input"
            type="search"
            className="form-input w-full font-mono"
            value={text}
            maxLength={100}
            onChange={(e) => setText(e.target.value)}
            placeholder="Lot number, e.g. from a recall notice"
            aria-describedby="lot-recall-hint"
          />
        </div>
        <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={busy}>
          <ScanSearch className="h-4 w-4" aria-hidden="true" />
          {busy ? 'Searching…' : 'Find'}
        </button>
        <p id="lot-recall-hint" className="text-theme-text-muted w-full text-xs">
          Searches the shelves and every apparatus checklist, in date or not.
        </p>
      </form>

      {error && (
        <p role="alert" className="alert-danger text-sm">
          {error}
        </p>
      )}

      {result && (
        <div aria-live="polite" className="space-y-2">
          {result.rows.length === 0 ? (
            <p className="text-theme-text-secondary text-sm">
              No stock with a lot number containing <span className="font-mono">{result.query}</span> on the shelves or
              the apparatus.
            </p>
          ) : (
            <>
              <p className="text-theme-text-secondary text-sm">
                {formatNumber(units)} unit{units === 1 ? '' : 's'} in {formatNumber(result.rows.length)} place
                {result.rows.length === 1 ? '' : 's'} with a lot number containing{' '}
                <span className="font-mono">{result.query}</span>.
              </p>
              <StockRowsTable rows={result.rows} linkToApparatus={linkToApparatus} />
            </>
          )}
        </div>
      )}
    </section>
  );
};

export default LotRecallSearch;
