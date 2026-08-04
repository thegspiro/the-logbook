/**
 * My Store Orders Page
 *
 * A member's own orders: payment instructions with a prefilled Venmo/PayPal
 * link, a "I've sent payment" report, the order-update timeline, and
 * self-service cancellation while the order is still unfulfilled.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, CircleDollarSign, ExternalLink, Loader2, ShoppingBag, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { EmptyState } from '../../../components/ux/EmptyState';
import { Modal } from '../../../components/Modal';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatCurrency, formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { storefrontService } from '../services/api';
import { useStorefrontStore } from '../store/storefrontStore';
import {
  ORDER_STATUS_BADGES,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_BADGES,
  PAYMENT_STATUS_LABELS,
  type StoreOrder,
} from '../types';

const MyOrdersPage: React.FC = () => {
  const tz = useTimezone();
  const { myOrders, isLoading, loadMyOrders } = useStorefrontStore();

  const [reportOrder, setReportOrder] = useState<StoreOrder | null>(null);
  const [reportMethod, setReportMethod] = useState('');
  const [reportReference, setReportReference] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void loadMyOrders();
  }, [loadMyOrders]);

  const openReport = useCallback((order: StoreOrder) => {
    setReportOrder(order);
    setReportMethod(order.paymentMethod ?? '');
    setReportReference('');
  }, []);

  const submitReport = useCallback(async () => {
    if (!reportOrder || !reportMethod) return;
    setSubmitting(true);
    try {
      await storefrontService.reportPayment(reportOrder.id, {
        paymentMethod: reportMethod,
        reference: reportReference.trim() || undefined,
      });
      toast.success('Thanks — the quartermaster will confirm it.');
      setReportOrder(null);
      void loadMyOrders();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not record that'));
    } finally {
      setSubmitting(false);
    }
  }, [loadMyOrders, reportMethod, reportOrder, reportReference]);

  const cancelOrder = useCallback(
    async (order: StoreOrder) => {
      setSubmitting(true);
      try {
        await storefrontService.cancelMyOrder(order.id);
        toast.success(`Order ${order.orderNumber} cancelled`);
        void loadMyOrders();
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not cancel that order'));
      } finally {
        setSubmitting(false);
      }
    },
    [loadMyOrders]
  );

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          to="/store"
          className="text-theme-text-muted hover:text-theme-text-secondary mb-6 flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to the store
        </Link>

        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg bg-blue-600 p-2">
            <ShoppingBag className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-theme-text-primary text-xl font-bold">My Orders</h1>
            <p className="text-theme-text-muted text-sm">
              Payment details and status for everything you&apos;ve ordered
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
          </div>
        ) : myOrders.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title="No orders yet"
            description="Orders you place in the department store will show up here."
          />
        ) : (
          <div className="space-y-4">
            {myOrders.map((order) => {
              const balance = Number(order.balanceDue);
              const instructions = order.paymentInstructions;
              const canCancel = order.status === 'submitted' || order.status === 'awaiting_payment';

              return (
                <article key={order.id} className="card p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-theme-text-primary text-sm font-semibold">{order.orderNumber}</h2>
                      <p className="text-theme-text-muted text-xs">
                        {order.windowName ?? 'Store order'} · {formatDateTime(order.submittedAt, tz)}
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
                  </div>

                  <ul className="mt-4 space-y-1">
                    {order.items.map((item) => (
                      <li key={item.id} className="text-theme-text-secondary flex justify-between text-sm">
                        <span>
                          {item.quantity} × {item.productName}
                          {item.variantLabel ? ` (${item.variantLabel})` : ''}
                        </span>
                        <span>{formatCurrency(Number(item.lineTotal))}</span>
                      </li>
                    ))}
                  </ul>

                  <dl className="border-theme-surface-border mt-3 space-y-1 border-t pt-3 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-theme-text-muted">Total</dt>
                      <dd className="text-theme-text-primary font-medium">{formatCurrency(Number(order.total))}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-theme-text-muted">Paid</dt>
                      <dd className="text-theme-text-primary">{formatCurrency(Number(order.amountPaid))}</dd>
                    </div>
                    {balance > 0 && (
                      <div className="flex justify-between font-semibold">
                        <dt className="text-theme-text-primary">Balance due</dt>
                        <dd className="text-amber-600 dark:text-amber-400">{formatCurrency(balance)}</dd>
                      </div>
                    )}
                  </dl>

                  {instructions && balance > 0 && (
                    <div className="alert-info mt-4">
                      <div className="flex items-start gap-2">
                        <CircleDollarSign className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0 text-sm">
                          <p className="font-medium">
                            Pay {formatCurrency(balance)}
                            {instructions.label ? ` by ${instructions.label}` : ''}
                          </p>
                          {instructions.handle && (
                            <p className="mt-1 text-xs">
                              Send to <strong>{instructions.handle}</strong> and reference{' '}
                              <strong>{instructions.reference}</strong>
                            </p>
                          )}
                          {instructions.instructions && (
                            <p className="mt-1 text-xs whitespace-pre-line">{instructions.instructions}</p>
                          )}
                          <div className="mt-3 flex flex-wrap gap-2">
                            {instructions.paymentUrl && (
                              <a
                                href={instructions.paymentUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn-primary btn-md"
                              >
                                Pay now
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            )}
                            {order.paymentStatus !== 'pending_verification' && (
                              <button type="button" className="btn-secondary btn-md" onClick={() => openReport(order)}>
                                I&apos;ve sent payment
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {order.events.length > 0 && (
                    <details className="mt-4">
                      <summary className="text-theme-text-muted cursor-pointer text-sm">
                        Order updates ({order.events.length})
                      </summary>
                      <ol className="mt-2 space-y-2">
                        {order.events.map((event) => (
                          <li key={event.id} className="text-xs">
                            <span className="text-theme-text-muted">{formatDateTime(event.createdAt, tz)}</span>
                            <span className="text-theme-text-secondary">
                              {' — '}
                              {event.message}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}

                  {canCancel && (
                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        className="btn-secondary btn-md text-red-600 dark:text-red-400"
                        disabled={submitting}
                        onClick={() => {
                          void cancelOrder(order);
                        }}
                      >
                        <XCircle className="h-4 w-4" />
                        Cancel order
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        isOpen={reportOrder !== null}
        onClose={() => setReportOrder(null)}
        title="Report a payment"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary btn-md" onClick={() => setReportOrder(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary btn-md"
              disabled={submitting || !reportMethod}
              onClick={() => {
                void submitReport();
              }}
            >
              {submitting ? 'Saving…' : 'Report payment'}
            </button>
          </div>
        }
      >
        <div className="modal-body space-y-4">
          <p className="text-theme-text-secondary text-sm">
            This flags the order for the quartermaster to verify against the department account. It does not mark the
            order paid on its own.
          </p>
          <div>
            <label htmlFor="report-method" className="form-label">
              Payment method
            </label>
            <select
              id="report-method"
              value={reportMethod}
              onChange={(e) => setReportMethod(e.target.value)}
              className="form-input"
            >
              <option value="">Select…</option>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="report-reference" className="form-label">
              Reference / confirmation (optional)
            </label>
            <input
              id="report-reference"
              type="text"
              value={reportReference}
              onChange={(e) => setReportReference(e.target.value)}
              className="form-input"
              placeholder="Venmo note, check number, …"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default MyOrdersPage;
