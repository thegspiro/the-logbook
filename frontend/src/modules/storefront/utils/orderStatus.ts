/**
 * Order Status Labels
 *
 * What an order's status is called, for that order. A shipped order goes
 * through the same statuses as one collected at the station, but "Ready for
 * pickup" tells a member who chose shipping to come in (W67b-18, owner
 * decision 2026-11-17). Only the wording changes; the status values are the
 * same. The backend's `_status_label` gives the same wording to the
 * status-change email and the order timeline.
 *
 * Lists that mix pickup and shipped orders (filters, counts) keep the
 * general `ORDER_STATUS_LABELS`, since no one delivery method applies.
 */

import { ORDER_STATUS_LABELS, StoreFulfillmentMethod } from '../types';

const SHIPPED_STATUS_LABELS: Record<string, string> = {
  ready_for_pickup: 'Ready to ship',
  fulfilled: 'Shipped',
};

export function orderStatusLabel(status: string, fulfillmentMethod: string | null | undefined): string {
  if (fulfillmentMethod === StoreFulfillmentMethod.SHIP) {
    const shipped = SHIPPED_STATUS_LABELS[status];
    if (shipped) return shipped;
  }
  return ORDER_STATUS_LABELS[status] ?? status;
}
