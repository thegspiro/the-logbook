/**
 * Order Status Stepper
 *
 * Where an order has got to, as four fixed stops rather than two status badges
 * a member has to translate. The badges said "Awaiting payment / Unpaid";
 * neither said what happens next or how many stops are left.
 *
 * A cancelled order gets no stepper: it did not stop somewhere along this
 * track, it left it.
 */

import React from 'react';
import { Check, CircleDollarSign, PackageCheck, Send, Truck, XCircle } from 'lucide-react';
import { StoreOrderStatus, StorePaymentStatus, type StoreOrder } from '../types';

type StepState = 'complete' | 'current' | 'pending';

interface Step {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STEPS: Step[] = [
  { key: 'submitted', label: 'Submitted', icon: Send },
  { key: 'payment', label: 'Payment due', icon: CircleDollarSign },
  { key: 'ordered', label: 'Ordered', icon: Truck },
  { key: 'ready', label: 'Ready for pickup', icon: PackageCheck },
];

/** Payment statuses that leave nothing owed. */
const SETTLED_PAYMENT: string[] = [StorePaymentStatus.PAID, StorePaymentStatus.WAIVED, StorePaymentStatus.REFUNDED];

/** Fulfilment statuses at or past the vendor order. */
const ORDERED_ONWARD: string[] = [
  StoreOrderStatus.ORDERED,
  StoreOrderStatus.READY_FOR_PICKUP,
  StoreOrderStatus.FULFILLED,
];

/** Fulfilment statuses at or past "on the shelf waiting for you". */
const READY_ONWARD: string[] = [StoreOrderStatus.READY_FOR_PICKUP, StoreOrderStatus.FULFILLED];

/**
 * Whether one stop is done — asked of each stop independently, because payment
 * and fulfilment genuinely advance on separate tracks.
 *
 * Under a `none` or `before_pickup` policy the backend lets an unpaid order
 * reach `ordered` and `ready_for_pickup`. Treating the track as one linear
 * count therefore marked the payment stop complete on the strength of
 * fulfilment alone, and the card said "Paid" directly above an Unpaid badge
 * and a balance-due demand. Fulfilment progress is not evidence of payment.
 */
const isStepComplete = (order: Pick<StoreOrder, 'status' | 'paymentStatus'>, key: string): boolean => {
  switch (key) {
    case 'submitted':
      return true;
    case 'payment':
      return SETTLED_PAYMENT.includes(order.paymentStatus);
    case 'ordered':
      return ORDERED_ONWARD.includes(order.status);
    case 'ready':
      return READY_ONWARD.includes(order.status);
    default:
      return false;
  }
};

/** What a finished payment stop should say. "Paid" is a claim about the member
 *  having paid, so a waived or refunded order must not make it. */
const SETTLED_LABEL: Record<string, string> = {
  [StorePaymentStatus.PAID]: 'Paid',
  [StorePaymentStatus.WAIVED]: 'Waived',
  [StorePaymentStatus.REFUNDED]: 'Refunded',
};

export const OrderStatusStepper: React.FC<{ order: StoreOrder }> = ({ order }) => {
  if (order.status === StoreOrderStatus.CANCELLED) {
    return (
      <p className="text-theme-text-secondary flex items-center gap-2 text-sm">
        <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        Cancelled
      </p>
    );
  }

  const complete = STEPS.map((step) => isStepComplete(order, step.key));
  // Exactly one stop is "current": the earliest one still outstanding. A later
  // stop may already be complete — that is the point of asking each separately.
  const currentIndex = complete.indexOf(false);

  const stateOf = (index: number): StepState =>
    complete[index] ? 'complete' : index === currentIndex ? 'current' : 'pending';

  const circleClass = (state: StepState) =>
    state === 'complete'
      ? 'bg-emerald-600 text-white'
      : state === 'current'
        ? 'bg-theme-surface border-2 border-amber-600 text-amber-900 dark:text-amber-200'
        : 'bg-theme-surface-hover text-theme-text-muted';

  const labelClass = (state: StepState) =>
    state === 'current'
      ? 'font-semibold text-amber-900 dark:text-amber-200'
      : state === 'complete'
        ? 'text-theme-text-primary font-semibold'
        : 'text-theme-text-secondary';

  return (
    // Vertical on a phone, horizontal from sm up: four labels across a 390px
    // screen truncate to the point of being unreadable.
    <ol aria-label="Order progress" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-0">
      {STEPS.map((step, index) => {
        const state = stateOf(index);
        const Icon = state === 'complete' ? Check : step.icon;
        // "Payment due" is a demand, not a milestone — once it is met the stop
        // has to stop demanding, or a paid-up member reads the card as a bill.
        const label =
          step.key === 'payment' && state === 'complete'
            ? (SETTLED_LABEL[order.paymentStatus] ?? 'Settled')
            : step.label;
        return (
          <React.Fragment key={step.key}>
            {index > 0 && (
              <li aria-hidden="true" className="bg-theme-surface-border hidden h-0.5 flex-1 sm:mb-[22px] sm:block" />
            )}
            <li
              className="flex items-center gap-2.5 sm:flex-1 sm:flex-col sm:gap-1.5"
              {...(state === 'current' ? { 'aria-current': 'step' as const } : {})}
            >
              <span
                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full sm:h-7 sm:w-7 ${circleClass(state)}`}
              >
                <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
              </span>
              <span className={`text-sm sm:text-xs ${labelClass(state)}`}>{label}</span>
            </li>
          </React.Fragment>
        );
      })}
    </ol>
  );
};

export default OrderStatusStepper;
