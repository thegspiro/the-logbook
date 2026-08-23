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

/**
 * How far along the track an order is, as the index of the first step that is
 * not yet done.
 *
 * Payment and fulfilment advance independently — a department may run no
 * payment gate at all, so an order can be `ordered` while still unpaid. The
 * fulfilment status is therefore the authority on the last two stops, and
 * payment only decides whether stop 2 is done.
 */
const orderStepIndex = (order: Pick<StoreOrder, 'status' | 'paymentStatus'>): number => {
  if (order.status === StoreOrderStatus.FULFILLED) return STEPS.length;
  if (order.status === StoreOrderStatus.READY_FOR_PICKUP) return 3;
  if (order.status === StoreOrderStatus.ORDERED) return 2;

  const settled: string[] = [StorePaymentStatus.PAID, StorePaymentStatus.WAIVED, StorePaymentStatus.REFUNDED];
  return settled.includes(order.paymentStatus) ? 2 : 1;
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

  const reached = orderStepIndex(order);

  const stateOf = (index: number): StepState =>
    index < reached ? 'complete' : index === reached ? 'current' : 'pending';

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
        const label = step.key === 'payment' && state === 'complete' ? 'Paid' : step.label;
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
