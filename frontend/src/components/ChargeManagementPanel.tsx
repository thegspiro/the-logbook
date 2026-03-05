import React, { useEffect, useState, useCallback } from 'react';
import { DollarSign, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { inventoryService } from '../services/inventoryService';
import type { IssuanceChargeListItem } from '../services/eventServices';
import { getErrorMessage } from '../utils/errorHandling';
import toast from 'react-hot-toast';

const CHARGE_STATUS_BADGES: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  charged: 'bg-red-500/10 text-red-700 dark:text-red-400',
  waived: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
};

function formatCurrency(amount?: number | null): string {
  if (amount == null) return '--';
  return `$${Number(amount).toFixed(2)}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const ChargeManagementPanel: React.FC = () => {
  const [items, setItems] = useState<IssuanceChargeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');
  const [totals, setTotals] = useState({ pending: 0, charged: 0, waived: 0 });
  const [actionModal, setActionModal] = useState<{ open: boolean; item: IssuanceChargeListItem | null; action: string }>({ open: false, item: null, action: '' });
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

  useEffect(() => { void loadCharges(); }, [loadCharges]);

  const handleAction = async () => {
    if (!actionModal.item) return;
    setSubmitting(true);
    try {
      const amount = chargeAmount ? parseFloat(chargeAmount) : undefined;
      await inventoryService.updateIssuanceCharge(
        actionModal.item.issuance_id,
        actionModal.action,
        amount,
      );
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
            <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400">Pending</span>
          </div>
          <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">{formatCurrency(totals.pending)}</p>
        </div>
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-red-600 dark:text-red-400" />
            <span className="text-sm font-medium text-red-700 dark:text-red-400">Charged</span>
          </div>
          <p className="text-2xl font-bold text-red-700 dark:text-red-300">{formatCurrency(totals.charged)}</p>
        </div>
        <div className="bg-gray-500/10 border border-gray-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-400">Waived</span>
          </div>
          <p className="text-2xl font-bold text-gray-700 dark:text-gray-300">{totals.waived}</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <label htmlFor="charge-filter" className="text-sm text-theme-text-secondary">Filter:</label>
        <select
          id="charge-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="form-input text-sm max-w-[200px]"
        >
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="charged">Charged</option>
          <option value="waived">Waived</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-theme-surface rounded-lg p-8 border border-theme-surface-border text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mx-auto" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-theme-surface rounded-lg p-8 border border-theme-surface-border text-center">
          <DollarSign className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <p className="text-theme-text-secondary">No charge records found.</p>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="sm:hidden space-y-3">
            {items.map((item) => (
              <div key={item.issuance_id} className="bg-theme-surface rounded-lg border border-theme-surface-border p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <h4 className="text-sm font-medium text-theme-text-primary">{item.item_name}</h4>
                    <p className="text-xs text-theme-text-muted">{item.user_name}</p>
                  </div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${CHARGE_STATUS_BADGES[item.charge_status] ?? ''}`}>
                    {item.charge_status}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-theme-text-secondary">
                  <span>Qty: {item.quantity_issued}</span>
                  <span>{formatCurrency(item.charge_amount ?? (item.unit_cost_at_issuance ? Number(item.unit_cost_at_issuance) * item.quantity_issued : null))}</span>
                </div>
                {item.charge_status === 'pending' && (
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => openChargeModal(item)} className="flex-1 px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors">
                      Charge
                    </button>
                    <button onClick={() => openWaiveModal(item)} className="flex-1 px-3 py-1.5 text-xs border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg transition-colors">
                      Waive
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden sm:block bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-theme-surface-border bg-theme-surface-secondary">
                  <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Item</th>
                  <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Member</th>
                  <th className="p-3 text-center text-xs font-medium text-theme-text-muted uppercase">Qty</th>
                  <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Condition</th>
                  <th className="p-3 text-right text-xs font-medium text-theme-text-muted uppercase">Amount</th>
                  <th className="p-3 text-center text-xs font-medium text-theme-text-muted uppercase">Status</th>
                  <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Date</th>
                  <th className="p-3 text-center text-xs font-medium text-theme-text-muted uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.issuance_id} className="border-b border-theme-surface-border">
                    <td className="p-3 text-theme-text-primary font-medium">{item.item_name}</td>
                    <td className="p-3 text-theme-text-secondary">{item.user_name}</td>
                    <td className="p-3 text-center text-theme-text-secondary">{item.quantity_issued}</td>
                    <td className="p-3 text-theme-text-secondary capitalize">{item.return_condition?.replace('_', ' ') || '--'}</td>
                    <td className="p-3 text-right text-theme-text-primary font-medium">
                      {formatCurrency(item.charge_amount ?? (item.unit_cost_at_issuance ? Number(item.unit_cost_at_issuance) * item.quantity_issued : null))}
                    </td>
                    <td className="p-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${CHARGE_STATUS_BADGES[item.charge_status] ?? ''}`}>
                        {item.charge_status}
                      </span>
                    </td>
                    <td className="p-3 text-theme-text-muted text-xs">{formatDate(item.issued_at)}</td>
                    <td className="p-3 text-center">
                      {item.charge_status === 'pending' && (
                        <div className="flex items-center justify-center gap-1.5">
                          <button onClick={() => openChargeModal(item)} className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors" title="Apply charge">
                            Charge
                          </button>
                          <button onClick={() => openWaiveModal(item)} className="px-2 py-1 text-xs border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded transition-colors" title="Waive charge">
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
        <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape') setActionModal({ open: false, item: null, action: '' }); }}>
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-black/60" onClick={() => setActionModal({ open: false, item: null, action: '' })} aria-hidden="true" />
            <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full border border-theme-surface-border">
              <div className="px-4 sm:px-6 pt-5 pb-4">
                <div className="flex items-center gap-2 mb-4">
                  {actionModal.action === 'charged' ? (
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                  ) : (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  )}
                  <h3 className="text-lg font-medium text-theme-text-primary">
                    {actionModal.action === 'charged' ? 'Apply Charge' : 'Waive Charge'}
                  </h3>
                </div>
                <div className="space-y-3">
                  <div className="bg-theme-surface-secondary rounded-lg p-3">
                    <p className="text-sm text-theme-text-primary font-medium">{actionModal.item.item_name}</p>
                    <p className="text-xs text-theme-text-muted">{actionModal.item.user_name} — Qty: {actionModal.item.quantity_issued}</p>
                    {actionModal.item.return_condition && (
                      <p className="text-xs text-theme-text-muted capitalize mt-1">Returned in {actionModal.item.return_condition.replace('_', ' ')} condition</p>
                    )}
                  </div>
                  {actionModal.action === 'charged' && (
                    <div>
                      <label htmlFor="charge-amount" className="block text-sm font-medium text-theme-text-secondary mb-1">
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
                        <p className="text-xs text-theme-text-muted mt-1">
                          Replacement cost at issuance: {formatCurrency(Number(actionModal.item.unit_cost_at_issuance) * actionModal.item.quantity_issued)}
                        </p>
                      )}
                    </div>
                  )}
                  {actionModal.action === 'waived' && (
                    <p className="text-sm text-theme-text-secondary">
                      This will waive the charge for this item. No amount will be billed to the member.
                    </p>
                  )}
                </div>
              </div>
              <div className="bg-theme-input-bg px-4 sm:px-6 py-3 flex justify-end gap-3 rounded-b-lg">
                <button onClick={() => setActionModal({ open: false, item: null, action: '' })} className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors">Cancel</button>
                <button
                  onClick={() => { void handleAction(); }}
                  disabled={submitting}
                  className={`px-4 py-2 rounded-lg text-white transition-colors disabled:opacity-50 ${
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
