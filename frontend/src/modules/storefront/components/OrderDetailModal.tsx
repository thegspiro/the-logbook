/**
 * Order Detail Modal (admin)
 *
 * One order: line items, the payment ledger, status advancement, and the
 * member-visible update feed. Payment recording is deliberately separate from
 * status advancement — the money and the goods move on their own schedules.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Ban, CircleDollarSign, MessageSquare, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { useFieldErrors, type FieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatCurrency, formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { storefrontService } from '../services/api';
import { OrderChargeRows, OrderDeliveryDetails } from './OrderDeliveryDetails';
import { ThreadSwatch } from './ThreadSwatch';
import { methodLabel } from '../utils/personalization';
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

// Each section is its own request, and two of them send a key called
// `message` or `reference`, so each has its own set of field errors. The store
// API is camelCase (alias_generator=to_camel); the snake_case names are listed
// in case a refusal reports the attribute rather than the alias.
type PaymentField = 'amount' | 'paymentMethod' | 'reference';
const PAYMENT_FIELDS: FieldSpecs<PaymentField> = {
  amount: { id: 'payment-amount', label: 'Amount' },
  paymentMethod: { id: 'payment-method', label: 'Paid by', apiKeys: ['payment_method'] },
  reference: { id: 'payment-ref', label: 'Reference' },
};
type WaiveField = 'reason';
const WAIVE_FIELDS: FieldSpecs<WaiveField> = {
  reason: { id: 'waive-reason', label: 'Reason' },
};
type StatusField = 'status' | 'message';
const STATUS_FIELDS: FieldSpecs<StatusField> = {
  status: { id: 'status-choice', label: 'Status' },
  message: { id: 'status-message', label: 'Note to the member' },
};
type UpdateField = 'message' | 'channels';
const UPDATE_FIELDS: FieldSpecs<UpdateField> = {
  message: { id: 'update-message', label: 'Message to the member' },
  channels: { id: 'update-in-app', label: 'Notification channels', apiKeys: ['notifyEmail', 'notifyInApp'] },
};
type CancelField = 'reason';
const CANCEL_FIELDS: FieldSpecs<CancelField> = {
  reason: { id: 'cancel-reason', label: 'Reason for cancelling' },
};
type NotesField = 'adminNotes';
const NOTES_FIELDS: FieldSpecs<NotesField> = {
  adminNotes: { id: 'admin-notes', label: 'Internal notes', apiKeys: ['admin_notes'] },
};
// StoreOrderPaymentRecord / StoreOrderMarkPaid: reference max_length=200.
const REFERENCE_MAX = 200;
// The cancel box's existing client limit (W67b-5).
const CANCEL_REASON_MAX = 500;

/** What the payment, status and notes boxes held when the order loaded. */
interface Seeded {
  paymentAmount: string;
  paymentReference: string;
  paymentMethod: string;
  statusChoice: string;
  adminNotes: string;
}

const SectionError: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
      {message}
    </p>
  ) : null;

