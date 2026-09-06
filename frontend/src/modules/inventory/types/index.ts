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
  InventorySetupStatus,
  CategoryPreset,
  CategoryPresetApplyResponse,
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
  FulfillmentOption,
  FulfillmentOptionsResponse,
  RequestableCatalogResponse,
  RequestableCategory,
  RequestableProduct,
  RequestableVariant,
  RequestTypeLiteral,
  RequestPriorityLiteral,
  WriteOffRequestItem,
  ScanLookupResponse,
  DistributeItemsRequest,
  DistributeItemsResponse,
  BatchReturnRequest,
  BatchReturnResponse,
  LabelFormat,
  NFPACompliance,
  NFPACompliancePayload,
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
  InventoryVendor,
  InventoryVendorCreate,
  InventoryVendorUpdate,
  InventoryVendorContact,
  InventoryVendorContactCreate,
  InventoryVendorContactUpdate,
  UnlinkedVendorName,
  VendorAttachNameResult,
  VendorMergeResult,
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
  ImpactPlannerOption,
  ImpactPlannerCategoryOption,
  ImpactPlannerPositionOption,
  ImpactPlannerOptions,
  ImpactPlannerRequest,
  ImpactPlannerMember,
  ImpactPlannerSizeBreakdown,
  ImpactPlannerResult,
  ImpactPlannerReorderRequest,
  ImpactPlannerReorderResultItem,
  ImpactPlannerReorderResponse,
  ImpactPlannerIssueRequest,
  ImpactPlannerIssuedItem,
  ImpactPlannerSkippedItem,
  ImpactPlannerIssueResponse,
  ImpactPlan,
  ImpactPlanCreate,
  ImpactPlannerNotifiedMember,
  ImpactPlannerRequestSizesResponse,
} from '../../../services/eventServices';

import type { InventoryCategory } from '../../../services/eventServices';

export type { Location, LocationCreate } from '../../../services/communicationsServices';
export type { Role } from '../../../types/role';

/**
 * Item type options for category classification.
 *
 * `medical` is deliberately absent: medical supply categories are created on the
 * Medical Supplies page, and the gear endpoints exclude that domain from
 * their listings. Adding it here would offer a category this page cannot
 * then show back to the user.
 */
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
  {
    value: 'available',
    label: 'Available',
    color: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30',
  },
  { value: 'assigned', label: 'Assigned', color: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30' },
  {
    value: 'checked_out',
    label: 'Checked Out',
    color: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
  },
  {
    value: 'in_maintenance',
    label: 'In Maintenance',
    color: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30',
  },
  { value: 'lost', label: 'Lost', color: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30' },
  { value: 'stolen', label: 'Stolen', color: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30' },
  {
    value: 'retired',
    label: 'Retired',
    color: 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border',
  },
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

/**
 * Display label for a stored size code.
 *
 * Sizes are stored as lowercase codes and shown through `STANDARD_SIZES`
 * everywhere a dropdown renders them — but a screen that prints the stored
 * value directly shows a quartermaster "l" and "xl" where the rest of the
 * application says "L" and "XL". Anything not in the list (a numeric waist, a
 * boot width) is returned unchanged rather than mangled.
 */
export function sizeLabel(value: string | null | undefined): string {
  if (!value) return '';
  const match = STANDARD_SIZES.find((size) => size.value === value.toLowerCase());
  return match ? match.label : value;
}

/** Shoe/boot size options */
export const SHOE_SIZES = [
  '6',
  '6.5',
  '7',
  '7.5',
  '8',
  '8.5',
  '9',
  '9.5',
  '10',
  '10.5',
  '11',
  '11.5',
  '12',
  '12.5',
  '13',
  '14',
  '15',
] as const;

/**
 * Waist sizes, mirroring the numeric waist block of the backend's
 * ``StandardSize`` enum (``backend/app/models/inventory.py``).
 */
export const WAIST_SIZES = ['28', '30', '32', '34', '36', '38', '40', '42', '44', '46'] as const;

/**
 * UI-only sentinel for the size picker's free-text escape hatch.
 *
 * Never stored. A custom size is saved the way every pre-picker row already
 * holds one — free text in `size` with `standard_size` cleared — rather than
 * with the enum's `custom` sentinel, so the null fallback each reader already
 * has (`standard_size || size`) covers it with no reader change.
 */
export const CUSTOM_SIZE_OPTION = '__custom__';

/**
 * The whole `StandardSize` vocabulary, grouped for a `<select>`.
 *
 * `STANDARD_SIZES` above is the *chip* list for variant generation and stays
 * letters-only on purpose; this is the full set the backend enum accepts, so a
 * row already holding a boot or waist size round-trips through the picker
 * instead of coming back blank and being cleared on save. Kept in step with
 * `StandardSize` in `backend/app/models/inventory.py` — an unlisted value is
 * rejected there with a 422.
 */
export const SIZE_PICKER_GROUPS: ReadonlyArray<{
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}> = [
  { label: 'Garment', options: STANDARD_SIZES.filter((s) => s.value !== 'custom') },
  { label: 'Boot / Glove', options: SHOE_SIZES.map((v) => ({ value: v, label: v })) },
  { label: 'Waist', options: WAIST_SIZES.map((v) => ({ value: v, label: v })) },
];

const SIZE_PICKER_VALUES = new Set(SIZE_PICKER_GROUPS.flatMap((g) => g.options.map((o) => o.value)));

/**
 * The picker option a stored size selects, or `''` when the value is free text.
 *
 * Matches case-insensitively so a legacy `size` of `"L"` — which the size
 * filter never matched, because it compares against the lowercase code — lands
 * on the same option as a variant-generated `"l"`. The enum's `custom`
 * sentinel is deliberately absent from the set, so it resolves to free text,
 * which is what it means.
 */
export function standardSizeCode(value: string | null | undefined): string {
  if (!value) return '';
  const code = value.trim().toLowerCase();
  return SIZE_PICKER_VALUES.has(code) ? code : '';
}

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
  const found = STATUS_OPTIONS.find((s) => s.value === status);
  return found?.color ?? 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border';
}

/**
 * Get the display label for an item status.
 *
 * `STATUS_OPTIONS` has carried these labels all along; the pages that showed a
 * status without them printed the stored value — "available", "checked out",
 * "in maintenance" — beside a properly-cased Condition and Tracking, so one
 * field in a row of three read as unfinished.
 */
export function getStatusLabel(status: string): string {
  return STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status.replace(/_/g, ' ');
}

/** Get the text color class for an item condition */
export function getConditionColor(condition: string): string {
  switch (condition) {
    case 'excellent':
      return 'text-green-700 dark:text-green-400';
    case 'good':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'fair':
      return 'text-yellow-700 dark:text-yellow-400';
    case 'poor':
      return 'text-orange-700 dark:text-orange-400';
    case 'damaged':
      return 'text-red-700 dark:text-red-400';
    case 'out_of_service':
      return 'text-red-700 dark:text-red-500';
    default:
      return 'text-theme-text-muted';
  }
}

/** Determine which item_type a category falls under for field display */
export function getItemTypeFromCategory(category: InventoryCategory | null | undefined): string {
  return category?.item_type ?? 'equipment';
}
