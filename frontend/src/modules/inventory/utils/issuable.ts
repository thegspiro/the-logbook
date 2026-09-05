/**
 * How many units of an item can actually be handed to a member today.
 *
 * Distinct from `onHandQuantity`, which answers "what is on the shelf". A unit
 * can be on the shelf and still be unissuable: `issue_from_pool` refuses an
 * item that is in maintenance, lost or stolen, or whose condition is poor,
 * damaged, out of service or retired. Counting those advertises stock the
 * fulfilment then rejects — which on the review screen offered a quartermaster
 * an "Approve & fulfill now" that could only fail.
 *
 * The two sets mirror `_UNISSUABLE_STATUSES` and `_UNISSUABLE_CONDITIONS` in
 * `app/services/inventory_service.py`, which is the gate that actually decides.
 * Keep them in step: the backend is authoritative and this exists so the screen
 * does not offer an action the API will refuse.
 */
import type { InventoryItem } from '../types';
import { onHandQuantity } from './onHand';

const UNISSUABLE_STATUSES = new Set(['in_maintenance', 'retired', 'lost', 'stolen']);
const UNISSUABLE_CONDITIONS = new Set(['poor', 'damaged', 'out_of_service', 'retired']);

type IssuableItem = Pick<
  InventoryItem,
  'quantity' | 'lot_stock' | 'is_lot_stocked' | 'status' | 'condition' | 'tracking_type'
>;

export function isIssuable(item: Pick<IssuableItem, 'status' | 'condition'>): boolean {
  return !UNISSUABLE_STATUSES.has(item.status) && !UNISSUABLE_CONDITIONS.has(item.condition);
}

export function issuableQuantity(item: IssuableItem): number {
  if (!isIssuable(item)) return 0;
  if (item.tracking_type === 'pool') return onHandQuantity(item);
  return item.status === 'available' ? 1 : 0;
}
