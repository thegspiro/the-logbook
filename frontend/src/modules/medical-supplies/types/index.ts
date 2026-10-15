/**
 * Medical Supplies module types.
 *
 * The domain itself is not represented here: every request goes to
 * /medical-supplies, which pins it server-side. Nothing on the client sends
 * an item type, so there is no client-side notion of "which domain am I in".
 */

export type {
  ExpiringLot,
  InventoryCategory,
  InventoryCategoryCreate,
  InventoryItem,
  InventoryItemCreate,
  InventoryLot,
  InventoryLotBulkEntry,
  InventoryLotCreate,
  InventoryLotUpdate,
} from '../../../services/eventServices';

export type {
  MedicalSupplySummary,
  MedicalItemFilters,
  MedicalItemUpdate,
  MedicalCategoryUpdate,
} from '../../../services/medicalSuppliesService';

/**
 * How far ahead the page looks for expiring stock.
 *
 * 30 days matches the weekly supply-expiration alert's window, so the page an
 * officer opens after that email shows the same rows the email listed.
 */
export const EXPIRY_WINDOW_DAYS = 30;

/**
 * A supply's name with its size, for anywhere one has to be told from
 * another: "Oxygen Mask, Non-Rebreather" is two different supplies in
 * Adult and Pediatric, and the name alone reads as a duplicate.
 */
export function supplyLabel(item: { name: string; size?: string | null | undefined }): string {
  const size = item.size?.trim();
  return size ? `${item.name} — ${size}` : item.name;
}

/** Units a medical supply is counted in. Free text is still allowed. */
export const MEDICAL_UNITS = ['each', 'box', 'case', 'pair', 'roll', 'bottle', 'vial', 'bag', 'kit'] as const;
