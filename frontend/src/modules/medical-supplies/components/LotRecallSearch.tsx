/**
 * The recall lookup: every unit of a lot, on the shelves and the apparatus.
 *
 * A manufacturer's recall names a lot number, and the question is where every
 * unit of it is right now. The search is a substring and case-insensitive
 * (done by the server), because a notice and a label rarely agree on case or
 * on a leading prefix.
 */

import React, { useMemo, useState } from 'react';
import { ShieldAlert, ScanSearch } from 'lucide-react';
import toast from 'react-hot-toast';
import { medicalSuppliesService } from '../../../services/medicalSuppliesService';
import { formatNumber } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { PromptDialog } from '../../../components/ux/PromptDialog';
import { StockRowsTable } from './StockRowsTable';
import { supplyLabel } from '../types';
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
  /** Offer to record a recall of a lot found. For a viewer who manages medical stock. */
  canRecall?: boolean;
  /** After a recall is recorded, so the page can reload what it changed. */
  onRecalled?: () => void;
}

/** A lot the results hold, once per supply: what a recall is recorded against. */
interface FoundLot {
  key: string;
  itemId: string;
  itemLabel: string;
  lotNumber: string;
}

export const LotRecallSearch: React.FC<LotRecallSearchProps> = ({
  linkToApparatus = false,
  canRecall = false,
  onRecalled,
}) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [recalling, setRecalling] = useState<FoundLot | null>(null);
  const [saving, setSaving] = useState(false);

  // One entry per supply and lot number, compared as the server compares
  // them, leaving out lots already recalled.
  const recallable = useMemo<FoundLot[]>(() => {
    const found = new Map<string, FoundLot>();
    for (const row of result?.rows ?? []) {
      const lotNumber = row.lot_number?.trim();
      if (!lotNumber || row.recalled) continue;
      const key = `${row.inventory_item_id}\u0000${lotNumber.toLowerCase()}`;
      if (!found.has(key)) {
        found.set(key, {
          key,
          itemId: row.inventory_item_id,
          itemLabel: row.item_name ? supplyLabel({ name: row.item_name, size: row.item_size }) : 'this supply',
          lotNumber,
        });
      }
    }
    return [...found.values()];
  }, [result]);

  const recordRecall = async (reason: string) => {
    if (!recalling || !result) return;
    setSaving(true);
    try {
      await medicalSuppliesService.recordRecall({
        inventory_item_id: recalling.itemId,
        lot_number: recalling.lotNumber,
        reason: reason || undefined,
      });
      toast.success(`Lot ${recalling.lotNumber} of ${recalling.itemLabel} recalled`);
      setRecalling(null);
      // The rows on screen now carry the wrong flag; read them again.
      setResult({ query: result.query, rows: await medicalSuppliesService.searchLots(result.query) });
      onRecalled?.();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not record the recall'));
    } finally {
      setSaving(false);
    }
  };

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
              {canRecall && recallable.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {recallable.map((lot) => (
                    <button
                      key={lot.key}
                      type="button"
                      className="mobile-touch-target inline-flex items-center gap-2 rounded-md border border-red-700 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-950"
                      onClick={() => setRecalling(lot)}
                    >
                      <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                      Recall lot {lot.lotNumber} of {lot.itemLabel}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <PromptDialog
        isOpen={recalling !== null}
        onClose={() => setRecalling(null)}
        onSubmit={(reason) => void recordRecall(reason)}
        title="Recall this lot"
        message={
          recalling && (
            <>
              Every unit of lot <span className="font-mono">{recalling.lotNumber}</span> of {recalling.itemLabel}, on
              the shelves and the apparatus, stops counting as stock and cannot be swapped onto a truck until the recall
              is lifted.
            </>
          )
        }
        label="Reason"
        placeholder="e.g. the manufacturer's notice number"
        required={false}
        multiline
        confirmLabel="Recall lot"
        confirmVariant="warning"
        loading={saving}
      />
    </section>
  );
};

export default LotRecallSearch;
