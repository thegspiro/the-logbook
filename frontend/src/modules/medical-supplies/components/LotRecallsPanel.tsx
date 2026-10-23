/**
 * The lots under an active recall, with what of each is still to be pulled.
 *
 * A recall stops the units counting as stock and blocks swapping them onto a
 * truck, so the officer needs to see which recalls are in force and how many
 * units still carry each number. Lifting one (entered in error, or cleared by
 * the manufacturer) asks why, and the recall stays on record with the note.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { medicalSuppliesService } from '../../../services/medicalSuppliesService';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, formatNumber } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { PromptDialog } from '../../../components/ux/PromptDialog';
import { supplyLabel } from '../types';
import type { MedicalLotRecall } from '../types';

interface LotRecallsPanelProps {
  /** Offer Lift. For a viewer who manages medical stock. */
  canManage: boolean;
  /** Changed by the page when a recall may have been added elsewhere. */
  version: number;
  /** After a lift, so the page can reload the stock it restored. */
  onChanged: () => void;
}

const headClass = 'text-theme-text-muted px-4 py-3 text-xs font-semibold uppercase';

export const LotRecallsPanel: React.FC<LotRecallsPanelProps> = ({ canManage, version, onChanged }) => {
  const tz = useTimezone();
  const [recalls, setRecalls] = useState<MedicalLotRecall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lifting, setLifting] = useState<MedicalLotRecall | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      // Past the cache: a recall just recorded must show at once.
      setRecalls(await medicalSuppliesService.getRecalls(false, { bypassCache: true }));
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load the recalled lots'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  const lift = async (note: string) => {
    if (!lifting) return;
    setSaving(true);
    try {
      await medicalSuppliesService.liftRecall(lifting.id, note);
      toast.success(`Recall of lot ${lifting.lot_number} lifted`);
      setLifting(null);
      await load();
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not lift the recall'));
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <p role="alert" className="alert-danger mb-4 text-sm">
        {error}
      </p>
    );
  }
  // Nothing in force: no panel, rather than an empty box on every visit.
  if (recalls.length === 0) return null;

  return (
    <section aria-label="Recalled lots" className="mb-4 space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-400">
        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
        Recalled lots ({formatNumber(recalls.length)})
      </h3>
      <div className="card overflow-x-auto p-0">
        <table className="rwd-table w-full text-sm">
          <thead>
            <tr className="border-theme-surface-border border-b">
              <th className={`${headClass} text-left`}>Item</th>
              <th className={`${headClass} text-left`}>Lot</th>
              <th className={`${headClass} text-left`}>Recalled</th>
              <th className={`${headClass} text-right`}>Still to pull</th>
              {canManage && (
                <th className={`${headClass} text-right`}>
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {recalls.map((recall) => {
              const label = recall.item_name
                ? supplyLabel({ name: recall.item_name, size: recall.item_size })
                : 'Unknown supply';
              return (
                <tr key={recall.id} className="border-theme-surface-border border-b last:border-0">
                  <td data-label="Item" className="text-theme-text-primary px-4 py-3 font-medium">
                    {label}
                    {recall.reason && (
                      <span className="text-theme-text-secondary block text-xs font-normal">{recall.reason}</span>
                    )}
                  </td>
                  <td data-label="Lot" className="text-theme-text-muted px-4 py-3 font-mono text-xs">
                    {recall.lot_number}
                  </td>
                  <td data-label="Recalled" className="text-theme-text-muted px-4 py-3">
                    {recall.recalled_at ? formatDate(recall.recalled_at, tz) : '—'}
                  </td>
                  <td data-label="Still to pull" className="text-theme-text-primary px-4 py-3 text-right tabular-nums">
                    {formatNumber(recall.units_on_shelf)} shelf · {formatNumber(recall.units_aboard)} on trucks
                  </td>
                  {canManage && (
                    <td data-label="Actions" className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setLifting(recall)}
                        aria-label={`Lift the recall of lot ${recall.lot_number} of ${label}`}
                      >
                        Lift
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <PromptDialog
        isOpen={lifting !== null}
        onClose={() => setLifting(null)}
        onSubmit={(note) => void lift(note)}
        title="Lift this recall"
        message={
          lifting && (
            <>
              Units of lot <span className="font-mono">{lifting.lot_number}</span> count as stock again and can be
              swapped onto a truck. The recall stays on record with your note.
            </>
          )
        }
        label="Why is it lifted?"
        placeholder="e.g. entered in error, or cleared by the manufacturer"
        multiline
        confirmLabel="Lift recall"
        loading={saving}
      />
    </section>
  );
};

export default LotRecallsPanel;
