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
  MedicalStorageArea,
  MedicalStorageOptions,
  MedicalStorageRoom,
  MedicalSupplyPlacement,
  MedicalExpiringStockRow,
  MedicalLotRecall,
} from '../../../services/medicalSuppliesService';

/**
 * How far ahead the page looks for expiring stock.
 *
 * 30 days matches the weekly supply-expiration alert's window, so the page an
 * officer opens after that email shows the same rows the email listed.
 */
export const EXPIRY_WINDOW_DAYS = 30;

/**
 * The windows an officer can widen the page to. Longer than 30 days is for a
 * department ordering on a long lead time, which needs to see what lapses
 * after the next delivery rather than before it.
 */
export const EXPIRY_WINDOW_OPTIONS: readonly number[] = [30, 60, 90];

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

/**
 * The free-text storage note, unless it only repeats the area the supply is
 * filed in. Supplies filed automatically from their old free text keep that
 * text, and "Medical Cabinet › Medical Cabinet" says nothing twice.
 */
export function storageNote(item: {
  storage_location?: string | null | undefined;
  storage_path?: string | null | undefined;
}): string | null {
  const note = item.storage_location?.trim();
  if (!note) return null;
  const last = item.storage_path?.split(' › ').pop() ?? '';
  // Compared as the migration that filed them matched: whitespace collapsed,
  // case ignored.
  const norm = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(note) === norm(last) ? null : note;
}

/** Severity of a dated lot, by how long is left on it. */
export function expiryTone(days: number | undefined): string {
  if (days === undefined || days === null) return 'text-theme-text-muted';
  if (days < 0) return 'text-red-700 dark:text-red-400';
  if (days <= 7) return 'text-orange-700 dark:text-orange-400';
  return 'text-amber-700 dark:text-amber-400';
}

export function expiryLabel(days: number | undefined): string {
  if (days === undefined || days === null) return '—';
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  return `${days}d left`;
}