export const OrderDetailModal: React.FC<OrderDetailModalProps> = ({ orderId, onClose, onChanged }) => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
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
  const [notifyUpdateByEmail, setNotifyUpdateByEmail] = useState(true);
  const [notifyUpdateInApp, setNotifyUpdateInApp] = useState(true);
  const [adminNotes, setAdminNotes] = useState('');
  const [waiveReason, setWaiveReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [seeded, setSeeded] = useState<Seeded | null>(null);

  const paymentErrors = useFieldErrors(PAYMENT_FIELDS);
  const waiveErrors = useFieldErrors(WAIVE_FIELDS);
  const statusErrors = useFieldErrors(STATUS_FIELDS);
  const updateErrors = useFieldErrors(UPDATE_FIELDS);
  const notesErrors = useFieldErrors(NOTES_FIELDS);
  const cancelErrors = useFieldErrors(CANCEL_FIELDS);

  // Anything typed that no request has taken yet: the boxes seeded from the
  // order count once they differ from what loaded, the three that start
  // empty count once they hold text (forms review F-6).
  const isDirty =
    orderId !== null &&
    seeded !== null &&
    (paymentAmount !== seeded.paymentAmount ||
      paymentReference !== seeded.paymentReference ||
      paymentMethod !== seeded.paymentMethod ||
      statusChoice !== seeded.statusChoice ||
      adminNotes !== seeded.adminNotes ||
      statusMessage.trim() !== '' ||
      updateMessage.trim() !== '' ||
      waiveReason.trim() !== '' ||
      cancelReason.trim() !== '');
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const fetched = await storefrontService.getOrder(orderId);
      setOrder(fetched);
      const next: Seeded = {
        paymentAmount: fetched.balanceDue,
        paymentReference: fetched.paymentReference ?? '',
        paymentMethod: fetched.paymentMethod ?? '',
        statusChoice: fetched.status,
        adminNotes: fetched.adminNotes ?? '',
      };
      setPaymentAmount(next.paymentAmount);
      setPaymentReference(next.paymentReference);
      setPaymentMethod(next.paymentMethod);
      setStatusChoice(next.statusChoice);
      setAdminNotes(next.adminNotes);
      setSeeded(next);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not load the order'));
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Run one section's request. The order is reloaded only when it succeeded:
   * reloading after a refusal reseeded the payment boxes and threw away the
   * amount and reference that had just been refused.
   */
  const withBusy = async (action: () => Promise<boolean>) => {
    setBusy(true);
    try {
      if (await action()) {
        await load();
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  };

  /** A refusal goes on the field it names, or in the section that sent it. */
  const refuse = <F extends string>(
    errors: ReturnType<typeof useFieldErrors<F>>,
    err: unknown,
    fallback: string
  ): false => {
    errors.focusFirst(errors.setFromApiError(err, fallback));
    return false;
  };

  const markPaidInFull = () =>
    withBusy(async () => {
      if (!order) return false;
      paymentErrors.clear();
      try {
        await storefrontService.markOrderPaid(order.id, {
          paymentMethod: paymentMethod || undefined,
          reference: paymentReference.trim() || undefined,
          notifyMember: true,
        });
        toast.success('Marked paid in full');
        return true;
      } catch (err: unknown) {
        return refuse(paymentErrors, err, 'Could not mark the order paid');
      }
    });

  const waivePayment = () =>
    withBusy(async () => {
      if (!order) return false;
      waiveErrors.clear();
      try {
        await storefrontService.waiveOrderPayment(order.id, {
          reason: waiveReason.trim() || undefined,
          notifyMember: true,
        });
        setWaiveReason('');
        toast.success('Payment waived');
        return true;
      } catch (err: unknown) {
        return refuse(waiveErrors, err, 'Could not waive the payment');
      }
    });

  const recordPayment = () =>
    withBusy(async () => {
      if (!order) return false;
      paymentErrors.clear();
      const amount = Number(paymentAmount);
      // Named on the field, not in a toast (forms review F-3). Nothing is
      // recorded until it is fixed: a payment is money, and half of one is
      // not a thing to save.
      if (!amount || amount <= 0) {
        const problems: FieldErrors<PaymentField> = { amount: 'Enter an amount greater than zero.' };
        paymentErrors.setErrors(problems);
        paymentErrors.focusFirst(problems);
        return false;
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
        return true;
      } catch (err: unknown) {
        return refuse(paymentErrors, err, 'Could not record the payment');
      }
    });

  const changeStatus = () =>
    withBusy(async () => {
      if (!order) return false;
      statusErrors.clear();
      if (!statusChoice) {
        const problems: FieldErrors<StatusField> = { status: 'Choose a status.' };
        statusErrors.setErrors(problems);
        statusErrors.focusFirst(problems);
        return false;
      }
      try {
        await storefrontService.updateOrderStatus(order.id, {
          status: statusChoice,
          message: statusMessage.trim() || undefined,
          notifyMember: true,
        });
        setStatusMessage('');
        toast.success('Status updated. The member was notified.');
        return true;
      } catch (err: unknown) {
        return refuse(statusErrors, err, 'Could not update the status');
      }
    });

  const postUpdate = () =>
    withBusy(async () => {
      if (!order) return false;
      updateErrors.clear();
      // The button used to sit greyed out until both were answered, without
      // saying which was missing (forms review F-3).
      const problems: FieldErrors<UpdateField> = {};
      if (!updateMessage.trim()) problems.message = 'Write the update to send.';
      if (!notifyUpdateByEmail && !notifyUpdateInApp)
        problems.channels = 'Choose in-app, email or both, so the member hears about it.';
      if (Object.keys(problems).length > 0) {
        updateErrors.setErrors(problems);
        updateErrors.focusFirst(problems);
        return false;
      }
      try {
        await storefrontService.addOrderMessage(order.id, {
          message: updateMessage.trim(),
          isMemberVisible: true,
          notifyMember: notifyUpdateByEmail || notifyUpdateInApp,
          notifyEmail: notifyUpdateByEmail,
          notifyInApp: notifyUpdateInApp,
        });
        setUpdateMessage('');
        toast.success('Update sent');
        return true;
      } catch (err: unknown) {
        return refuse(updateErrors, err, 'Could not send the update');
      }
    });

  const saveNotes = () =>
    withBusy(async () => {
      if (!order) return false;
      notesErrors.clear();
      try {
        await storefrontService.setOrderNotes(order.id, adminNotes.trim() || undefined);
        toast.success('Notes saved');
        return true;
      } catch (err: unknown) {
        return refuse(notesErrors, err, 'Could not save the notes');
      }
    });

  const cancelOrder = async () => {
    if (!order) return;
    cancelErrors.clear();
    const paid = Number(order.amountPaid);
    const reason = cancelReason.trim();
    // Cancelling leaves amount_paid alone, so money already recorded is still
    // held by the department afterwards. Say so before the decision rather
    // than after it (W67b-2).
    const moneyNote =
      paid > 0
        ? ` ${formatCurrency(paid)} has been recorded on this order. Cancelling does not refund it — use Refund to record the money going back.`
        : '';
    const ok = await confirm({
      title: `Cancel ${order.orderNumber}?`,
      message: `The order is cancelled and cannot be reopened, and the member is told${reason ? ' why' : ''}.${moneyNote}`,
      confirmLabel: 'Cancel order',
      cancelLabel: 'Keep order',
      variant: 'danger',
    });
    if (!ok) return;
    await withBusy(async () => {
      try {
        await storefrontService.cancelOrder(order.id, {
          reason: reason || undefined,
          notifyMember: true,
        });
        setCancelReason('');
        toast.success(`${order.orderNumber} cancelled`);
        return true;
      } catch (err: unknown) {
        return refuse(cancelErrors, err, 'Could not cancel the order');
      }
    });
  };

  const refund = () =>
    withBusy(async () => {
      if (!order) return false;
      paymentErrors.clear();
      try {
        await storefrontService.refundOrder(order.id, {
          notifyMember: true,
        });
        toast.success('Refund recorded');
        return true;
      } catch (err: unknown) {
        return refuse(paymentErrors, err, 'Could not record the refund');
      }
    });

  const cancelled = order?.status === StoreOrderStatus.CANCELLED;

  const submitWith =
    (action: () => Promise<void>) =>
    (e: React.FormEvent): void => {
      e.preventDefault();
      void action();
    };

  return (
    <Modal
      isOpen={orderId !== null}
      onClose={requestClose}
      title={order ? `Order ${order.orderNumber}` : 'Order'}
      size="xl"
      footer={
        <div className="flex justify-end">
          <button type="button" className="btn-secondary btn-md" onClick={requestClose}>
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-5">
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
                          <div className="text-theme-text-muted flex items-center gap-1.5 text-xs italic">
                            <span>&ldquo;{item.personalizationText}&rdquo;</span>
                            <span className="not-italic">{methodLabel(item.personalizationMethod)}</span>
                            {item.personalizationThreadColor && (
                              <ThreadSwatch color={item.personalizationThreadColor} />
                            )}
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
              <OrderChargeRows
                order={order}
                termClassName="text-theme-text-muted"
                valueClassName="text-theme-text-primary"
              />
              <div className="flex justify-between">
                <dt className="text-theme-text-muted">Total</dt>
                <dd className="text-theme-text-primary font-medium">{formatCurrency(Number(order.total))}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-theme-text-muted">Paid</dt>
                <dd className="text-theme-text-primary">{formatCurrency(Number(order.amountPaid))}</dd>
              </div>
              {/* Cancelling leaves the balance on the record, but nobody owes it —
                  the same reading My Orders gives the member. */}
              {!cancelled && (
                <div className="flex justify-between">
                  <dt className="text-theme-text-muted">Balance due</dt>
                  <dd className="text-theme-text-primary font-medium">{formatCurrency(Number(order.balanceDue))}</dd>
                </div>
              )}
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

            <section className="card-secondary p-3" aria-label="Delivery">
              <OrderDeliveryDetails order={order} audience="staff" />
            </section>

            {cancelled && (
              <div className="alert-danger text-sm">
                Cancelled{order.cancelledAt ? ` ${formatDateTime(order.cancelledAt, tz)}` : ''}
                {order.cancellationReason ? ` — ${order.cancellationReason}` : ''}.
                {Number(order.amountPaid) > 0 &&
                  ` ${formatCurrency(Number(order.amountPaid))} is still recorded as paid; use Refund to record it going back.`}
              </div>
            )}

            {order.paymentStatus === 'pending_verification' && !cancelled && (
              <div className="alert-warning text-sm">
                The member reported paying
                {order.paymentReference ? ` (ref ${order.paymentReference})` : ''}. Confirm it against the department
                account, then record the payment below.
              </div>
            )}

            {(!cancelled || Number(order.amountPaid) > 0) && (
              <form
                noValidate
                aria-labelledby="order-payment-heading"
                onSubmit={submitWith(recordPayment)}
                className="card-secondary space-y-3 p-3"
              >
                <h3
                  id="order-payment-heading"
                  className="text-theme-text-primary flex items-center gap-2 text-sm font-semibold"
                >
                  <CircleDollarSign className="h-4 w-4" aria-hidden="true" />
                  Payment
                </h3>

                {/* The server refuses a payment on a cancelled order; only the
                    refund of what was already taken still applies. */}
                {Number(order.balanceDue) > 0 && !cancelled && (
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
                <SectionError message={paymentErrors.formError} />
                {!cancelled && (
                  <div className="flex flex-wrap items-start gap-2">
                    <FormField
                      id={PAYMENT_FIELDS.amount.id}
                      label="Amount"
                      labelClassName="form-label-sm"
                      error={paymentErrors.errors.amount}
                    >
                      {(field) => (
                        <input
                          {...field}
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          value={paymentAmount}
                          onChange={(e) => {
                            setPaymentAmount(e.target.value);
                            paymentErrors.setError('amount', null);
                          }}
                          className="form-input-sm w-28"
                        />
                      )}
                    </FormField>
                    <FormField
                      id={PAYMENT_FIELDS.paymentMethod.id}
                      label="Paid by"
                      labelClassName="form-label-sm"
                      error={paymentErrors.errors.paymentMethod}
                    >
                      {(field) => (
                        <select
                          {...field}
                          value={paymentMethod}
                          onChange={(e) => {
                            setPaymentMethod(e.target.value);
                            paymentErrors.setError('paymentMethod', null);
                          }}
                          className="form-input-sm"
                        >
                          <option value="">Not recorded</option>
                          {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      )}
                    </FormField>
                    <FormField
                      id={PAYMENT_FIELDS.reference.id}
                      label="Reference"
                      labelClassName="form-label-sm"
                      error={paymentErrors.errors.reference}
                      maxLength={REFERENCE_MAX}
                      count={paymentReference.length}
                      className="min-w-[10rem] flex-1"
                    >
                      {(field) => (
                        <input
                          {...field}
                          type="text"
                          value={paymentReference}
                          onChange={(e) => {
                            setPaymentReference(e.target.value);
                            paymentErrors.setError('reference', null);
                          }}
                          className="form-input-sm"
                        />
                      )}
                    </FormField>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {!cancelled && (
                    <button type="submit" className="btn-success btn-md" disabled={busy}>
                      Record payment
                    </button>
                  )}
                  {Number(order.amountPaid) > 0 && (
                    <button
                      type="button"
                      className="btn-secondary btn-md"
                      disabled={busy}
                      onClick={() => {
                        void refund();
                      }}
                    >
                      <Undo2 className="h-4 w-4" aria-hidden="true" />
                      Refund
                    </button>
                  )}
                </div>
              </form>
            )}

            {order.paymentStatus !== 'waived' && Number(order.balanceDue) > 0 && !cancelled && (
              <form
                noValidate
                aria-labelledby="order-waive-heading"
                onSubmit={submitWith(waivePayment)}
                className="card-secondary space-y-2 p-3"
              >
                <h3 id="order-waive-heading" className="text-theme-text-primary text-sm font-semibold">
                  Waive payment
                </h3>
                <p className="text-theme-text-muted text-xs">
                  Settles the balance without collecting money. The window&apos;s collected total does not change.
                </p>
                <SectionError message={waiveErrors.formError} />
                <div className="flex flex-wrap items-end gap-2">
                  <FormField
                    id={WAIVE_FIELDS.reason.id}
                    label="Reason (shown to the member)"
                    labelClassName="form-label-sm"
                    error={waiveErrors.errors.reason}
                    className="min-w-[12rem] flex-1"
                  >
                    {(field) => (
                      <input
                        {...field}
                        type="text"
                        value={waiveReason}
                        onChange={(e) => {
                          setWaiveReason(e.target.value);
                          waiveErrors.setError('reason', null);
                        }}
                        className="form-input-sm"
                        placeholder="Comped — 25 years of service"
                      />
                    )}
                  </FormField>
                  <button type="submit" className="btn-secondary btn-md" disabled={busy}>
                    Waive payment
                  </button>
                </div>
              </form>
            )}

            {!cancelled && (
              <form
                noValidate
                aria-labelledby="order-status-heading"
                onSubmit={submitWith(changeStatus)}
                className="card-secondary space-y-3 p-3"
              >
                <h3 id="order-status-heading" className="text-theme-text-primary text-sm font-semibold">
                  Change status
                </h3>
                <SectionError message={statusErrors.formError} />
                <div className="flex flex-wrap items-end gap-2">
                  <FormField
                    id={STATUS_FIELDS.status.id}
                    label="Status"
                    labelClassName="form-label-sm"
                    error={statusErrors.errors.status}
                  >
                    {(field) => (
                      <select
                        {...field}
                        value={statusChoice}
                        onChange={(e) => {
                          setStatusChoice(e.target.value);
                          statusErrors.setError('status', null);
                        }}
                        className="form-input-sm"
                      >
                        {ADVANCEABLE_STATUSES.map((value) => (
                          <option key={value} value={value}>
                            {ORDER_STATUS_LABELS[value] ?? value}
                          </option>
                        ))}
                      </select>
                    )}
                  </FormField>
                  <FormField
                    id={STATUS_FIELDS.message.id}
                    label="Note to the member"
                    optional
                    labelClassName="form-label-sm"
                    error={statusErrors.errors.message}
                    className="min-w-[12rem] flex-1"
                  >
                    {(field) => (
                      <input
                        {...field}
                        type="text"
                        value={statusMessage}
                        onChange={(e) => {
                          setStatusMessage(e.target.value);
                          statusErrors.setError('message', null);
                        }}
                        className="form-input-sm"
                      />
                    )}
                  </FormField>
                  <button type="submit" className="btn-primary btn-md" disabled={busy}>
                    Update status
                  </button>
                </div>
              </form>
            )}

            <form
              noValidate
              aria-labelledby="order-update-heading"
              onSubmit={submitWith(postUpdate)}
              className="card-secondary space-y-3 p-3"
            >
              <h3
                id="order-update-heading"
                className="text-theme-text-primary flex items-center gap-2 text-sm font-semibold"
              >
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
                Send an update
              </h3>
              <SectionError message={updateErrors.formError} />
              <FormField
                id={UPDATE_FIELDS.message.id}
                label="Message to the member"
                labelClassName="sr-only"
                error={updateErrors.errors.message}
              >
                {(field) => (
                  <textarea
                    {...field}
                    rows={2}
                    value={updateMessage}
                    onChange={(e) => {
                      setUpdateMessage(e.target.value);
                      updateErrors.setError('message', null);
                    }}
                    className="form-input"
                    placeholder="Your shirt came in a size large by mistake — swap available."
                  />
                )}
              </FormField>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <fieldset
                  className="min-w-0"
                  {...(updateErrors.errors.channels ? { 'aria-describedby': 'update-channels-error' } : {})}
                >
                  <legend className="sr-only">Notification channels</legend>
                  <div className="flex flex-wrap gap-4">
                    <label className="text-theme-text-secondary touch:min-h-11 flex items-center gap-2 text-sm">
                      <input
                        id={UPDATE_FIELDS.channels.id}
                        type="checkbox"
                        className="form-checkbox"
                        checked={notifyUpdateInApp}
                        {...(updateErrors.errors.channels ? { 'aria-invalid': true as const } : {})}
                        onChange={(event) => {
                          setNotifyUpdateInApp(event.target.checked);
                          updateErrors.setError('channels', null);
                        }}
                      />
                      In-app notification
                    </label>
                    <label className="text-theme-text-secondary touch:min-h-11 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="form-checkbox"
                        checked={notifyUpdateByEmail}
                        {...(updateErrors.errors.channels ? { 'aria-invalid': true as const } : {})}
                        onChange={(event) => {
                          setNotifyUpdateByEmail(event.target.checked);
                          updateErrors.setError('channels', null);
                        }}
                      />
                      Email
                    </label>
                  </div>
                  {updateErrors.errors.channels && (
                    <p id="update-channels-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                      {updateErrors.errors.channels}
                    </p>
                  )}
                </fieldset>
                <button type="submit" className="btn-secondary btn-md" disabled={busy}>
                  Send update
                </button>
              </div>
            </form>

            <form noValidate onSubmit={submitWith(saveNotes)}>
              <SectionError message={notesErrors.formError} />
              <FormField id={NOTES_FIELDS.adminNotes.id} label="Internal notes" error={notesErrors.errors.adminNotes}>
                {(field) => (
                  <textarea
                    {...field}
                    rows={2}
                    value={adminNotes}
                    onChange={(e) => {
                      setAdminNotes(e.target.value);
                      notesErrors.setError('adminNotes', null);
                    }}
                    className="form-input"
                  />
                )}
              </FormField>
              <div className="mt-2 flex justify-end">
                <button type="submit" className="btn-secondary btn-sm" disabled={busy}>
                  Save notes
                </button>
              </div>
            </form>

            {!cancelled && (
              <form
                noValidate
                aria-labelledby="order-cancel-heading"
                onSubmit={submitWith(cancelOrder)}
                className="card-secondary space-y-2 p-3"
              >
                <h3
                  id="order-cancel-heading"
                  className="text-theme-text-primary flex items-center gap-2 text-sm font-semibold"
                >
                  <Ban className="h-4 w-4" aria-hidden="true" />
                  Cancel order
                </h3>
                <p className="text-theme-text-muted text-xs">
                  For an order that will not be filled. It cannot be reopened, and the member is emailed.
                </p>
                <SectionError message={cancelErrors.formError} />
                <div className="flex flex-wrap items-end gap-2">
                  <FormField
                    id={CANCEL_FIELDS.reason.id}
                    label="Reason for cancelling (shown to the member)"
                    labelClassName="form-label-sm"
                    error={cancelErrors.errors.reason}
                    maxLength={CANCEL_REASON_MAX}
                    count={cancelReason.length}
                    className="min-w-[12rem] flex-1"
                  >
                    {(field) => (
                      <input
                        {...field}
                        type="text"
                        value={cancelReason}
                        onChange={(e) => {
                          setCancelReason(e.target.value);
                          cancelErrors.setError('reason', null);
                        }}
                        className="form-input-sm"
                        placeholder="The vendor discontinued this item"
                      />
                    )}
                  </FormField>
                  <button
                    type="submit"
                    className="btn-secondary btn-md"
                    disabled={busy}
                    aria-label={`Cancel ${order.orderNumber}`}
                  >
                    Cancel order
                  </button>
                </div>
              </form>
            )}

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
