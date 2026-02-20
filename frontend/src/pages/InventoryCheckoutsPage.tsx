/**
 * Inventory Checkouts Page
 *
 * Displays active and overdue inventory checkouts with check-in capability.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  Package,
  AlertTriangle,
  RefreshCw,
  ArrowDownToLine,
  Clock,
  Search,
} from 'lucide-react';
import { inventoryService } from '../services/api';
import type { UserCheckoutItem } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';

type TabView = 'active' | 'overdue';

interface CheckInModalState {
  open: boolean;
  checkoutId: string;
  itemName: string;
}

export const InventoryCheckoutsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabView>('active');
  const [activeCheckouts, setActiveCheckouts] = useState<UserCheckoutItem[]>([]);
  const [overdueCheckouts, setOverdueCheckouts] = useState<UserCheckoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [checkInModal, setCheckInModal] = useState<CheckInModalState>({ open: false, checkoutId: '', itemName: '' });
  const [returnCondition, setReturnCondition] = useState('good');
  const [damageNotes, setDamageNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchCheckouts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [activeData, overdueData] = await Promise.all([
        inventoryService.getActiveCheckouts(),
        inventoryService.getOverdueCheckouts(),
      ]);
      setActiveCheckouts(activeData.checkouts || []);
      setOverdueCheckouts(overdueData.checkouts || []);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load checkouts'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCheckouts();
  }, [fetchCheckouts]);

  const handleCheckIn = async () => {
    if (!checkInModal.checkoutId) return;
    setSubmitting(true);
    try {
      await inventoryService.checkInItem(checkInModal.checkoutId, returnCondition, damageNotes || undefined);
      toast.success(`${checkInModal.itemName} checked in successfully`);
      setCheckInModal({ open: false, checkoutId: '', itemName: '' });
      setReturnCondition('good');
      setDamageNotes('');
      await fetchCheckouts();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to check in item'));
    } finally {
      setSubmitting(false);
    }
  };

  const openCheckInModal = (checkoutId: string, itemName: string) => {
    setCheckInModal({ open: true, checkoutId, itemName });
    setReturnCondition('good');
    setDamageNotes('');
  };

  const currentList = activeTab === 'active' ? activeCheckouts : overdueCheckouts;
  const filteredList = searchQuery.trim()
    ? currentList.filter(
        (c) =>
          c.item_name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : currentList;

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4" role="status">
          <RefreshCw className="w-10 h-10 text-theme-text-muted animate-spin" aria-hidden="true" />
          <p className="text-theme-text-secondary text-sm">Loading checkouts...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-600 rounded-lg p-2">
              <Package className="w-6 h-6 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-2xl font-bold">Inventory Checkouts</h1>
              <p className="text-theme-text-secondary text-sm">
                Manage active and overdue equipment checkouts
              </p>
            </div>
          </div>
          <button
            onClick={fetchCheckouts}
            className="flex items-center space-x-2 px-4 py-2 bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary rounded-lg border border-theme-surface-border transition-colors"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
            <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-theme-surface-border mb-6" role="tablist" aria-label="Checkout views">
          <button
            onClick={() => setActiveTab('active')}
            role="tab"
            aria-selected={activeTab === 'active'}
            className={`px-4 py-3 text-sm font-medium flex items-center gap-2 ${
              activeTab === 'active'
                ? 'text-blue-700 dark:text-blue-400 border-b-2 border-blue-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <Clock className="w-4 h-4" aria-hidden="true" />
            Active Checkouts
            {activeCheckouts.length > 0 && (
              <span className="ml-1 px-2 py-0.5 text-xs rounded-full bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
                {activeCheckouts.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('overdue')}
            role="tab"
            aria-selected={activeTab === 'overdue'}
            className={`px-4 py-3 text-sm font-medium flex items-center gap-2 ${
              activeTab === 'overdue'
                ? 'text-red-700 dark:text-red-400 border-b-2 border-red-500'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <AlertTriangle className="w-4 h-4" aria-hidden="true" />
            Overdue
            {overdueCheckouts.length > 0 && (
              <span className="ml-1 px-2 py-0.5 text-xs rounded-full bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400">
                {overdueCheckouts.length}
              </span>
            )}
          </button>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-theme-text-muted" aria-hidden="true" />
            <label htmlFor="checkout-search" className="sr-only">Search checkouts</label>
            <input
              id="checkout-search"
              type="text"
              placeholder="Search by item name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Content */}
        <div role="tabpanel">
          {filteredList.length === 0 ? (
            <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-8 text-center">
              <Package className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-theme-text-primary mb-2">
                {activeTab === 'active' ? 'No Active Checkouts' : 'No Overdue Checkouts'}
              </h3>
              <p className="text-theme-text-muted">
                {activeTab === 'active'
                  ? 'There are no items currently checked out.'
                  : 'All checked out items are within their expected return dates.'}
              </p>
            </div>
          ) : (
            <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-theme-surface-border bg-theme-surface">
                      <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Item Name</th>
                      <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Checkout Date</th>
                      <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Due Date</th>
                      <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Status</th>
                      <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredList.map((checkout) => (
                      <tr
                        key={checkout.checkout_id}
                        className={`border-b border-theme-surface-border hover:bg-theme-surface-hover ${
                          checkout.is_overdue ? 'bg-red-500/5' : ''
                        }`}
                      >
                        <td className="p-3">
                          <p className="text-theme-text-primary font-medium">{checkout.item_name}</p>
                        </td>
                        <td className="p-3 text-theme-text-secondary">
                          {formatDate(checkout.checked_out_at)}
                        </td>
                        <td className="p-3 text-theme-text-secondary">
                          {checkout.expected_return_at
                            ? formatDate(checkout.expected_return_at)
                            : '--'}
                        </td>
                        <td className="p-3">
                          {checkout.is_overdue ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400">
                              Overdue
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400">
                              Active
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          <button
                            onClick={() => openCheckInModal(checkout.checkout_id, checkout.item_name)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors"
                          >
                            <ArrowDownToLine className="w-3.5 h-3.5" aria-hidden="true" />
                            Check In
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-3 border-t border-theme-surface-border text-xs text-theme-text-muted">
                {filteredList.length} checkout{filteredList.length !== 1 ? 's' : ''}
              </div>
            </div>
          )}
        </div>

        {/* Check In Modal */}
        {checkInModal.open && (
          <div
            className="fixed inset-0 z-50 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkin-modal-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setCheckInModal({ open: false, checkoutId: '', itemName: '' });
            }}
          >
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full border border-theme-surface-border">
                <div className="px-6 pt-5 pb-4">
                  <h3 id="checkin-modal-title" className="text-lg font-medium text-theme-text-primary mb-4">
                    Check In: {checkInModal.itemName}
                  </h3>

                  <div className="space-y-4">
                    <div>
                      <label htmlFor="return-condition" className="block text-sm font-medium text-theme-text-primary mb-1">
                        Return Condition <span aria-hidden="true">*</span>
                      </label>
                      <select
                        id="return-condition"
                        value={returnCondition}
                        onChange={(e) => setReturnCondition(e.target.value)}
                        className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="new">New</option>
                        <option value="good">Good</option>
                        <option value="fair">Fair</option>
                        <option value="poor">Poor</option>
                        <option value="damaged">Damaged</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="damage-notes" className="block text-sm font-medium text-theme-text-primary mb-1">
                        Damage Notes (optional)
                      </label>
                      <textarea
                        id="damage-notes"
                        rows={3}
                        value={damageNotes}
                        onChange={(e) => setDamageNotes(e.target.value)}
                        placeholder="Describe any damage or issues..."
                        className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-theme-input-bg px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                  <button
                    onClick={() => setCheckInModal({ open: false, checkoutId: '', itemName: '' })}
                    className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCheckIn}
                    disabled={submitting}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 inline-flex items-center space-x-2"
                  >
                    {submitting && <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />}
                    <span>{submitting ? 'Checking In...' : 'Check In'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InventoryCheckoutsPage;
