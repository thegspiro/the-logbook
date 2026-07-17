/**
 * StockLotsPanel
 *
 * Manages the ready-replacement stock lots for a consumable inventory item.
 * Each lot carries its own lot number, expiration date, and on-hand quantity,
 * so a supply officer can keep fresh units ready to swap onto apparatus during
 * equipment checks. Lots nearing (or past) expiration are highlighted.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, AlertTriangle, Loader2, PackagePlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryService } from '@/services/inventoryService';
import type { InventoryLot, InventoryLotCreate } from '@/services/eventServices';
import { getErrorMessage } from '@/utils/errorHandling';
import { formatDate, getTodayLocalDate } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';

interface StockLotsPanelProps {
  itemId: string;
  canManage: boolean;
}

function emptyForm(): InventoryLotCreate {
  return {
    lot_number: '',
    expiration_date: '',
    quantity: 1,
    received_date: '',
    notes: '',
  };
}

const StockLotsPanel: React.FC<StockLotsPanelProps> = ({ itemId, canManage }) => {
  const tz = useTimezone();
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<InventoryLotCreate>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLots(await inventoryService.getItemLots(itemId));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load stock lots'));
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async () => {
    if (form.quantity == null || form.quantity < 0) {
      toast.error('Quantity must be zero or more');
      return;
    }
    setSaving(true);
    try {
      const payload: InventoryLotCreate = {
        lot_number: form.lot_number?.trim() || undefined,
        expiration_date: form.expiration_date || undefined,
        quantity: Number(form.quantity),
        received_date: form.received_date || undefined,
        notes: form.notes?.trim() || undefined,
      };
      const created = await inventoryService.addItemLot(itemId, payload);
      setLots((prev) => [...prev, created]);
      setForm(emptyForm());
      setShowForm(false);
      toast.success('Stock lot added');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to add stock lot'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (lot: InventoryLot) => {
    if (!window.confirm('Delete this stock lot? This cannot be undone.')) return;
    try {
      await inventoryService.deleteItemLot(lot.id);
      setLots((prev) => prev.filter((l) => l.id !== lot.id));
      toast.success('Stock lot deleted');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete stock lot'));
    }
  };

  const adjustQuantity = async (lot: InventoryLot, delta: number) => {
    const next = Math.max(0, lot.quantity + delta);
    if (next === lot.quantity) return;
    // Optimistic update; revert on failure.
    setLots((prev) => prev.map((l) => (l.id === lot.id ? { ...l, quantity: next } : l)));
    try {
      await inventoryService.updateItemLot(lot.id, { quantity: next });
    } catch (err: unknown) {
      setLots((prev) => prev.map((l) => (l.id === lot.id ? { ...l, quantity: lot.quantity } : l)));
      toast.error(getErrorMessage(err, 'Failed to update quantity'));
    }
  };

  const today = getTodayLocalDate(tz);
  const totalReady = lots.reduce((sum, l) => sum + l.quantity, 0);

  const expiryState = (lot: InventoryLot): 'expired' | 'soon' | 'ok' => {
    if (!lot.expiration_date) return 'ok';
    if (lot.expiration_date < today) return 'expired';
    return 'ok';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10" role="status" aria-live="polite">
        <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-theme-text-muted">
          <span className="font-semibold text-theme-text-primary">{totalReady}</span> ready unit
          {totalReady !== 1 ? 's' : ''} across {lots.length} lot{lots.length !== 1 ? 's' : ''}
        </div>
        {canManage && !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="btn-primary btn-sm inline-flex items-center gap-1"
          >
            <Plus className="w-4 h-4" /> Add Lot
          </button>
        )}
      </div>

      {showForm && canManage && (
        <div className="card-secondary p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="form-label">Lot Number</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. LOT-4823"
                value={form.lot_number ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, lot_number: e.target.value }))}
              />
            </div>
            <div>
              <label className="form-label">Quantity</label>
              <input
                type="number"
                min="0"
                className="form-input"
                value={form.quantity}
                onChange={(e) => setForm((p) => ({ ...p, quantity: Number(e.target.value) }))}
              />
            </div>
            <div>
              <label className="form-label">Expiration Date</label>
              <input
                type="date"
                className="form-input"
                value={form.expiration_date ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, expiration_date: e.target.value }))}
              />
            </div>
            <div>
              <label className="form-label">Received Date</label>
              <input
                type="date"
                className="form-input"
                value={form.received_date ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, received_date: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="form-label">Notes</label>
            <input
              type="text"
              className="form-input"
              placeholder="Optional"
              value={form.notes ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleAdd()}
              className="btn-primary btn-sm inline-flex items-center gap-1 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackagePlus className="w-4 h-4" />}
              Save Lot
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setForm(emptyForm()); }}
              className="btn-secondary btn-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {lots.length === 0 ? (
        <div className="rounded-lg border border-dashed border-theme-surface-border p-6 text-center text-sm text-theme-text-muted">
          No ready stock yet. Add a lot to keep fresh units on hand for swaps.
        </div>
      ) : (
        <ul className="space-y-2">
          {lots.map((lot) => {
            const state = expiryState(lot);
            return (
              <li
                key={lot.id}
                className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                  state === 'expired'
                    ? 'border-red-300 bg-red-50 dark:border-red-900/50 dark:bg-red-900/10'
                    : 'border-theme-surface-border bg-theme-surface'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-theme-text-primary">
                      {lot.lot_number || 'No lot #'}
                    </span>
                    {lot.expiration_date && (
                      <span
                        className={`inline-flex items-center gap-1 text-xs ${
                          state === 'expired'
                            ? 'text-red-600 dark:text-red-400 font-medium'
                            : 'text-theme-text-muted'
                        }`}
                      >
                        {state === 'expired' && <AlertTriangle className="w-3 h-3" />}
                        {state === 'expired' ? 'Expired ' : 'Exp '}
                        {formatDate(lot.expiration_date, tz)}
                      </span>
                    )}
                  </div>
                  {lot.notes && (
                    <p className="text-xs text-theme-text-muted mt-0.5 truncate">{lot.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canManage ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="Decrease quantity"
                        onClick={() => void adjustQuantity(lot, -1)}
                        className="btn-icon"
                      >
                        −
                      </button>
                      <span className="w-8 text-center font-semibold text-theme-text-primary">
                        {lot.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label="Increase quantity"
                        onClick={() => void adjustQuantity(lot, 1)}
                        className="btn-icon"
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <span className="font-semibold text-theme-text-primary">{lot.quantity}</span>
                  )}
                  {canManage && (
                    <button
                      type="button"
                      aria-label="Delete lot"
                      onClick={() => void handleDelete(lot)}
                      className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default StockLotsPanel;
