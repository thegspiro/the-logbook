/**
 * How many units of an item are actually on the shelf.
 *
 * `quantity` and stock lots are two ledgers and only one of them is live for
 * any given item: once an item has any lot, receiving writes to the lots, the
 * equipment-check swap consumes from them, and pool issuance draws from them —
 * while `quantity` is maintained by nothing and keeps whatever number it held
 * the day the item crossed over.
 *
 * So a screen that reads `quantity` alone reports a consumable received as a
 * five-unit lot as out of stock: it is hidden from the bulk-issuance picker,
 * capped at zero in the issue dialog, and blocks immediate fulfilment of an
 * equipment request — for stock `issue_from_pool` will happily dispense.
 */
import type { InventoryItem } from '../types';

export function onHandQuantity(item: Pick<InventoryItem, 'quantity' | 'lot_stock' | 'is_lot_stocked'>): number {
  return item.is_lot_stocked ? (item.lot_stock ?? 0) : (item.quantity ?? 0);
}
