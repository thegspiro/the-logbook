/**
 * Store Orders Tab
 *
 * Filterable order list with bulk status advancement and the CSV export used
 * for the vendor purchase order and the treasurer hand-off.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { CircleDollarSign, Download, Loader2, ShoppingBag } from 'lucide-react';
import toast from 'react-hot-toast';
import { EmptyState } from '../../../components/ux/EmptyState';
import { Pagination } from '../../../components/ux/Pagination';
import { useTimezone } from '../../../hooks/useTimezone';
import { DEFAULT_PAGE_SIZE } from '../../../constants/config';
import { formatCurrency, formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { storefrontService } from '../services/api';
import {
  ORDER_STATUS_BADGES,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_BADGES,
  PAYMENT_STATUS_LABELS,
  StoreOrderStatus,
  type StoreOrder,
  type StoreOrderWindow,
} from '../types';
import { OrderDetailModal } from './OrderDetailModal';

interface StoreOrdersTabProps {
  onChanged: () => void;
  /** Payment status to open filtered to, e.g. arriving from a dashboard counter. */
  initialPaymentFilter?: string;
}

export const StoreOrdersTab: React.FC<StoreOrdersTabProps> = ({ onChanged, initialPaymentFilter }) => {
  const tz = useTimezone();
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [windows, setWindows] = useState<StoreOrderWindow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [windowFilter, setWindowFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState(initialPaymentFilter ?? '');
  const [methodFilter, setMethodFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<string>(StoreOrderStatus.READY_FOR_PICKUP);
  const [bulkPaymentMethod, setBulkPaymentMethod] = useState('');
  const [bulkReference, setBulkReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const allSelected = orders.length > 0 && orders.every((o) => selected.includes(o.id));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await storefrontService.getOrders({
        windowId: windowFilter || undefined,
        status: statusFilter || undefined,
        paymentStatus: paymentFilter || undefined,
        paymentMethod: methodFilter || undefined,
        search: search.trim() || undefined,
        page,
        pageSize: DEFAULT_PAGE_SIZE,
      });
      setOrders(response.items);
      setTotal(response.total);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load orders'));
    } finally {
      setLoading(false);
    }
  }, [methodFilter, page, paymentFilter, search, statusFilter, windowFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    storefrontService
      .getWindows()
      .then(setWindows)
      .catch(() => {
        // The filter dropdown is a convenience; a failure here must not block
        // the order list itself, which has already loaded.
      });
  }, []);

  const toggleSelect = (orderId: string) =>
    setSelected((prev) => (prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]));

  const toggleSelectAll = () =>
    setSelected((prev) => {
      const pageIds = orders.map((o) => o.id);
      if (allSelected) return prev.filter((id) => !pageIds.includes(id));
      return [...new Set([...prev, ...pageIds])];
    });

  const markPaid = useCallback(
    async (order: StoreOrder) => {
      setBusy(true);
      try {
        await storefrontService.markOrderPaid(order.id, {
          paymentMethod: order.paymentMethod ?? undefined,
          notifyMember: true,
        });
        toast.success(`${order.orderNumber} marked paid`);
        void load();
        onChanged();
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not mark that order paid'));
      } finally {
        setBusy(false);
      }
    },
    [load, onChanged]
  );

  const runBulkMarkPaid = useCallback(async () => {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      const result = await storefrontService.bulkMarkPaid({
        orderIds: selected,
        paymentMethod: bulkPaymentMethod || undefined,
        reference: bulkReference.trim() || undefined,
        notifyMembers: true,
      });
      toast.success(
        `${result.updated} order(s) marked paid${result.skipped ? `, ${result.skipped} already settled` : ''}`
      );
      setSelected([]);
      setBulkReference('');
      void load();
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not mark those orders paid'));
    } finally {
      setBusy(false);
    }
  }, [bulkPaymentMethod, bulkReference, load, onChanged, selected]);

  const runBulk = useCallback(async () => {
    if (selected.length === 0) return;
    try {
      const result = await storefrontService.bulkUpdateStatus({
        orderIds: selected,
        status: bulkStatus,
        notifyMembers: true,
      });
      toast.success(`${result.updated} order(s) updated${result.skipped ? `, ${result.skipped} skipped` : ''}`);
      setSelected([]);
      void load();
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not update those orders'));
    }
  }, [bulkStatus, load, onChanged, selected]);

  const exportCsv = useCallback(async () => {
    try {
      const blob = await storefrontService.exportOrders({
        windowId: windowFilter || undefined,
        status: statusFilter || undefined,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'store_orders.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not export the orders'));
    }
  }, [statusFilter, windowFilter]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="order-search" className="sr-only">
            Search orders
          </label>
          <input
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            id="order-search"
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="form-input"
            placeholder="Order number, member, email"
          />
        </div>
        <div>
          <label htmlFor="order-window-filter" className="sr-only">
            Filter by order window
          </label>
          <select
            id="order-window-filter"
            value={windowFilter}
            onChange={(e) => {
              setWindowFilter(e.target.value);
              setPage(1);
            }}
            className="form-input"
          >
            <option value="">All windows</option>
            {windows.map((windowItem) => (
              <option key={windowItem.id} value={windowItem.id}>
                {windowItem.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="order-status-filter" className="sr-only">
            Filter by status
          </label>
          <select
            id="order-status-filter"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="form-input"
          >
            <option value="">All statuses</option>
            {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="order-payment-filter" className="sr-only">
            Filter by payment status
          </label>
          <select
            id="order-payment-filter"
            value={paymentFilter}
            onChange={(e) => {
              setPaymentFilter(e.target.value);
              setPage(1);
            }}
            className="form-input"
          >
            <option value="">All payments</option>
            {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {/* Every app settles separately, so reconciling a Zelle batch means
              seeing only the Zelle orders. */}
          <label htmlFor="order-method-filter" className="sr-only">
            Filter by payment method
          </label>
          <select
            id="order-method-filter"
            value={methodFilter}
            onChange={(e) => {
              setMethodFilter(e.target.value);
              setPage(1);
            }}
            className="form-input"
          >
            <option value="">All methods</option>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn-secondary btn-md"
          onClick={() => {
            void exportCsv();
          }}
        >
          <Download className="h-4 w-4" />
          Export
        </button>
      </div>

      {selected.length > 0 && (
        <div className="card-secondary mb-4 flex flex-wrap items-center gap-2 p-3">
          <span className="text-theme-text-secondary text-sm">{selected.length} selected</span>

          {/* Payment first: reconciling a Venmo/PayPal payout against a
              window is the job this screen exists for. */}
          <label htmlFor="bulk-payment-method" className="sr-only">
            Payment method for selected orders
          </label>
          <select
            id="bulk-payment-method"
            value={bulkPaymentMethod}
            onChange={(e) => setBulkPaymentMethod(e.target.value)}
            className="form-input-sm"
          >
            <option value="">Method (unchanged)</option>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label htmlFor="bulk-payment-reference" className="sr-only">
            Payment reference
          </label>
          <input
            id="bulk-payment-reference"
            type="text"
            value={bulkReference}
            onChange={(e) => setBulkReference(e.target.value)}
            className="form-input-sm w-44"
            placeholder="Reference (optional)"
          />
          <button
            type="button"
            className="btn-success btn-sm"
            disabled={busy}
            onClick={() => {
              void runBulkMarkPaid();
            }}
          >
            <CircleDollarSign className="h-3.5 w-3.5" />
            Mark selected paid
          </button>

          <span className="border-theme-surface-border mx-1 h-5 border-l" aria-hidden="true" />

          <label htmlFor="bulk-status" className="sr-only">
            Bulk status
          </label>
          <select
            id="bulk-status"
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value)}
            className="form-input-sm"
          >
            {Object.entries(ORDER_STATUS_LABELS)
              .filter(([value]) => value !== StoreOrderStatus.CANCELLED)
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={busy}
            onClick={() => {
              void runBulk();
            }}
          >
            Set status
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="No orders" description="Orders placed by members will appear here." />
      ) : (
        <>
          <label className="text-theme-text-secondary mb-2 flex items-center gap-2 text-sm">
            <input type="checkbox" className="form-checkbox" checked={allSelected} onChange={toggleSelectAll} />
            Select all on this page ({orders.length})
          </label>

          <ul className="space-y-2">
            {orders.map((order) => (
              <li key={order.id} className="card-secondary flex flex-wrap items-center gap-3 p-3">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  aria-label={`Select order ${order.orderNumber}`}
                  checked={selected.includes(order.id)}
                  onChange={() => toggleSelect(order.id)}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-theme-text-primary text-sm">
                    {order.orderNumber} — {order.customerName}
                  </p>
                  <p className="text-theme-text-muted text-xs">
                    {formatDateTime(order.submittedAt, tz)} · {order.items.length} item(s) ·{' '}
                    {formatCurrency(Number(order.total))}
                    {Number(order.balanceDue) > 0 ? ` · ${formatCurrency(Number(order.balanceDue))} due` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={`badge ${ORDER_STATUS_BADGES[order.status] ?? ''}`}>
                    {ORDER_STATUS_LABELS[order.status] ?? order.status}
                  </span>
                  <span className={`badge ${PAYMENT_STATUS_BADGES[order.paymentStatus] ?? ''}`}>
                    {PAYMENT_STATUS_LABELS[order.paymentStatus] ?? order.paymentStatus}
                  </span>
                </div>
                {Number(order.balanceDue) > 0 && order.status !== StoreOrderStatus.CANCELLED && (
                  <button
                    type="button"
                    className="btn-success btn-sm"
                    disabled={busy}
                    onClick={() => {
                      void markPaid(order);
                    }}
                  >
                    <CircleDollarSign className="h-3.5 w-3.5" />
                    Mark paid
                  </button>
                )}
                <button type="button" className="btn-secondary btn-sm" onClick={() => setDetailId(order.id)}>
                  Manage
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-4">
            <Pagination currentPage={page} totalItems={total} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} />
          </div>
        </>
      )}

      <OrderDetailModal
        orderId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={() => {
          void load();
          onChanged();
        }}
      />
    </div>
  );
};
