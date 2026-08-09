/**
 * Inventory Checkouts Page
 *
 * Displays active and overdue inventory checkouts with check-in capability.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Package, AlertTriangle, RefreshCw, ArrowDownToLine, Clock, Search, CalendarClock } from 'lucide-react';
import { inventoryService } from '../services/api';
import type { UserCheckoutItem } from '../services/api';
import { MobileCheckoutCard } from '../components/ux/MobileCheckoutCard';
import { RETURN_CONDITION_OPTIONS } from '../constants/enums';
import { getErrorMessage } from '../utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { formatDateCustom, getTodayLocalDate } from '../utils/dateFormatting';

type TabView = 'active' | 'overdue';

interface CheckInModalState {
  open: boolean;
  checkoutId: string;
  itemName: string;
}

export const InventoryCheckoutsPage: React.FC = () => {
  const tz = useTimezone();
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
  const [extendModal, setExtendModal] = useState<{
    open: boolean;
    checkoutId: string;
    itemName: string;
    currentDue: string;
  }>({ open: false, checkoutId: '', itemName: '', currentDue: '' });
  const [extendDate, setExtendDate] = useState('');

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
    void fetchCheckouts();
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

  const handleExtend = async () => {
    if (!extendModal.checkoutId || !extendDate) return;
    setSubmitting(true);
    try {
      await inventoryService.extendCheckout(extendModal.checkoutId, new Date(extendDate).toISOString());
      toast.success('Return date extended');
      setExtendModal({ open: false, checkoutId: '', itemName: '', currentDue: '' });
      setExtendDate('');
      await fetchCheckouts();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to extend checkout'));
    } finally {
      setSubmitting(false);
    }
  };

  const currentList = activeTab === 'active' ? activeCheckouts : overdueCheckouts;
  const filteredList = searchQuery.trim()
    ? currentList.filter(
        (c) =>
          c.item_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (c.user_name && c.user_name.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : currentList;

  const formatDate = (dateString: string) =>
    formatDateCustom(
      dateString,
      {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      },
      tz
    );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center space-y-4" role="status" aria-live="polite">
          <RefreshCw className="text-theme-text-muted h-10 w-10 animate-spin" aria-hidden="true" />
          <p className="text-theme-text-secondary text-sm">Loading checkouts...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex min-w-0 items-center space-x-3">
            <div className="shrink-0 rounded-lg bg-blue-600 p-2">
              <Package className="h-6 w-6 text-white" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="text-theme-text-primary text-xl font-bold sm:text-2xl">Inventory Checkouts</h1>
              <p className="text-theme-text-secondary hidden text-sm sm:block">
                Manage active and overdue equipment checkouts
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              void fetchCheckouts();
            }}
            className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary border-theme-surface-border flex shrink-0 items-center space-x-2 rounded-lg border px-3 py-2 transition-colors sm:px-4"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div
            className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4"
            role="alert"
            aria-live="assertive"
          >
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Tabs */}
        <div className="tab-scroll mb-6" role="tablist" aria-label="Checkout views">
          <button
            onClick={() => setActiveTab('active')}
            role="tab"
            aria-selected={activeTab === 'active'}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium ${
              activeTab === 'active'
                ? 'border-b-2 border-blue-500 text-blue-700 dark:text-blue-400'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <Clock className="h-4 w-4" aria-hidden="true" />
            Active Checkouts
            {activeCheckouts.length > 0 && (
              <span className="ml-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
                {activeCheckouts.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('overdue')}
            role="tab"
            aria-selected={activeTab === 'overdue'}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium ${
              activeTab === 'overdue'
                ? 'border-b-2 border-red-500 text-red-700 dark:text-red-400'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            Overdue
            {overdueCheckouts.length > 0 && (
              <span className="ml-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-700 dark:bg-red-500/20 dark:text-red-400">
                {overdueCheckouts.length}
              </span>
            )}
          </button>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search
              className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform"
              aria-hidden="true"
            />
            <label htmlFor="checkout-search" className="sr-only">
              Search checkouts
            </label>
            <input
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              id="checkout-search"
              type="text"
              aria-label="Search by item or member name..."
              placeholder="Search by item or member name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-input placeholder-theme-text-muted pr-4 pl-10"
            />
          </div>
        </div>

        {/* Content */}
        <div role="tabpanel">
          {filteredList.length === 0 ? (
            <div className="card-secondary p-8 text-center">
              <Package className="text-theme-text-muted mx-auto mb-4 h-12 w-12" aria-hidden="true" />
              <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">
                {activeTab === 'active' ? 'No Active Checkouts' : 'No Overdue Checkouts'}
              </h3>
              <p className="text-theme-text-muted">
                {activeTab === 'active'
                  ? 'There are no items currently checked out.'
                  : 'All checked out items are within their expected return dates.'}
              </p>
            </div>
          ) : (
            <>
              {/* Mobile card view */}
              <div className="space-y-3 sm:hidden">
                {filteredList.map((checkout) => (
                  <MobileCheckoutCard
                    key={checkout.checkout_id}
                    itemName={checkout.item_name}
                    memberName={checkout.user_name || undefined}
                    checkoutDate={formatDate(checkout.checked_out_at)}
                    dueDate={checkout.expected_return_at ? formatDate(checkout.expected_return_at) : undefined}
                    isOverdue={checkout.is_overdue}
                    onCheckIn={() => openCheckInModal(checkout.checkout_id, checkout.item_name)}
                    onExtend={() => {
                      setExtendModal({
                        open: true,
                        checkoutId: checkout.checkout_id,
                        itemName: checkout.item_name,
                        currentDue: checkout.expected_return_at || '',
                      });
                      setExtendDate('');
                    }}
                  />
                ))}
                <div className="text-theme-text-muted py-2 text-center text-xs">
                  {filteredList.length} checkout{filteredList.length !== 1 ? 's' : ''}
                </div>
              </div>
              {/* Desktop table view */}
              <div className="card-secondary hidden overflow-hidden sm:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-theme-surface-border bg-theme-surface border-b">
                        <th scope="col" className="text-theme-text-muted p-3 text-left text-xs font-medium uppercase">
                          Item Name
                        </th>
                        <th
                          scope="col"
                          className="text-theme-text-muted hidden p-3 text-left text-xs font-medium uppercase sm:table-cell"
                        >
                          Member
                        </th>
                        <th
                          scope="col"
                          className="text-theme-text-muted hidden p-3 text-left text-xs font-medium uppercase sm:table-cell"
                        >
                          Checkout Date
                        </th>
                        <th
                          scope="col"
                          className="text-theme-text-muted hidden p-3 text-left text-xs font-medium uppercase sm:table-cell"
                        >
                          Due Date
                        </th>
                        <th scope="col" className="text-theme-text-muted p-3 text-left text-xs font-medium uppercase">
                          Status
                        </th>
                        <th scope="col" className="text-theme-text-muted p-3 text-left text-xs font-medium uppercase">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredList.map((checkout) => (
                        <tr
                          key={checkout.checkout_id}
                          className={`border-theme-surface-border hover:bg-theme-surface-hover border-b ${
                            checkout.is_overdue ? 'bg-red-500/5' : ''
                          }`}
                        >
                          <td className="p-3">
                            <p className="text-theme-text-primary text-sm font-medium">{checkout.item_name}</p>
                          </td>
                          <td className="text-theme-text-secondary hidden p-3 text-sm sm:table-cell">
                            {checkout.user_name || '--'}
                          </td>
                          <td className="text-theme-text-secondary hidden p-3 text-sm sm:table-cell">
                            {formatDate(checkout.checked_out_at)}
                          </td>
                          <td className="text-theme-text-secondary hidden p-3 text-sm sm:table-cell">
                            {checkout.expected_return_at ? formatDate(checkout.expected_return_at) : '--'}
                          </td>
                          <td className="p-3">
                            {checkout.is_overdue ? (
                              <span className="inline-flex items-center rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-400">
                                Overdue
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/20 dark:text-green-400">
                                Active
                              </span>
                            )}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => openCheckInModal(checkout.checkout_id, checkout.item_name)}
                                className="btn-info flex items-center gap-1.5 px-3 py-1.5 text-xs"
                              >
                                <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden="true" />
                                Check In
                              </button>
                              <button
                                onClick={() => {
                                  setExtendModal({
                                    open: true,
                                    checkoutId: checkout.checkout_id,
                                    itemName: checkout.item_name,
                                    currentDue: checkout.expected_return_at || '',
                                  });
                                  setExtendDate('');
                                }}
                                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors"
                                title="Extend return date"
                              >
                                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                                <span className="hidden sm:inline">Extend</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="border-theme-surface-border text-theme-text-muted border-t p-3 text-xs">
                  {filteredList.length} checkout{filteredList.length !== 1 ? 's' : ''}
                </div>
              </div>
            </>
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
            <div className="flex min-h-screen items-center justify-center px-4">
              <div
                className="fixed inset-0 bg-black/60"
                aria-hidden="true"
                onClick={() => setCheckInModal({ open: false, checkoutId: '', itemName: '' })}
              ></div>
              <div className="bg-theme-surface-modal border-theme-surface-border relative z-10 w-full max-w-md rounded-lg border shadow-xl">
                <div className="px-4 pt-5 pb-4 sm:px-6">
                  <h3 id="checkin-modal-title" className="text-theme-text-primary mb-4 text-lg font-medium">
                    Check In: {checkInModal.itemName}
                  </h3>

                  <div className="space-y-4">
                    <div>
                      <label
                        htmlFor="return-condition"
                        className="text-theme-text-primary mb-1 block text-sm font-medium"
                      >
                        Return Condition <span aria-hidden="true">*</span>
                      </label>
                      <select
                        id="return-condition"
                        value={returnCondition}
                        onChange={(e) => setReturnCondition(e.target.value)}
                        className="form-input"
                      >
                        {RETURN_CONDITION_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="damage-notes" className="text-theme-text-primary mb-1 block text-sm font-medium">
                        Damage Notes (optional)
                      </label>
                      <textarea
                        id="damage-notes"
                        rows={3}
                        value={damageNotes}
                        onChange={(e) => setDamageNotes(e.target.value)}
                        placeholder="Describe any damage or issues..."
                        className="form-input"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-theme-input-bg flex flex-col-reverse gap-2 rounded-b-lg px-4 py-3 sm:flex-row sm:justify-end sm:gap-0 sm:space-x-3 sm:px-6">
                  <button
                    onClick={() => setCheckInModal({ open: false, checkoutId: '', itemName: '' })}
                    className="border-theme-input-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      void handleCheckIn();
                    }}
                    disabled={submitting}
                    className="btn-info inline-flex items-center space-x-2"
                  >
                    {submitting && <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    <span>{submitting ? 'Checking In...' : 'Check In'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Extend Checkout Modal */}
        {extendModal.open && (
          <div
            className="fixed inset-0 z-50 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="extend-modal-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setExtendModal({ open: false, checkoutId: '', itemName: '', currentDue: '' });
            }}
          >
            <div className="flex min-h-screen items-center justify-center px-4">
              <div
                className="fixed inset-0 bg-black/60"
                aria-hidden="true"
                onClick={() => setExtendModal({ open: false, checkoutId: '', itemName: '', currentDue: '' })}
              ></div>
              <div className="bg-theme-surface-modal border-theme-surface-border relative z-10 w-full max-w-sm rounded-lg border shadow-xl">
                <div className="px-4 pt-5 pb-4 sm:px-6">
                  <h3 id="extend-modal-title" className="text-theme-text-primary mb-1 text-lg font-medium">
                    Extend Return Date
                  </h3>
                  <p className="text-theme-text-muted mb-4 text-sm">{extendModal.itemName}</p>
                  {extendModal.currentDue && (
                    <p className="text-theme-text-secondary mb-3 text-xs">
                      Currently due:{' '}
                      {formatDateCustom(
                        extendModal.currentDue,
                        { month: 'short', day: 'numeric', year: 'numeric' },
                        tz
                      )}
                    </p>
                  )}
                  <div>
                    <label
                      htmlFor="admin-extend-date"
                      className="text-theme-text-primary mb-1 block text-sm font-medium"
                    >
                      New return date *
                    </label>
                    <input
                      id="admin-extend-date"
                      type="date"
                      value={extendDate}
                      min={getTodayLocalDate(tz)}
                      onChange={(e) => setExtendDate(e.target.value)}
                      className="form-input focus:ring-emerald-500"
                    />
                  </div>
                </div>
                <div className="bg-theme-input-bg flex flex-col-reverse gap-2 rounded-b-lg px-4 py-3 sm:flex-row sm:justify-end sm:gap-0 sm:space-x-3 sm:px-6">
                  <button
                    onClick={() => setExtendModal({ open: false, checkoutId: '', itemName: '', currentDue: '' })}
                    className="border-theme-input-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      void handleExtend();
                    }}
                    disabled={submitting || !extendDate}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {submitting ? 'Extending...' : 'Extend'}
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
