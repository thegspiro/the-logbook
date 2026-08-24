/**
 * My Store Orders Page
 *
 * A member's own orders: where each one has got to, what is still owed and how
 * to settle it, the order-update timeline, and self-service cancellation while
 * the order is still unfulfilled.
 *
 * Settled orders collapse to a single row. They are the majority after a
 * couple of windows, and a member opening this page is almost always here
 * about the one that still wants money.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, ChevronDown, Clock, Loader2, ShoppingBag, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { EmptyState } from '../../../components/ux/EmptyState';
import { Modal } from '../../../components/Modal';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatCurrency, formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { OrderStatusStepper } from '../components/OrderStatusStepper';
import { PaymentOptions } from '../components/PaymentOptions';
import { storefrontService } from '../services/api';
import { useStorefrontStore } from '../store/storefrontStore';
import {
  ORDER_STATUS_BADGES,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_BADGES,
  PAYMENT_STATUS_LABELS,
  StoreOrderStatus,
  type StoreOrder,
} from '../types';

/**
 * An order with nothing left to do collapses.
 *
 * Cancellation alone is enough, without checking the balance: cancelling an
 * unpaid order changes only its fulfilment status, so `balanceDue` keeps the
 * full total. Requiring a zero balance therefore left every cancelled unpaid
 * order sitting in the active list — the exact orders a member most wants out
 * of the way.
 */
const isSettled = (order: StoreOrder): boolean =>
  order.status === StoreOrderStatus.CANCELLED ||
  (Number(order.balanceDue) <= 0 && order.status === StoreOrderStatus.FULFILLED);

