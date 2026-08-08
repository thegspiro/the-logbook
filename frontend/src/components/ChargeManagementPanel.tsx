import React, { useEffect, useState, useCallback } from 'react';
import { DollarSign, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { inventoryService } from '../services/inventoryService';
import type { IssuanceChargeListItem } from '../services/eventServices';
import { getErrorMessage } from '../utils/errorHandling';
import { formatDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { formatCurrency } from '@/utils/currencyFormatting';
import toast from 'react-hot-toast';

const CHARGE_STATUS_BADGES: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  charged: 'bg-red-500/10 text-red-700 dark:text-red-400',
  waived: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
};

const ChargeManagementPanel: React.FC = () => {
  const tz = useTimezone();
  const [items, setItems] = useState<IssuanceChargeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');
  const [totals, setTotals] = useState({ pending: 0, charged: 0, waived: 0 });
  const [actionModal, setActionModal] = useState<{
    open: boolean;
    item: IssuanceChargeListItem | null;
    action: string;
  }>({ open: false, item: null, action: '' });
  const [chargeAmount, setChargeAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadCharges = useCallback(async () => {
    setLoading(true);
    try {
      const data = await inventoryService.getCharges(filter || undefined);
      setItems(data.items);
      setTotals({
        pending: Number(data.total_pending),
        charged: Number(data.total_charged),
        waived: data.total_waived,
      });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load charges'));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void loadCharges();
  }, [loadCharges]);

  const handleAction = async () => {
    if (!actionModal.item) return;
    setSubmitting(true);
    try {
      const amount = chargeAmount ? parseFloat(chargeAmount) : undefined;
      await inventoryService.updateIssuanceCharge(actionModal.item.issuance_id, actionModal.action, amount);
      toast.success(`Charge ${actionModal.action === 'charged' ? 'applied' : 'waived'} successfully`);
      setActionModal({ open: false, item: null, action: '' });
      setChargeAmount('');
      await loadCharges();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update charge'));
    } finally {
      setSubmitting(false);
    }
  };

  const openChargeModal = (item: IssuanceChargeListItem) => {
    setActionModal({ open: true, item, action: 'charged' });
    const defaultAmount = item.unit_cost_at_issuance
      ? (Number(item.unit_cost_at_issuance) * item.quantity_issued).toFixed(2)
      : '';
    setChargeAmount(defaultAmount);
  };

  const openWaiveModal = (item: IssuanceChargeListItem) => {
    setActionModal({ open: true, item, action: 'waived' });
    setChargeAmount('');
  };

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
          <div className="mb-1 flex items-center gap-2">
            <Clock className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
            <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400">Pending</span>
          </div>
          <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">{formatCurrency(totals.pending)}</p>
        </div>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <div className="mb-1 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-red-600 dark:text-red-400" />
            <span className="text-sm font-medium text-red-700 dark:text-red-400">Charged</span>
          </div>
          <p className="text-2xl font-bold text-red-700 dark:text-red-300">{formatCurrency(totals.charged)}</p>
        </div>
        <div className="rounded-lg border border-gray-500/30 bg-gray-500/10 p-4">
          <div className="mb-1 flex items-center gap-2">
            <XCircle className="h-4 w-4 text-gray-600 dark:text-gray-400" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-400">Waived</span>
          </div>
          <p className="text-2xl font-bold text-gray-700 dark:text-gray-300">{totals.waived}</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <label htmlFor="charge-filter" className="text-theme-text-secondary text-sm">
          Filter:
        </label>
        <select
          id="charge-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="form-input max-w-[200px] text-sm"
        >
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="charged">Charged</option>
          <option value="waived">Waived</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-8 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-emerald-500" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-8 text-center">
          <DollarSign className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <p className="text-theme-text-secondary">No charge records found.</p>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-3 sm:hidden">
            {items.map((item) => (
              <div
                key={item.issuance_id}
                className="bg-theme-surface border-theme-surface-border rounded-lg border p-4"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <h4 className="text-theme-text-primary text-sm font-medium">{item.item_name}</h4>
                    <p className="text-theme-text-muted text-xs">{item.user_name}</p>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CHARGE_STATUS_BADGES[item.charge_status] ?? ''}`}
                  >
                    {item.charge_status}
                  </span>
                </div>
                <div className="text-theme-text-secondary flex items-center justify-between text-xs">
                  <span>Qty: {item.quantity_issued}</span>
                  <span>
                    {formatCurrency(
                      item.charge_amount ??
                        (item.unit_cost_at_issuance ? Number(item.unit_cost_at_issuance) * item.quantity_issued : null)
                    )}
                  </span>
                </div>
                {item.charge_status === 'pending' && (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => openChargeModal(item)}
                      className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-red-700"
                    >
                      Charge
                    </button>
                    <button
                      onClick={() => openWaiveModal(item)}
                      className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover flex-1 rounded-lg border px-3 py-1.5 text-xs transition-colors"
                    >
                      Waive
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="bg-theme-surface border-theme-surface-border hidden overflow-hidden overflow-x-auto rounded-lg border sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-theme-surface-border bg-theme-surface-secondary border-b">
                  <th scope="col" className="text-theme-text-muted p-3 text-left text-xs font-medium uppercase">
                    Item
                  </th>
                  <th scope="col" className="text-theme-text-muted p-3 text-left text-xs font-medium uppercase">
                    Member
                  </th>
                  <th scope="col" className="text-theme-text-muted p-3 text-center text-xs font-medium uppercase">
                    Qty
                  </th>
                  <th scope="col" className="text-theme-text-muted p-3 text-left text-xs font-medium uppercase">
                    Condition
                  </th>
                  <th scope="col" className="text-theme-text-muted p-3 text-right text-xs font-medium uppercase">
                    Amount
                  </th>
                  <th scope="col" className="text-theme-text-muted p-3 text-center text-xs font-medium uppercase">
                    Status
                  </th>
                  <th scope="col" className="text-theme-text-muted p-3 text-left text-xs font-medium uppercase">
                    Date
                  </th>
                  <th scope="col" className="text-theme-text-muted p-3 text-center text-xs font-medium uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.issuance_id} className="border-theme-surface-border border-b">
                    <td className="text-theme-text-primary p-3 font-medium">{item.item_name}</td>
                    <td className="text-theme-text-secondary p-3">{item.user_name}</td>
                    <td className="text-theme-text-secondary p-3 text-center">{item.quantity_issued}</td>
                    <td className="text-theme-text-secondary p-3 capitalize">
                      {item.return_condition?.replace('_', ' ') || '--'}
                    </td>
                    <td className="text-theme-text-primary p-3 text-right font-medium">
                      {formatCurrency(
                        item.charge_amount ??
                          (item.unit_cost_at_issuance
                            ? Number(item.unit_cost_at_issuance) * item.quantity_issued
                            : null)
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CHARGE_STATUS_BADGES[item.charge_status] ?? ''}`}
                      >
                        {item.charge_status}
                      </span>
                    </td>
                    <td className="text-theme-text-muted p-3 text-xs">{formatDate(item.issued_at, tz)}</td>
                    <td className="p-3 text-center">
                      {item.charge_status === 'pending' && (
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => openChargeModal(item)}
                            className="rounded bg-red-600 px-2 py-1 text-xs text-white transition-colors hover:bg-red-700"
                            title="Apply charge"
                          >
                            Charge
                          </button>
                          <button
                            onClick={() => openWaiveModal(item)}
                            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded border px-2 py-1 text-xs transition-colors"
                            title="Waive charge"
                          >
                            Waive
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Charge/Waive Modal */}
      {actionModal.open && actionModal.item && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setActionModal({ open: false, item: null, action: '' });
          }}
        >
          <div className="flex min-h-screen items-center justify-center px-4">
            <div
              className="fixed inset-0 bg-black/60"
              onClick={() => setActionModal({ open: false, item: null, action: '' })}
              aria-hidden="true"
            />
            <div className="bg-theme-surface-modal border-theme-surface-border relative w-full max-w-md rounded-lg border shadow-xl">
              <div className="px-4 pt-5 pb-4 sm:px-6">
                <div className="mb-4 flex items-center gap-2">
                  {actionModal.action === 'charged' ? (
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                  ) : (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  )}
                  <h3 className="text-theme-text-primary text-lg font-medium">
                    {actionModal.action === 'charged' ? 'Apply Charge' : 'Waive Charge'}
                  </h3>
                </div>
                <div className="space-y-3">
                  <div className="bg-theme-surface-secondary rounded-lg p-3">
                    <p className="text-theme-text-primary text-sm font-medium">{actionModal.item.item_name}</p>
                    <p className="text-theme-text-muted text-xs">
                      {actionModal.item.user_name} — Qty: {actionModal.item.quantity_issued}
                    </p>
                    {actionModal.item.return_condition && (
                      <p className="text-theme-text-muted mt-1 text-xs capitalize">
                        Returned in {actionModal.item.return_condition.replace('_', ' ')} condition
                      </p>
                    )}
                  </div>
                  {actionModal.action === 'charged' && (
                    <div>
                      <label
                        htmlFor="charge-amount"
                        className="text-theme-text-secondary mb-1 block text-sm font-medium"
                      >
                        Charge Amount ($)
                      </label>
                      <input
                        id="charge-amount"
                        type="number"
                        min="0"
                        step="0.01"
                        value={chargeAmount}
                        onChange={(e) => setChargeAmount(e.target.value)}
                        className="form-input"
                        placeholder="0.00"
                      />
                      {actionModal.item.unit_cost_at_issuance && (
                        <p className="text-theme-text-muted mt-1 text-xs">
                          Replacement cost at issuance:{' '}
                          {formatCurrency(
                            Number(actionModal.item.unit_cost_at_issuance) * actionModal.item.quantity_issued
                          )}
                        </p>
                      )}
                    </div>
                  )}
                  {actionModal.action === 'waived' && (
                    <p className="text-theme-text-secondary text-sm">
                      This will waive the charge for this item. No amount will be billed to the member.
                    </p>
                  )}
                </div>
              </div>
              <div className="bg-theme-input-bg flex justify-end gap-3 rounded-b-lg px-4 py-3 sm:px-6">
                <button
                  onClick={() => setActionModal({ open: false, item: null, action: '' })}
                  className="border-theme-input-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    void handleAction();
                  }}
                  disabled={submitting}
                  className={`rounded-lg px-4 py-2 text-white transition-colors disabled:opacity-50 ${
                    actionModal.action === 'charged' ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-600 hover:bg-gray-700'
                  }`}
                >
                  {submitting ? 'Processing...' : actionModal.action === 'charged' ? 'Apply Charge' : 'Waive Charge'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChargeManagementPanel;
