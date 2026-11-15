/**
 * Order Delivery Details
 *
 * How an order reaches the member — pickup or shipping, the address, and the
 * member's own notes — plus the charge lines behind its total. The admin order
 * dialog and the member's My Orders card both render these, so the person
 * packing a shipped order and the member who placed it read the same facts
 * (W67b-3: until this, both were captured at checkout and shown nowhere).
 */

import React from 'react';
import { MapPin, Truck } from 'lucide-react';
import { formatCurrency } from '../../../utils/dateFormatting';
import { StoreFulfillmentMethod, type StoreOrder } from '../types';

type DeliveryOrder = Pick<StoreOrder, 'fulfillmentMethod' | 'shippingAddress' | 'memberNotes'>;

/** Who is reading: staff read about "the member", the member reads about themselves. */
type Audience = 'staff' | 'member';

const LABELS: Record<Audience, { ship: string; notes: string }> = {
  // "Ship to me" is the wording of the tile the member chose at checkout.
  member: { ship: 'Ship to me', notes: 'Your notes' },
  staff: { ship: 'Ship to the member', notes: "Member's notes" },
};

interface OrderDeliveryDetailsProps {
  order: DeliveryOrder;
  audience: Audience;
}

export const OrderDeliveryDetails: React.FC<OrderDeliveryDetailsProps> = ({ order, audience }) => {
  const labels = LABELS[audience];
  const shipping = order.fulfillmentMethod === StoreFulfillmentMethod.SHIP;
  const Icon = shipping ? Truck : MapPin;
  // The address is shown only for a shipped order. A member who typed one and
  // then switched back to pickup can still have it stored (W67b-9), and an
  // address beside "Pick up" reads as an instruction to ship.
  const address = shipping ? order.shippingAddress?.trim() : undefined;
  const notes = order.memberNotes?.trim();

  return (
    <dl className="flex flex-col gap-2 text-sm">
      <div>
        <dt className="text-theme-text-secondary text-xs">Delivery</dt>
        <dd className="text-theme-text-primary mt-0.5 flex items-center gap-1.5 font-medium">
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          {shipping ? labels.ship : 'Pick up'}
        </dd>
      </div>
      {shipping && (
        <div>
          <dt className="text-theme-text-secondary text-xs">Ship to</dt>
          <dd className="text-theme-text-primary mt-0.5 break-words whitespace-pre-line">
            {address || 'No address given'}
          </dd>
        </div>
      )}
      {notes && (
        <div>
          <dt className="text-theme-text-secondary text-xs">{labels.notes}</dt>
          <dd className="text-theme-text-primary mt-0.5 break-words whitespace-pre-line">{notes}</dd>
        </div>
      )}
    </dl>
  );
};

type ChargeOrder = Pick<StoreOrder, 'subtotal' | 'taxAmount' | 'shippingAmount' | 'discountAmount'>;

interface OrderChargeRowsProps {
  order: ChargeOrder;
  /** Classes for each row's term and value, so the rows match the list they sit in. */
  termClassName: string;
  valueClassName: string;
}

/**
 * The subtotal, tax, shipping and discount lines that make up an order total.
 * Renders nothing when the total is the subtotal alone: a "Subtotal" row equal
 * to the "Total" row beneath it explains nothing.
 */
export const OrderChargeRows: React.FC<OrderChargeRowsProps> = ({ order, termClassName, valueClassName }) => {
  const tax = Number(order.taxAmount);
  const shipping = Number(order.shippingAmount);
  const discount = Number(order.discountAmount);
  if (tax <= 0 && shipping <= 0 && discount <= 0) return null;

  const rows: { label: string; value: string }[] = [
    { label: 'Subtotal', value: formatCurrency(Number(order.subtotal)) },
  ];
  if (tax > 0) rows.push({ label: 'Tax', value: formatCurrency(tax) });
  if (shipping > 0) rows.push({ label: 'Shipping', value: formatCurrency(shipping) });
  if (discount > 0) rows.push({ label: 'Discount', value: `−${formatCurrency(discount)}` });

  return (
    <>
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between">
          <dt className={termClassName}>{row.label}</dt>
          <dd className={valueClassName}>{row.value}</dd>
        </div>
      ))}
    </>
  );
};