const MyOrdersPage: React.FC = () => {
  const tz = useTimezone();
  // `error` is read here deliberately: without it a failed load fell through to
  // the "No orders yet" empty state, telling a member who has orders that they
  // have none — a load failure presented as fact about their account.
  const { myOrders, isLoading, error, loadMyOrders } = useStorefrontStore();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');

  const [reportOrder, setReportOrder] = useState<StoreOrder | null>(null);
  const [reportMethod, setReportMethod] = useState('');
  const [reportReference, setReportReference] = useState('');
  const [methodOrder, setMethodOrder] = useState<StoreOrder | null>(null);
  const [newPaymentMethod, setNewPaymentMethod] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  useEffect(() => {
    void loadMyOrders();
  }, [loadMyOrders]);

  // An order just placed opens expanded even once it settles — the member was
  // sent here to look at that one specifically.
  useEffect(() => {
    if (highlightId) setExpandedOrderId(highlightId);
  }, [highlightId]);

  const { open, settled } = useMemo(
    () => ({
      open: myOrders.filter((order) => !isSettled(order)),
      settled: myOrders.filter(isSettled),
    }),
    [myOrders]
  );

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

  const changePaymentMethod = useCallback(async () => {
    if (!methodOrder || !newPaymentMethod) return;
    setSubmitting(true);
    try {
      await storefrontService.updateMyPaymentMethod(methodOrder.id, newPaymentMethod);
      toast.success('Payment method updated');
      setMethodOrder(null);
      void loadMyOrders();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not update the payment method'));
    } finally {
      setSubmitting(false);
    }
  }, [loadMyOrders, methodOrder, newPaymentMethod]);

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

  const renderOrderCard = (order: StoreOrder) => {
    // A cancelled order carries its old balance — the backend zeroes nothing on
    // cancellation — but nobody owes it. Demanding payment for an order the
    // member already cancelled is worse than showing no figure at all.
    const balance = order.status === StoreOrderStatus.CANCELLED ? 0 : Number(order.balanceDue);
    const instructions = order.paymentInstructions;
    const canCancel = order.status === 'submitted' || order.status === 'awaiting_payment';

    return (
      <article key={order.id} className="card overflow-hidden">
        <div className="border-theme-surface-border flex flex-wrap items-start justify-between gap-3 border-b p-4 sm:p-5">
          <div className="min-w-0">
            <h2 className="text-theme-text-primary font-mono text-base font-bold">{order.orderNumber}</h2>
            <p className="text-theme-text-secondary mt-1 text-[13px]">
              {order.windowName ?? 'Store order'} · placed {formatDateTime(order.submittedAt, tz)}
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

        <div className="border-theme-surface-border border-b p-4 sm:px-5 sm:pt-5 sm:pb-0">
          <OrderStatusStepper order={order} />
        </div>

        <div className="flex flex-col gap-3.5 p-4 sm:p-5">
          <ul className="flex flex-col gap-2">
            {order.items.map((item) => (
              <li key={item.id} className="text-theme-text-secondary flex justify-between gap-3 text-sm">
                <span>
                  {item.quantity} × {item.productName}
                  {item.variantLabel ? ` (${item.variantLabel})` : ''}
                  {item.personalizationText ? ` — “${item.personalizationText}”` : ''}
                </span>
                <span className="font-mono whitespace-nowrap">{formatCurrency(Number(item.lineTotal))}</span>
              </li>
            ))}
          </ul>

          <dl className="border-theme-surface-border flex flex-col gap-1 border-t pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-theme-text-secondary">Total</dt>
              <dd className="text-theme-text-primary font-mono font-medium">{formatCurrency(Number(order.total))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-theme-text-secondary">Paid</dt>
              <dd className="text-theme-text-primary font-mono">{formatCurrency(Number(order.amountPaid))}</dd>
            </div>
          </dl>

          {balance > 0 && (
            <div className="alert-warning">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold tracking-[.08em] text-amber-900 uppercase dark:text-amber-200">
                    Balance due
                  </p>
                  <p className="mt-0.5 font-mono text-[28px] leading-tight font-bold text-amber-900 dark:text-amber-200">
                    {formatCurrency(balance)}
                  </p>
                  <p className="mt-1 text-[13px] text-amber-900 dark:text-amber-200">
                    Reference <strong className="font-mono">{order.orderNumber}</strong> on your payment.
                  </p>
                </div>
                {instructions && (
                  <div className="w-full sm:w-[280px]">
                    <PaymentOptions
                      instructions={instructions}
                      amount={balance}
                      showReference={false}
                      onReport={order.paymentStatus !== 'pending_verification' ? () => openReport(order) : undefined}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* The backend rejects payment-method changes on cancelled
              orders and while a payment report awaits verification —
              don't offer a button that can only error. */}
          {balance > 0 && order.status !== 'cancelled' && order.paymentStatus !== 'pending_verification' && (
            <button
              type="button"
              className="text-theme-text-secondary hover:text-theme-text-primary self-start text-xs underline"
              onClick={() => {
                setMethodOrder(order);
                setNewPaymentMethod(order.paymentMethod ?? '');
              }}
            >
              Change payment method
            </button>
          )}

          {order.events.length > 0 && (
            <details className="group">
              <summary className="text-theme-text-secondary mobile-touch-target flex cursor-pointer items-center gap-2 text-[13px]">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                Order updates ({order.events.length})
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <ol className="mt-2 space-y-2">
                {order.events.map((event) => (
                  <li key={event.id} className="text-xs">
                    <span className="text-theme-text-secondary">{formatDateTime(event.createdAt, tz)}</span>
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
            <div className="flex justify-end">
              <button
                type="button"
                className="btn-secondary btn-md text-red-800 dark:text-red-300"
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
        </div>
      </article>
    );
  };

  return (
    <div className="motion-safe:animate-page-enter min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          to="/store"
          className="text-theme-text-secondary hover:text-theme-text-primary mb-5 flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to the store
        </Link>

        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-800">
            <ShoppingBag className="h-5 w-5 text-white" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-theme-text-primary text-[22px] font-bold">My Orders</h1>
            <p className="text-theme-text-secondary text-sm">What you owe, what&apos;s on the way</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
          </div>
        ) : error ? (
          <div className="space-y-3">
            <p className="alert-danger" role="alert">
              {error}
            </p>
            <button type="button" onClick={() => void loadMyOrders()} className="btn-secondary btn-md">
              Try again
            </button>
          </div>
        ) : myOrders.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title="No orders yet"
            description="Orders you place in the department store will show up here."
          />
        ) : (
          <div className="space-y-4">
            {open.map(renderOrderCard)}

            {settled.length > 0 && (
              <div className="space-y-2">
                <h2 className="text-theme-text-secondary text-[10px] font-bold tracking-[.1em] uppercase">
                  Settled orders
                </h2>
                {settled.map((order) =>
                  expandedOrderId === order.id ? (
                    renderOrderCard(order)
                  ) : (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => setExpandedOrderId(order.id)}
                      className="card card-hover flex w-full items-center justify-between gap-4 p-4 text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-theme-text-primary font-mono text-base font-bold">{order.orderNumber}</p>
                        <p className="text-theme-text-secondary mt-1 text-[13px]">
                          {order.windowName ? `${order.windowName} · ` : ''}
                          {order.items.reduce((sum, item) => sum + item.quantity, 0)} items ·{' '}
                          {order.status === StoreOrderStatus.CANCELLED ? 'cancelled' : 'paid in full'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2.5">
                        <span className={`badge ${ORDER_STATUS_BADGES[order.status] ?? ''}`}>
                          {ORDER_STATUS_LABELS[order.status] ?? order.status}
                        </span>
                        <span className="text-theme-text-primary font-mono text-[15px] font-semibold">
                          {formatCurrency(Number(order.total))}
                        </span>
                      </div>
                    </button>
                  )
                )}
              </div>
            )}
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
              {(reportOrder?.paymentInstructions?.options ?? []).map((option) => (
                <option key={option.method} value={option.method}>
                  {option.label}
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

      <Modal
        isOpen={methodOrder !== null}
        onClose={() => setMethodOrder(null)}
        title="Change payment method"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary btn-md" onClick={() => setMethodOrder(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary btn-md"
              disabled={submitting || !newPaymentMethod}
              onClick={() => void changePaymentMethod()}
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        }
      >
        <div className="modal-body">
          <label htmlFor="new-payment-method" className="form-label">
            Payment method
          </label>
          <select
            id="new-payment-method"
            value={newPaymentMethod}
            onChange={(event) => setNewPaymentMethod(event.target.value)}
            className="form-input"
          >
            <option value="">Select…</option>
            {(methodOrder?.paymentInstructions?.options ?? []).map((option) => (
              <option key={option.method} value={option.method}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </Modal>
    </div>
  );
};

export default MyOrdersPage;
