/**
 * Inventory Module Types
 *
 * Re-exports all inventory-related types from the global eventServices
 * and defines module-specific types used across inventory pages.
 */

// Re-export all shared types from the global type definitions
export type {
  InventoryItem,
  InventoryCategory,
  InventoryItemCreate,
  InventoryCategoryCreate,
  InventorySummary,
  LocationInventorySummary,
  InventoryItemsListResponse,
  InventoryImportResult,
  ItemIssuance,
  ItemHistoryEvent,
  LowStockAlert,
  MaintenanceRecord,
  MaintenanceRecordCreate,
  StorageAreaResponse,
  StorageAreaCreate,
  EquipmentRequestItem,
  WriteOffRequestItem,
  ScanLookupResponse,
  BatchCheckoutRequest,
  BatchCheckoutResponse,
  BatchReturnRequest,
  BatchReturnResponse,
  LabelFormat,
  NFPACompliance,
  NFPAExposureRecord,
  NFPASummary,
  NFPARetirementDueItem,
  MembersInventoryListResponse,
  MemberInventorySummary,
  SizeVariantCreate,
  BulkIssuanceTarget,
  BulkIssuanceResponse,
  IssuanceAllowance,
  AllowanceCheck,
  ChargeManagementResponse,
  ReorderRequest,
  ReorderRequestCreate,
  ReorderRequestUpdate,
  ReturnRequestItem,
  UserInventoryResponse,
  UserCheckoutItem,
  UserInventoryItem,
  UserIssuedItem,
  IssuanceChargeListItem,
  ItemVariantGroup,
  ItemVariantGroupCreate,
  EquipmentKit,
  EquipmentKitItem,
  EquipmentKitCreate,
  MemberSizePreferences,
  MemberSizePreferencesCreate,
} from '../../../services/eventServices';

export type { Location } from '../../../services/communicationsServices';
export type { Role } from '../../../types/role';

/** Item type options for category classification */
export const ITEM_TYPES = [
  { value: 'uniform', label: 'Uniform' },
  { value: 'ppe', label: 'PPE' },
  { value: 'tool', label: 'Tool' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'other', label: 'Other' },
] as const;

/** Item status options with display colors */
export const STATUS_OPTIONS = [
  { value: 'available', label: 'Available', color: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30' },
  { value: 'assigned', label: 'Assigned', color: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30' },
  { value: 'checked_out', label: 'Checked Out', color: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30' },
  { value: 'in_maintenance', label: 'In Maintenance', color: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30' },
  { value: 'lost', label: 'Lost', color: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30' },
  { value: 'stolen', label: 'Stolen', color: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30' },
  { value: 'retired', label: 'Retired', color: 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border' },
] as const;

/** Storage area type options */
export const STORAGE_TYPES = [
  { value: 'rack', label: 'Rack / Closet' },
  { value: 'shelf', label: 'Shelf' },
  { value: 'box', label: 'Box' },
  { value: 'cabinet', label: 'Cabinet / Locker' },
  { value: 'drawer', label: 'Drawer' },
  { value: 'bin', label: 'Bin / Container' },
  { value: 'other', label: 'Other' },
] as const;

/** Standard size options for garments and footwear */
export const STANDARD_SIZES = [
  { value: 'xxs', label: 'XXS' },
  { value: 'xs', label: 'XS' },
  { value: 's', label: 'S' },
  { value: 'm', label: 'M' },
  { value: 'l', label: 'L' },
  { value: 'xl', label: 'XL' },
  { value: 'xxl', label: 'XXL' },
  { value: 'xxxl', label: '3XL' },
  { value: 'xxxxl', label: '4XL' },
  { value: 'one_size', label: 'One Size' },
  { value: 'custom', label: 'Custom' },
] as const;

/** Shoe/boot size options */
export const SHOE_SIZES = [
  '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5',
  '10', '10.5', '11', '11.5', '12', '12.5', '13', '14', '15',
] as const;

/** Garment style options */
export const GARMENT_STYLES = [
  { value: 'short_sleeve', label: 'Short Sleeve' },
  { value: 'long_sleeve', label: 'Long Sleeve' },
  { value: 'mens', label: "Men's" },
  { value: 'womens', label: "Women's" },
  { value: 'unisex', label: 'Unisex' },
  { value: 'v_neck', label: 'V-Neck' },
  { value: 'crew_neck', label: 'Crew Neck' },
  { value: 'polo', label: 'Polo' },
  { value: 'button_down', label: 'Button Down' },
  { value: 'quarter_zip', label: 'Quarter Zip' },
] as const;

/** Fields shown per item type category */
export const ITEM_TYPE_FIELDS: Record<string, string[]> = {
  uniform: ['size', 'color', 'quantity', 'unit_of_measure'],
  ppe: ['size', 'color', 'serial_number', 'inspection_interval_days', 'last_inspection_date', 'next_inspection_due'],
  electronics: ['serial_number', 'model_number', 'manufacturer', 'warranty_expiration'],
  tool: ['serial_number', 'model_number', 'manufacturer'],
  equipment: ['serial_number', 'model_number', 'manufacturer', 'asset_tag'],
  vehicle: ['serial_number', 'model_number', 'manufacturer', 'asset_tag'],
  consumable: ['quantity', 'unit_of_measure'],
  other: [],
};

/** Shared request/workflow status badge colors (pending/approved/denied/completed) */
export const REQUEST_STATUS_BADGES: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border border-yellow-500/30',
  approved: 'bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/30',
  denied: 'bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/30',
  completed: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/30',
};

/** Get the display style for an item status */
export function getStatusStyle(status: string): string {
  const found = STATUS_OPTIONS.find(s => s.value === status);
  return found?.color ?? 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border';
}

/** Get the text color class for an item condition */
export function getConditionColor(condition: string): string {
  switch (condition) {
    case 'excellent': return 'text-green-700 dark:text-green-400';
    case 'good': return 'text-emerald-700 dark:text-emerald-400';
    case 'fair': return 'text-yellow-700 dark:text-yellow-400';
    case 'poor': return 'text-orange-700 dark:text-orange-400';
    case 'damaged': return 'text-red-700 dark:text-red-400';
    case 'out_of_service': return 'text-red-700 dark:text-red-500';
    default: return 'text-theme-text-muted';
  }
}

/** Determine which item_type a category falls under for field display */
export function getItemTypeFromCategory(category: InventoryCategory | null | undefined): string {
  return category?.item_type ?? 'equipment';
}

import type { InventoryCategory } from '../../../services/eventServices';
