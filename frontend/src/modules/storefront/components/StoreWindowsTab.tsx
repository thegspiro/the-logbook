/**
 * Store Windows Tab
 *
 * Order periods: open and close them (with the member email that goes with it),
 * and read the bulk-purchase tally the department takes to the vendor.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, ClipboardList, Loader2, Lock, Pencil, Play, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { EmptyState } from '../../../components/ux/EmptyState';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatCurrency, formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { storefrontService } from '../services/api';
import { formatDateOnly } from '../utils/formatting';
import {
  WINDOW_STATUS_BADGES,
  WINDOW_STATUS_LABELS,
  type StoreOrderWindow,
  type StoreProduct,
  type StoreWindowSummary,
} from '../types';
import { WindowFormModal } from './WindowFormModal';

interface StoreWindowsTabProps {
  onChanged: () => void;
}

export const StoreWindowsTab: React.FC<StoreWindowsTabProps> = ({ onChanged }) => {
  const tz = useTimezone();
  const [windows, setWindows] = useState<StoreOrderWindow[]>([]);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StoreOrderWindow | null>(null);
  const [summary, setSummary] = useState<StoreWindowSummary | null>(null);
  const [transition, setTransition] = useState<{
    window: StoreOrderWindow;
    action: 'open' | 'close';
  } | null>(null);
  const [notifyMembers, setNotifyMembers] = useState(true);
  const [transitionMessage, setTransitionMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [windowList, productList] = await Promise.all([
        storefrontService.getWindows(),
        storefrontService.getProducts({}),
      ]);
      setWindows(windowList);
      setProducts(productList);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load order windows'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runTransition = useCallback(async () => {
    if (!transition) return;
    setBusy(true);
    try {
      if (transition.action === 'open') {
        await storefrontService.openWindow(transition.window.id, {
          notifyMembers,
          message: transitionMessage.trim() || undefined,
        });
        toast.success('Ordering is open');
      } else {
        await storefrontService.closeWindow(transition.window.id, {
          notifyMembers,
          message: transitionMessage.trim() || undefined,
        });
        toast.success('Ordering is closed');
      }
      setTransition(null);
      setTransitionMessage('');
      void load();
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not change the window'));
    } finally {
      setBusy(false);
    }
  }, [load, notifyMembers, onChanged, transition, transitionMessage]);

  const markFulfilled = useCallback(
    async (windowItem: StoreOrderWindow) => {
      try {
        await storefrontService.fulfillWindow(windowItem.id);
        toast.success('Window marked fulfilled');
        void load();
        onChanged();
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not update the window'));
      }
    },
    [load, onChanged]
  );

  const showSummary = useCallback(async (windowId: string) => {
    try {
      setSummary(await storefrontService.getWindowSummary(windowId));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not load the tally'));
    }
  }, []);

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          className="btn-primary btn-md"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          New order window
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
        </div>
      ) : windows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No order windows yet"
          description="An order window is the period members can place orders in. Create one, then open it when you're ready."
        />
      ) : (
        <div className="space-y-3">
          {windows.map((windowItem) => (
            <article key={windowItem.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-theme-text-primary text-sm font-semibold">{windowItem.name}</h3>
                    <span className={`badge ${WINDOW_STATUS_BADGES[windowItem.status] ?? ''}`}>
                      {WINDOW_STATUS_LABELS[windowItem.status] ?? windowItem.status}
                    </span>
                  </div>
                  <p className="text-theme-text-muted mt-1 text-xs">
                    {windowItem.opensAt ? `Opens ${formatDateTime(windowItem.opensAt, tz)}` : 'No open time set'}
                    {windowItem.closesAt ? ` · Closes ${formatDateTime(windowItem.closesAt, tz)}` : ''}
                    {windowItem.expectedDeliveryDate
                      ? ` · Delivery ${formatDateOnly(windowItem.expectedDeliveryDate)}`
                      : ''}
                  </p>
                  <p className="text-theme-text-muted mt-1 text-xs">
                    {windowItem.orderCount} order(s) · {formatCurrency(Number(windowItem.totalSales))} sold ·{' '}
                    {formatCurrency(Number(windowItem.outstandingBalance))} outstanding
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {windowItem.status !== 'open' &&
                    windowItem.status !== 'fulfilled' &&
                    windowItem.status !== 'cancelled' && (
                      <button
                        type="button"
                        className="btn-success btn-sm"
                        onClick={() => {
                          setTransition({ window: windowItem, action: 'open' });
                          setNotifyMembers(windowItem.notifyOnOpen);
                        }}
                      >
                        <Play className="h-3.5 w-3.5" />
                        Open
                      </button>
                    )}
                  {windowItem.status === 'open' && (
                    <button
                      type="button"
                      className="btn-warning btn-sm"
                      onClick={() => {
                        setTransition({ window: windowItem, action: 'close' });
                        setNotifyMembers(true);
                      }}
                    >
                      <Lock className="h-3.5 w-3.5" />
                      Close
                    </button>
                  )}
                  {windowItem.status === 'closed' && (
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => {
                        void markFulfilled(windowItem);
                      }}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Mark fulfilled
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      void showSummary(windowItem.id);
                    }}
                  >
                    <ClipboardList className="h-3.5 w-3.5" />
                    Tally
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      setEditing(windowItem);
                      setFormOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <WindowFormModal
        isOpen={formOpen}
        window={editing}
        products={products}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          void load();
          onChanged();
        }}
      />

      <Modal
        isOpen={transition !== null}
        onClose={() => setTransition(null)}
        title={transition?.action === 'open' ? 'Open ordering' : 'Close ordering'}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary btn-md" onClick={() => setTransition(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary btn-md"
              disabled={busy}
              onClick={() => {
                void runTransition();
              }}
            >
              {busy ? 'Working…' : transition?.action === 'open' ? 'Open the window' : 'Close the window'}
            </button>
          </div>
        }
      >
        <div className="modal-body space-y-4">
          <p className="text-theme-text-secondary text-sm">
            {transition?.action === 'open'
              ? 'Members will be able to place orders immediately.'
              : 'No new orders will be accepted. Everyone who ordered gets a notice with what happens next.'}
          </p>
          <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={notifyMembers}
              onChange={(e) => setNotifyMembers(e.target.checked)}
            />
            {transition?.action === 'open' ? 'Email the membership' : 'Email everyone who ordered'}
          </label>
          <div>
            <label htmlFor="transition-message" className="form-label">
              Add to the email (optional)
            </label>
            <textarea
              id="transition-message"
              rows={3}
              value={transitionMessage}
              onChange={(e) => setTransitionMessage(e.target.value)}
              className="form-input"
            />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={summary !== null}
        onClose={() => setSummary(null)}
        title={summary ? `Tally — ${summary.windowName}` : 'Tally'}
        size="lg"
        footer={
          <div className="flex justify-end">
            <button type="button" className="btn-secondary btn-md" onClick={() => setSummary(null)}>
              Close
            </button>
          </div>
        }
      >
        <div className="modal-body">
          {summary && (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <p className="text-theme-text-muted text-xs">Orders</p>
                  <p className="text-theme-text-primary text-lg font-semibold">{summary.orderCount}</p>
                </div>
                <div>
                  <p className="text-theme-text-muted text-xs">Members</p>
                  <p className="text-theme-text-primary text-lg font-semibold">{summary.memberCount}</p>
                </div>
                <div>
                  <p className="text-theme-text-muted text-xs">Collected</p>
                  <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                    {formatCurrency(Number(summary.collected))}
                  </p>
                </div>
                <div>
                  <p className="text-theme-text-muted text-xs">Outstanding</p>
                  <p className="text-lg font-semibold text-amber-600 dark:text-amber-400">
                    {formatCurrency(Number(summary.outstanding))}
                  </p>
                </div>
              </div>

              {/* What to buy, merged across members. On a personalized item
                  every detail row below is unique, so without this the
                  quartermaster would be adding up sizes by hand. */}
              {summary.sizeTotals.length > 0 && (
                <div className="mb-5">
                  <h4 className="text-theme-text-primary mb-1 text-sm font-semibold">Order this from the vendor</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-theme-text-muted text-left">
                          <th className="py-1 pr-2 font-medium">Item</th>
                          <th className="px-2 py-1 font-medium">Option</th>
                          <th className="px-2 py-1 font-medium">SKU</th>
                          <th className="py-1 pl-2 text-center font-medium">Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.sizeTotals.map((row) => (
                          <tr
                            key={`${row.productId ?? 'x'}-${row.variantLabel ?? ''}`}
                            className="border-theme-surface-border border-t"
                          >
                            <td className="text-theme-text-primary py-1.5 pr-2">{row.productName}</td>
                            <td className="text-theme-text-secondary px-2 py-1.5">{row.variantLabel ?? '—'}</td>
                            <td className="text-theme-text-muted px-2 py-1.5 font-mono text-xs">{row.sku ?? '—'}</td>
                            <td className="text-theme-text-primary py-1.5 pl-2 text-center font-semibold">
                              {row.quantity}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-theme-surface-border border-t-2">
                          <td className="text-theme-text-muted py-1.5 pr-2 text-xs uppercase" colSpan={3}>
                            Total units
                          </td>
                          <td className="text-theme-text-primary py-1.5 pl-2 text-center font-semibold">
                            {summary.sizeTotals.reduce((sum, row) => sum + row.quantity, 0)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Held-back orders are shown, not silently dropped: the
                  quartermaster has to know who is being left out of the vendor
                  order — and chase them — before it goes in. */}
              {summary.heldTotals.length > 0 && (
                <div className="alert-warning mb-5">
                  <p className="text-sm font-semibold">
                    Held back — unpaid ({summary.heldOrderCount} {summary.heldOrderCount === 1 ? 'order' : 'orders'})
                  </p>
                  <p className="mt-0.5 text-xs">
                    This store requires payment before the vendor order, so these are not in the totals above. Record
                    their payment to include them.
                  </p>
                  <ul className="mt-2 space-y-0.5 text-xs">
                    {summary.heldTotals.map((row) => (
                      <li key={`held-${row.productId ?? 'x'}-${row.variantLabel ?? ''}`}>
                        {row.productName} · {row.variantLabel ?? '—'} · x{row.quantity}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <h4 className="text-theme-text-primary mb-1 text-sm font-semibold">Line detail</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-theme-text-muted text-left">
                      <th className="py-1 pr-2 font-medium">Item</th>
                      <th className="px-2 py-1 font-medium">Option</th>
                      <th className="px-2 py-1 font-medium">Personalization</th>
                      <th className="px-2 py-1 text-center font-medium">Qty</th>
                      <th className="py-1 pl-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.tallies.map((row, index) => (
                      <tr
                        key={`${row.productId ?? 'x'}-${row.variantLabel ?? ''}-${row.personalizationText ?? ''}-${index}`}
                        className="border-theme-surface-border border-t"
                      >
                        <td className="text-theme-text-primary py-1.5 pr-2">{row.productName}</td>
                        <td className="text-theme-text-secondary px-2 py-1.5">{row.variantLabel ?? '—'}</td>
                        <td className="text-theme-text-secondary px-2 py-1.5">{row.personalizationText ?? '—'}</td>
                        <td className="text-theme-text-primary px-2 py-1.5 text-center font-medium">{row.quantity}</td>
                        <td className="text-theme-text-secondary py-1.5 pl-2 text-right">
                          {formatCurrency(Number(row.lineTotal))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
};
