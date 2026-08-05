/**
 * Order Detail Modal (admin)
 *
 * One order: line items, the payment ledger, status advancement, and the
 * member-visible update feed. Payment recording is deliberately separate from
 * status advancement — the money and the goods move on their own schedules.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { CircleDollarSign, MessageSquare, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { useTimezone } from '../../../hooks/useTimezone';
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
} from '../types';

interface OrderDetailModalProps {
  orderId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

const ADVANCEABLE_STATUSES: string[] = [
  StoreOrderStatus.AWAITING_PAYMENT,
  StoreOrderStatus.PAID,
  StoreOrderStatus.ORDERED,
  StoreOrderStatus.READY_FOR_PICKUP,
  StoreOrderStatus.FULFILLED,
];

export const OrderDetailModal: React.FC<OrderDetailModalProps> = ({ orderId, onClose, onChanged }) => {
  const tz = useTimezone();
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  // The member picked a method at checkout; what they actually handed over can
  // differ — they chose Venmo and then paid cash at drill. Recording the real
  // one is the whole point of this field.
  const [paymentMethod, setPaymentMethod] = useState('');
  const [statusChoice, setStatusChoice] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [updateMessage, setUpdateMessage] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [waiveReason, setWaiveReason] = useState('');

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const fetched = await storefrontService.getOrder(orderId);
      setOrder(fetched);
      setPaymentAmount(fetched.balanceDue);
      setPaymentReference(fetched.paymentReference ?? '');
      setPaymentMethod(fetched.paymentMethod ?? '');
      setStatusChoice(fetched.status);
      setAdminNotes(fetched.adminNotes ?? '');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not load the order'));
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const markPaidInFull = () =>
    withBusy(async () => {
      if (!order) return;
      try {
        await storefrontService.markOrderPaid(order.id, {
          paymentMethod: paymentMethod || undefined,
          reference: paymentReference.trim() || undefined,
          notifyMember: true,
        });
        toast.success('Marked paid in full');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not mark the order paid'));
      }
    });

  const waivePayment = () =>
    withBusy(async () => {
      if (!order) return;
      try {
        await storefrontService.waiveOrderPayment(order.id, {
          reason: waiveReason.trim() || undefined,
          notifyMember: true,
        });
        setWaiveReason('');
        toast.success('Payment waived');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not waive the payment'));
      }
    });

  const recordPayment = () =>
    withBusy(async () => {
      if (!order) return;
      const amount = Number(paymentAmount);
      if (!amount || amount <= 0) {
        toast.error('Enter an amount greater than zero');
        return;
      }
      try {
        await storefrontService.recordPayment(order.id, {
          amount,
          paymentMethod: paymentMethod || undefined,
          reference: paymentReference.trim() || undefined,
          markPaid: true,
          notifyMember: true,
        });
        toast.success('Payment recorded');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not record the payment'));
      }
    });

  const changeStatus = () =>
    withBusy(async () => {
      if (!order || !statusChoice) return;
      try {
        await storefrontService.updateOrderStatus(order.id, {
          status: statusChoice,
          message: statusMessage.trim() || undefined,
          notifyMember: true,
        });
        setStatusMessage('');
        toast.success('Status updated and the member notified');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not update the status'));
      }
    });

  const postUpdate = () =>
    withBusy(async () => {
      if (!order || !updateMessage.trim()) return;
      try {
        await storefrontService.addOrderMessage(order.id, {
          message: updateMessage.trim(),
          isMemberVisible: true,
          notifyMember: true,
        });
        setUpdateMessage('');
        toast.success('Update sent');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not send the update'));
      }
    });

  const saveNotes = () =>
    withBusy(async () => {
      if (!order) return;
      try {
        await storefrontService.setOrderNotes(order.id, adminNotes.trim() || undefined);
        toast.success('Notes saved');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not save the notes'));
      }
    });

  const refund = () =>
    withBusy(async () => {
      if (!order) return;
      try {
        await storefrontService.refundOrder(order.id, {
          notifyMember: true,
        });
        toast.success('Refund recorded');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not record the refund'));
      }
    });

  return (
    <Modal
      isOpen={orderId !== null}
      onClose={onClose}
      title={order ? `Order ${order.orderNumber}` : 'Order'}
      size="xl"
      footer={
        <div className="flex justify-end">
          <button type="button" className="btn-secondary btn-md" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <div className="modal-body space-y-5">
        {loading || !order ? (
          <p className="text-theme-text-muted text-sm">Loading…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-theme-text-primary text-sm font-semibold">{order.customerName}</p>
                <p className="text-theme-text-muted text-xs">
                  {order.customerEmail} · {order.windowName ?? 'No window'} · {formatDateTime(order.submittedAt, tz)}
                </p>
              </div>
              <div className="flex gap-2">
                <span className={`badge ${ORDER_STATUS_BADGES[order.status] ?? ''}`}>
                  {ORDER_STATUS_LABELS[order.status] ?? order.status}
                </span>
                <span className={`badge ${PAYMENT_STATUS_BADGES[order.paymentStatus] ?? ''}`}>
                  {PAYMENT_STATUS_LABELS[order.paymentStatus] ?? order.paymentStatus}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-theme-text-muted text-left">
                    <th className="py-1 pr-2 font-medium">Item</th>
                    <th className="px-2 py-1 text-center font-medium">Qty</th>
                    <th className="px-2 py-1 text-right font-medium">Price</th>
                    <th className="py-1 pl-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id} className="border-theme-surface-border border-t">
                      <td className="text-theme-text-primary py-1.5 pr-2">
                        {item.productName}
                        {item.variantLabel && <span className="text-theme-text-muted"> — {item.variantLabel}</span>}
                        {item.personalizationText && (
                          <div className="text-theme-text-muted text-xs italic">
                            &ldquo;{item.personalizationText}&rdquo;
                          </div>
                        )}
                      </td>
                      <td className="text-theme-text-secondary px-2 py-1.5 text-center">{item.quantity}</td>
                      <td className="text-theme-text-secondary px-2 py-1.5 text-right">
                        {formatCurrency(Number(item.unitPrice))}
                      </td>
                      <td className="text-theme-text-primary py-1.5 pl-2 text-right">
                        {formatCurrency(Number(item.lineTotal))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="border-theme-surface-border space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-theme-text-muted">Total</dt>
                <dd className="text-theme-text-primary font-medium">{formatCurrency(Number(order.total))}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-theme-text-muted">Paid</dt>
                <dd className="text-theme-text-primary">{formatCurrency(Number(order.amountPaid))}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-theme-text-muted">Balance due</dt>
                <dd className="text-theme-text-primary font-medium">{formatCurrency(Number(order.balanceDue))}</dd>
              </div>
              {order.paymentMethod && (
                <div className="flex justify-between">
                  <dt className="text-theme-text-muted">Method</dt>
                  <dd className="text-theme-text-primary">
                    {PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}
                  </dd>
                </div>
              )}
              {order.paymentReference && (
                <div className="flex justify-between">
                  <dt className="text-theme-text-muted">Reference</dt>
                  <dd className="text-theme-text-primary">{order.paymentReference}</dd>
                </div>
              )}
            </dl>

            {order.paymentStatus === 'pending_verification' && (
              <div className="alert-warning text-sm">
                The member reported paying
                {order.paymentReference ? ` (ref ${order.paymentReference})` : ''}. Confirm it against the department
                account, then record the payment below.
              </div>
            )}

            <section className="card-secondary space-y-3 p-3">
              <h3 className="text-theme-text-primary flex items-center gap-2 text-sm font-semibold">
                <CircleDollarSign className="h-4 w-4" />
                Payment
              </h3>

              {Number(order.balanceDue) > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn-success btn-md"
                    disabled={busy}
                    onClick={() => {
                      void markPaidInFull();
                    }}
                  >
                    Mark paid in full ({formatCurrency(Number(order.balanceDue))})
                  </button>
                  <span className="text-theme-text-muted text-xs">or record a partial amount below</span>
                </div>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label htmlFor="payment-amount" className="form-label-sm">
                    Amount
                  </label>
                  <input
                    id="payment-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className="form-input-sm w-28"
                  />
                </div>
                <div>
                  <label htmlFor="payment-method" className="form-label-sm">
                    Paid by
                  </label>
                  <select
                    id="payment-method"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="form-input-sm"
                  >
                    <option value="">Not recorded</option>
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[10rem] flex-1">
                  <label htmlFor="payment-ref" className="form-label-sm">
                    Reference
                  </label>
                  <input
                    id="payment-ref"
                    type="text"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    className="form-input-sm"
                  />
                </div>
                <button
                  type="button"
                  className="btn-success btn-md"
                  disabled={busy}
                  onClick={() => {
                    void recordPayment();
                  }}
                >
                  Record
                </button>
                {Number(order.amountPaid) > 0 && (
                  <button
                    type="button"
                    className="btn-secondary btn-md"
                    disabled={busy}
                    onClick={() => {
                      void refund();
                    }}
                  >
                    <Undo2 className="h-4 w-4" />
                    Refund
                  </button>
                )}
              </div>
            </section>

            {order.paymentStatus !== 'waived' && Number(order.balanceDue) > 0 && (
              <section className="card-secondary space-y-2 p-3">
                <h3 className="text-theme-text-primary text-sm font-semibold">Waive payment</h3>
                <p className="text-theme-text-muted text-xs">
                  Clears the order without collecting. No money is recorded, so the window&apos;s collected total is
                  unaffected.
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[12rem] flex-1">
                    <label htmlFor="waive-reason" className="form-label-sm">
                      Reason (shown to the member)
                    </label>
                    <input
                      id="waive-reason"
                      type="text"
                      value={waiveReason}
                      onChange={(e) => setWaiveReason(e.target.value)}
                      className="form-input-sm"
                      placeholder="Comped — 25 years of service"
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-secondary btn-md"
                    disabled={busy}
                    onClick={() => {
                      void waivePayment();
                    }}
                  >
                    Waive
                  </button>
                </div>
              </section>
            )}

            <section className="card-secondary space-y-3 p-3">
              <h3 className="text-theme-text-primary text-sm font-semibold">Advance the order</h3>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label htmlFor="status-choice" className="form-label-sm">
                    Status
                  </label>
                  <select
                    id="status-choice"
                    value={statusChoice}
                    onChange={(e) => setStatusChoice(e.target.value)}
                    className="form-input-sm"
                  >
                    {ADVANCEABLE_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {ORDER_STATUS_LABELS[value] ?? value}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[12rem] flex-1">
                  <label htmlFor="status-message" className="form-label-sm">
                    Note to the member (optional)
                  </label>
                  <input
                    id="status-message"
                    type="text"
                    value={statusMessage}
                    onChange={(e) => setStatusMessage(e.target.value)}
                    className="form-input-sm"
                  />
                </div>
                <button
                  type="button"
                  className="btn-primary btn-md"
                  disabled={busy}
                  onClick={() => {
                    void changeStatus();
                  }}
                >
                  Update
                </button>
              </div>
            </section>

            <section className="card-secondary space-y-3 p-3">
              <h3 className="text-theme-text-primary flex items-center gap-2 text-sm font-semibold">
                <MessageSquare className="h-4 w-4" />
                Send an update
              </h3>
              <textarea
                rows={2}
                value={updateMessage}
                onChange={(e) => setUpdateMessage(e.target.value)}
                className="form-input"
                aria-label="Message to the member"
                placeholder="Your shirt came in a size large by mistake — swap available."
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn-secondary btn-md"
                  disabled={busy || !updateMessage.trim()}
                  onClick={() => {
                    void postUpdate();
                  }}
                >
                  Send
                </button>
              </div>
            </section>

            <section>
              <label htmlFor="admin-notes" className="form-label">
                Internal notes
              </label>
              <textarea
                id="admin-notes"
                rows={2}
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                className="form-input"
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => {
                    void saveNotes();
                  }}
                >
                  Save notes
                </button>
              </div>
            </section>

            {order.events.length > 0 && (
              <section>
                <h3 className="text-theme-text-primary mb-2 text-sm font-semibold">Timeline</h3>
                <ol className="space-y-1.5">
                  {order.events.map((event) => (
                    <li key={event.id} className="text-xs">
                      <span className="text-theme-text-muted">{formatDateTime(event.createdAt, tz)}</span>
                      <span className="text-theme-text-secondary">
                        {' — '}
                        {event.message}
                      </span>
                      {!event.isMemberVisible && <span className="text-theme-text-muted"> (internal)</span>}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
