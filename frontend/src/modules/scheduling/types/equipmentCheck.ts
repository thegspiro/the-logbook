/**
 * Equipment Check Types
 *
 * TypeScript interfaces for equipment check templates, compartments,
 * items, and shift check submissions.
 */

// ============================================================================
// Check Type & Template Type Enums
// ============================================================================

/**
 * The four answer shapes a check item can have, plus the two structural rows.
 *
 * A check stores exactly one of four things: a number, a pass/fail, a
 * quantity, or a date. The type decides the control, the pass rule, and what
 * the record keeps — so an admin building a checklist picks a type, not a
 * layout.
 *
 * `HEADER` and `TEXT` are deliberately outside the four. They are not checks;
 * they *are* the layout, which is the thing a type is no longer allowed to be.
 *
 * Mirrors `backend/app/utils/check_types.py`, which is the write-side
 * authority. Legacy values are normalized there before storage, so a stored
 * row reaching this file is already canonical — `normalizeCheckType` exists
 * for the read boundary, where a response may still be served from a client
 * that has not been redeployed.
 */
export const CheckType = {
  /** A reading against a threshold. Stores a number, and keeps it, so the
   *  trend over shifts stays visible. O2, fuel, coolant, battery volts. */
  LEVEL: 'level',
  /** Something switched on and watched. Stores pass/fail. Suction, lights and
   *  siren, radio, monitor, powered cot. */
  FUNCTION: 'function',
  /** A par level to match. Stores a quantity. Short of par is a restock line,
   *  not a failure. */
  COUNT: 'count',
  /** A date on record, confirmed rather than retyped. Medications, IV fluids,
   *  AED pads, extinguisher inspection. */
  EXPIRY: 'expiry',
  /** Structural: a section heading. Not a check. */
  HEADER: 'header',
  /** Structural: a statement the crew reads. Not a check. */
  TEXT: 'text',
} as const;
export type CheckType = (typeof CheckType)[keyof typeof CheckType];

/** The four that actually store an answer, in walking order of the design. */
export const CANONICAL_CHECK_TYPES = [CheckType.LEVEL, CheckType.FUNCTION, CheckType.COUNT, CheckType.EXPIRY] as const;
export type CanonicalCheckType = (typeof CANONICAL_CHECK_TYPES)[number];

/** Rows that are layout rather than a question. */
export const STRUCTURAL_CHECK_TYPES = [CheckType.HEADER, CheckType.TEXT] as const;

/**
 * Pre-2026-08-23 values, which stored the same four answers under nine names.
 * `present` and `functional` both stored pass/fail and differed only in what
 * the crew was asked to do — a sentence on the item, not a column.
 */
const LEGACY_CHECK_TYPES: Record<string, CheckType> = {
  pass_fail: CheckType.FUNCTION,
  present: CheckType.FUNCTION,
  functional: CheckType.FUNCTION,
  reading: CheckType.LEVEL,
  level: CheckType.LEVEL,
  quantity: CheckType.COUNT,
  date_lot: CheckType.EXPIRY,
};

const CANONICAL_SET = new Set<string>([...CANONICAL_CHECK_TYPES, ...STRUCTURAL_CHECK_TYPES]);

/**
 * Resolve any stored or received value to a canonical type.
 *
 * An unrecognised value reads as `function`: it asks the crew to look at the
 * thing and say whether it is right, which is answerable for any item.
 * `count` or `expiry` would invent a par level or a date nobody set, and
 * `level` would draw a threshold control with no threshold behind it.
 */
export function normalizeCheckType(value?: string | null): CheckType {
  const key = (value ?? '').trim().toLowerCase();
  if (CANONICAL_SET.has(key)) return key as CheckType;
  return LEGACY_CHECK_TYPES[key] ?? CheckType.FUNCTION;
}

/**
 * Whole days from `today` to `date`, or null when there is no usable date.
 *
 * Lives here rather than beside the expiry control because a file that exports
 * both components and functions loses fast refresh, and because "how many days
 * until this expires" is a question the reports and the badges ask too.
 */
export function daysUntil(date: string | null | undefined, today: Date): number | null {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - midnight.getTime()) / 86_400_000);
}

/** True when the row is an actual check rather than layout. */
export function isCheckType(value?: string | null): boolean {
  const normalized = normalizeCheckType(value);
  return (CANONICAL_CHECK_TYPES as readonly string[]).includes(normalized);
}

export const TemplateType = {
  EQUIPMENT: 'equipment',
  VEHICLE: 'vehicle',
  COMBINED: 'combined',
} as const;
export type TemplateType = (typeof TemplateType)[keyof typeof TemplateType];

export const CHECK_TYPE_LABELS: Record<CheckType, string> = {
  level: 'Level',
  function: 'Function',
  count: 'Count',
  expiry: 'Expiry',
  text: 'Statement',
  header: 'Section Header',
};

/** What each type stores — shown beside the name so the choice is legible. */
export const CHECK_TYPE_STORES: Record<CanonicalCheckType, string> = {
  level: 'stores a number',
  function: 'stores pass / fail',
  count: 'stores a quantity',
  expiry: 'stores a date',
};

export const TEMPLATE_TYPE_LABELS: Record<TemplateType, string> = {
  equipment: 'Equipment Check',
  vehicle: 'Vehicle Check',
  combined: 'Combined',
};

// ============================================================================
// Storage Container Types
// ============================================================================

// Preset storage-container kinds a department can pick from. A compartment's
// `containerType` holds one of these keys OR a free-text custom label, so
// departments can describe where equipment lives in their own terms
// (e.g. a "pack" inside a "bag" inside a "compartment").
export const CONTAINER_TYPE_PRESETS: { value: string; label: string }[] = [
  { value: 'compartment', label: 'Compartment' },
  { value: 'cabinet', label: 'Cabinet' },
  { value: 'drawer', label: 'Drawer' },
  { value: 'shelf', label: 'Shelf' },
  { value: 'bag', label: 'Bag' },
  { value: 'pack', label: 'Pack' },
  { value: 'pouch', label: 'Pouch' },
  { value: 'box', label: 'Box' },
  { value: 'case', label: 'Case' },
  { value: 'tray', label: 'Tray' },
  { value: 'kit', label: 'Kit' },
];

const CONTAINER_TYPE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  CONTAINER_TYPE_PRESETS.map((p) => [p.value, p.label])
);

/**
 * Resolve a compartment's `containerType` to a human-readable label.
 * Known preset keys map to their label; anything else (a department's
 * custom label) is returned verbatim. Empty falls back to "Compartment".
 */
export function containerTypeLabel(value?: string | null): string {
  const key = (value ?? '').trim();
  if (!key) return 'Compartment';
  return CONTAINER_TYPE_LABEL_MAP[key] ?? key;
}

/** True when the value is one of the known presets (not a custom label). */
export function isPresetContainerType(value?: string | null): boolean {
  const key = (value ?? '').trim();
  return key === '' || key in CONTAINER_TYPE_LABEL_MAP;
}

// ============================================================================
// Check Template Item
// ============================================================================

export interface CheckTemplateItem {
  id: string;
  compartmentId: string;
  name: string;
  description?: string;
  sortOrder: number;
  checkType: CheckType;
  isRequired: boolean;
  requiredQuantity?: number;
  expectedQuantity?: number;
  criticalMinimumQuantity?: number;
  minLevel?: number;
  levelUnit?: string;
  serialNumber?: string;
  lotNumber?: string;
  imageUrl?: string;
  equipmentId?: string;
  inventoryItemId?: string;
  /** The running on-truck count, including anything used since the last check. */
  quantityOnTruck?: number;
  /** Projected from the linked catalog item — "Each", "Box", "Lot". */
  unitOfMeasure?: string;
  /**
   * The lots physically aboard, soonest first.
   *
   * A position can hold three boxes with three dates. A crew checking a drug
   * bag is reading those dates off the boxes, so the form has to show all of
   * them — one date cannot describe what is in the bag.
   */
  lotsAboard?: DeployedLot[];
  hasExpiration: boolean;
  expirationDate?: string;
  expirationWarningDays: number;
  createdAt?: string;
  updatedAt?: string;
}

/** How much of a template is wired to the inventory catalog. */
export interface LinkCoverage {
  /** Positions that could carry a link — headers and unnamed rows excluded. */
  linkable: number;
  linked: number;
  unlinked: number;
}

export interface InventoryMatchSuggestion {
  id: string;
  name: string;
  /**
   * 1.0 only when the two names normalize identically. Anything less is a
   * judgement call: "Oxygen Mask" scores high against both the adult and the
   * pediatric mask, which is exactly the case a person has to arbitrate.
   */
  score: number;
  confidence: 'exact' | 'strong' | 'weak';
}

export interface InventoryMatch {
  templateItemId: string;
  itemName: string;
  checkType?: string;
  suggestions: InventoryMatchSuggestion[];
}

export interface InventoryMatchesResult {
  coverage: LinkCoverage;
  matches: InventoryMatch[];
}

export interface InventoryLinkResult {
  linked: number;
  coverage: LinkCoverage;
}

export interface CheckTemplateItemCreate {
  name: string;
  description?: string | undefined;
  sort_order?: number | undefined;
  check_type?: string | undefined;
  is_required?: boolean | undefined;
  required_quantity?: number | undefined;
  expected_quantity?: number | undefined;
  critical_minimum_quantity?: number | undefined;
  min_level?: number | undefined;
  level_unit?: string | undefined;
  serial_number?: string | undefined;
  lot_number?: string | undefined;
  image_url?: string | undefined;
  equipment_id?: string | undefined;
  inventory_item_id?: string | undefined;
  has_expiration?: boolean | undefined;
  expiration_date?: string | undefined;
  expiration_warning_days?: number | undefined;
}

export interface CheckTemplateItemBulkResult {
  items: CheckTemplateItem[];
  createdCount: number;
  replayed: boolean;
}

export interface CheckTemplateItemBulkDeleteResult {
  deletedItemIds: string[];
  replayed: boolean;
}

/**
 * Update payloads distinguish three states, because the backend dumps them
 * with `exclude_unset` and clears on an explicit null: omit the key to leave
 * a field alone, send `null` to clear it, send a value to set it. A nullable
 * field typed without `| null` cannot express the middle case, which is how
 * clearing one came to be silently dropped behind a success toast.
 */
export interface CheckTemplateItemUpdate {
  name?: string | undefined;
  description?: string | null | undefined;
  compartment_id?: string | null | undefined;
  sort_order?: number | undefined;
  check_type?: string | undefined;
  is_required?: boolean | undefined;
  required_quantity?: number | null | undefined;
  expected_quantity?: number | null | undefined;
  critical_minimum_quantity?: number | null | undefined;
  min_level?: number | null | undefined;
  level_unit?: string | null | undefined;
  serial_number?: string | null | undefined;
  lot_number?: string | null | undefined;
  image_url?: string | null | undefined;
  equipment_id?: string | null | undefined;
  inventory_item_id?: string | null | undefined;
  has_expiration?: boolean | undefined;
  expiration_date?: string | null | undefined;
  expiration_warning_days?: number | null | undefined;
}

// ============================================================================
// Check Template Compartment
// ============================================================================

export interface CheckTemplateCompartment {
  id: string;
  templateId: string;
  name: string;
  description?: string;
  sortOrder: number;
  imageUrl?: string;
  isHeader?: boolean;
  containerType?: string;
  /**
   * This container is closed with a numbered tamper seal — a drug bag, a
   * trauma kit. A seal matching the last count is proof nothing inside was
   * touched, so on the check form it clears the contents count in one tap and
   * leaves only what a seal cannot vouch for: expiry dates and readings, which
   * move on their own while the bag sits shut.
   */
  isSealed?: boolean;
  parentCompartmentId?: string;
  items: CheckTemplateItem[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CheckTemplateCompartmentCreate {
  name: string;
  description?: string | undefined;
  sort_order?: number | undefined;
  image_url?: string | undefined;
  is_header?: boolean | undefined;
  container_type?: string | undefined;
  is_sealed?: boolean | undefined;
  parent_compartment_id?: string | undefined;
  items?: CheckTemplateItemCreate[] | undefined;
}

export interface CheckTemplateCompartmentUpdate {
  name?: string | undefined;
  description?: string | null | undefined;
  sort_order?: number | undefined;
  image_url?: string | null | undefined;
  is_header?: boolean | undefined;
  container_type?: string | null | undefined;
  is_sealed?: boolean | undefined;
  parent_compartment_id?: string | null | undefined;
}

// ============================================================================
// Equipment Check Template
// ============================================================================

export interface EquipmentCheckTemplate {
  id: string;
  organizationId: string;
  apparatusId?: string;
  apparatusType?: string;
  name: string;
  description?: string;
  checkTiming: 'start_of_shift' | 'end_of_shift';
  templateType: TemplateType;
  assignedPositions?: string[];
  isActive: boolean;
  sortOrder: number;
  contentRevision: number;
  compartments: CheckTemplateCompartment[];
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
}

export interface EquipmentCheckTemplateCreate {
  name: string;
  description?: string | undefined;
  apparatus_id?: string | undefined;
  apparatus_type?: string | undefined;
  check_timing: string;
  template_type?: string | undefined;
  assigned_positions?: string[] | undefined;
  is_active?: boolean | undefined;
  sort_order?: number | undefined;
  compartments?: CheckTemplateCompartmentCreate[] | undefined;
}

export interface EquipmentCheckTemplateUpdate {
  name?: string | undefined;
  description?: string | null | undefined;
  apparatus_id?: string | null | undefined;
  apparatus_type?: string | null | undefined;
  check_timing?: string | undefined;
  template_type?: string | undefined;
  assigned_positions?: string[] | undefined;
  is_active?: boolean | undefined;
  sort_order?: number | undefined;
}

// ============================================================================
// Shift Equipment Check Submission
// ============================================================================

/**
 * How an item was answered.
 *
 * `not_applicable` is a real answer rather than a fault: a tool legitimately
 * off the truck used to have to be filed as a failure, which the compliance
 * reports then counted as one. It counts as answered wherever completeness is
 * measured, and never toward failures.
 *
 * `out_of_service` also counts as answered, but does count as a failure —
 * the item was looked at and found unusable.
 */
export type CheckItemStatus = 'pass' | 'fail' | 'not_checked' | 'not_applicable' | 'out_of_service';

/** How each answer reads on screen. Never print the raw token. */
export const CHECK_ITEM_STATUS_LABELS: Record<string, string> = {
  pass: 'Pass',
  fail: 'Fail',
  not_checked: 'Not checked',
  not_applicable: 'Not on truck',
  out_of_service: 'Out of service',
};

export interface CheckItemResultSubmit {
  template_item_id: string;
  compartment_name: string;
  item_name: string;
  check_type?: string | undefined;
  status: CheckItemStatus;
  quantity_found?: number | undefined;
  required_quantity?: number | undefined;
  critical_minimum_quantity?: number | undefined;
  level_reading?: number | undefined;
  level_unit?: string | undefined;
  serial_number?: string | undefined;
  lot_number?: string | undefined;
  serial_found?: string | undefined;
  lot_found?: string | undefined;
  /** Expiration read off a replacement unit; written back onto the template. */
  expiration_found?: string | undefined;
  photo_urls?: string[] | undefined;
  is_expired?: boolean | undefined;
  expiration_date?: string | undefined;
  notes?: string | undefined;
}

/**
 * The tamper seal a crew read on one sealed container.
 *
 * Submitted whether or not the seal cleared anything: a broken seal is the
 * more important of the two records, because it is what says the contents were
 * counted by hand and why.
 */
export interface CheckSealSubmit {
  template_compartment_id: string;
  compartment_name: string;
  seal_number?: string | undefined;
  intact: boolean;
  cleared_item_count: number;
  notes?: string | undefined;
}

export interface ShiftEquipmentCheckCreate {
  template_id: string;
  check_timing: string;
  client_submission_id?: string | undefined;
  items: CheckItemResultSubmit[];
  seals?: CheckSealSubmit[] | undefined;
  notes?: string | undefined;
  signature_data?: string | undefined;
}

export interface StandaloneEquipmentCheckCreate {
  template_id: string;
  apparatus_id?: string | undefined;
  check_timing: string;
  items: CheckItemResultSubmit[];
  seals?: CheckSealSubmit[] | undefined;
  notes?: string | undefined;
  signature_data?: string | undefined;
}

// ============================================================================
// Shift Equipment Check Responses
// ============================================================================

export interface ShiftEquipmentCheckItemRecord {
  id: string;
  checkId: string;
  templateItemId?: string;
  compartmentName: string;
  itemName: string;
  checkType?: string;
  status: CheckItemStatus;
  quantityFound?: number;
  requiredQuantity?: number;
  criticalMinimumQuantity?: number;
  levelReading?: number;
  levelUnit?: string;
  serialNumber?: string;
  lotNumber?: string;
  serialFound?: string;
  lotFound?: string;
  expirationFound?: string;
  updatedSerial?: boolean;
  photoUrls?: string[];
  isExpired: boolean;
  expirationDate?: string;
  notes?: string;
  createdAt?: string;
}

export interface ShiftEquipmentCheckRecord {
  id: string;
  organizationId: string;
  shiftId?: string;
  templateId?: string;
  apparatusId?: string;
  checkedBy?: string;
  checkedByName?: string;
  checkedAt?: string;
  checkTiming: string;
  checkContext?: 'shift_based' | 'standalone';
  overallStatus: 'pass' | 'fail' | 'incomplete';
  totalItems: number;
  completedItems: number;
  failedItems: number;
  notes?: string;
  items: ShiftEquipmentCheckItemRecord[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ShiftCheckSummary {
  templateId: string;
  templateName: string;
  checkTiming: string;
  assignedPositions?: string[];
  isCompleted: boolean;
  overallStatus?: string;
  checkedByName?: string;
  checkedAt?: string;
  totalItems: number;
  completedItems: number;
  failedItems: number;
}

/** Canonical client-side interpretation of the backend completion contract. */
export function isShiftCheckCompleted(summary: ShiftCheckSummary): boolean {
  return summary.isCompleted && summary.overallStatus !== 'incomplete';
}

export interface CheckItemHistory {
  checkId: string;
  shiftId: string;
  shiftDate?: string;
  status: string;
  quantityFound?: number;
  levelReading?: number;
  serialNumber?: string;
  lotNumber?: string;
  isExpired: boolean;
  notes?: string;
  checkedByName?: string;
  checkedAt?: string;
}

export interface LastCheckItemResult {
  status: string;
  quantity_found?: number;
  level_reading?: number;
  serial_number?: string;
  lot_number?: string;
  expiration_date?: string;
  notes?: string;
}

/**
 * What the previous crew read on one sealed container.
 *
 * The form compares the number in front of the crew against this one: equal
 * means nothing was opened since, which is what the shortcut rests on.
 */
export interface LastSealRecord {
  sealNumber?: string | null;
  intact: boolean;
  checkedAt?: string | null;
}

// ─── Report Types ────────────────────────────────────────────────────────────

export interface ApparatusComplianceRecord {
  apparatusId: string;
  apparatusName: string;
  lastCheckDate?: string;
  lastCheckedBy?: string;
  lastStatus?: string;
  checksCompleted: number;
  checksExpected: number;
  passCount: number;
  failCount: number;
  hasDeficiency: boolean;
  deficiencySince?: string;
}

export interface MemberComplianceReportRecord {
  userId: string;
  userName: string;
  checksCompleted: number;
  passCount: number;
  failCount: number;
}

export interface ComplianceReport {
  totalChecks: number;
  passRate: number;
  overdueCount: number;
  avgItemsPerCheck: number;
  apparatus: ApparatusComplianceRecord[];
  members: MemberComplianceReportRecord[];
}

export interface FailureLogRecord {
  id: string;
  checkId: string;
  checkedAt?: string;
  apparatusId?: string;
  apparatusName?: string;
  compartmentName: string;
  itemName: string;
  checkType?: string;
  status: string;
  notes?: string;
  checkedByName?: string;
}

export interface FailureLogResponse {
  items: FailureLogRecord[];
  total: number;
}

export interface ItemTrendEntry {
  period: string;
  passCount: number;
  failCount: number;
  notCheckedCount: number;
  /** Answered "not on truck" — an answer, unlike notCheckedCount. */
  notApplicableCount?: number;
}

export interface ItemTrendResponse {
  itemName: string;
  trends: ItemTrendEntry[];
  history: CheckItemHistory[];
}

// ─── Supply Officer: Expiring Items + Ready Stock ───────────────────────────

export interface ReadyLot {
  id: string;
  lotNumber?: string;
  expirationDate?: string;
  quantity: number;
  /** Stock that expired on the shelf: listed, but not swappable onto a truck. */
  isExpired?: boolean;
}

export interface SupplyExpiringItem {
  templateItemId: string;
  itemName: string;
  compartmentName?: string;
  templateId?: string;
  templateName?: string;
  apparatusId?: string;
  apparatusName?: string;
  lotNumber?: string;
  expirationDate?: string;
  daysUntilExpiration?: number;
  isExpired: boolean;
  restockNeeded?: boolean;
  restockNote?: string;
  restockReportedAt?: string;
  quantityOnTruck?: number;
  targetQuantity?: number;
  isShort?: boolean;
  inventoryItemId?: string;
  inventoryItemName?: string;
  readyStock: number;
  readyLots: ReadyLot[];
}

export interface SupplyOverview {
  daysAhead: number;
  total: number;
  items: SupplyExpiringItem[];
}

/**
 * A tracked position on an apparatus, with the ready stock behind it.
 *
 * Read outside any check: the standing view a crew opens mid-shift to record
 * what they used and to put fresh stock in a bracket.
 */
/**
 * One lot physically aboard for a checklist position.
 *
 * A four-slot bracket can hold units from three lots with three dates; the
 * position's exposure is the earliest of them, which is why these are listed
 * rather than collapsed into one number and one date.
 */
export interface DeployedLot {
  id: string;
  lotNumber?: string;
  expirationDate?: string;
  quantity: number;
  isExpired: boolean;
}

export interface ItemDeployedLots {
  templateItemId: string;
  itemName: string;
  targetQuantity?: number;
  quantityOnTruck?: number;
  isShort: boolean;
  unitOfMeasure?: string;
  lots: DeployedLot[];
}

export interface ApparatusInventoryItem {
  templateItemId: string;
  itemName: string;
  checkType?: string;
  /** What the position should hold. Absent when it is not a counted position. */
  targetQuantity?: number;
  /** What it holds now — falls back to the target until someone counts. */
  quantityOnTruck?: number;
  isShort: boolean;
  unitOfMeasure?: string;
  deployedLots: DeployedLot[];
  serialNumber?: string;
  lotNumber?: string;
  expirationDate?: string;
  daysUntilExpiration?: number;
  isExpired: boolean;
  restockNeeded: boolean;
  restockNote?: string;
  restockReportedAt?: string;
  restockReportedByName?: string;
  inventoryItemId?: string;
  readyStock: number;
  readyLots: ReadyLot[];
}

export interface ApparatusInventoryCompartment {
  compartmentId: string;
  compartmentName: string;
  items: ApparatusInventoryItem[];
}

export interface ApparatusInventory {
  apparatusId: string;
  apparatusName?: string;
  compartments: ApparatusInventoryCompartment[];
}

/** The restock report currently standing against a checklist item. */
export interface ItemRestockState {
  templateItemId: string;
  restockNeeded: boolean;
  restockNote?: string;
  restockReportedAt?: string;
  quantityOnTruck?: number;
  targetQuantity?: number;
  isShort: boolean;
}

/**
 * A checklist position on an apparatus that an inventory item fills — the
 * supply link read from the item's side rather than the truck's, which is the
 * direction a recall or an expiring lot is worked from.
 */
export interface ItemDeployment {
  templateItemId: string;
  itemName: string;
  compartmentName?: string;
  templateId?: string;
  templateName?: string;
  apparatusId?: string;
  apparatusName?: string;
  apparatusType?: string;
  lotNumber?: string;
  serialNumber?: string;
  expirationDate?: string;
  daysUntilExpiration?: number;
  isExpired: boolean;
}

/**
 * What became of a unit taken off the apparatus for being expired.
 *
 * Departments differ — destroyed on the spot, handed straight back to the
 * supplying pharmacy, or pulled off the truck for somebody to exchange days
 * later — so the crew reports it rather than the application assuming it.
 */
export const ExpiredStockDisposition = {
  DISCARDED: 'discarded',
  RETURNED_FOR_EXCHANGE: 'returned_for_exchange',
  AWAITING_EXCHANGE: 'awaiting_exchange',
} as const;
export type ExpiredStockDisposition = (typeof ExpiredStockDisposition)[keyof typeof ExpiredStockDisposition];

export interface LotSwapResult {
  templateItemId: string;
  lotNumber?: string;
  expirationDate?: string;
  remainingQuantity: number;
  /** A full restock settles the report; a partial one leaves it standing. */
  restockNeeded?: boolean;
  quantityOnTruck?: number;
  /**
   * The position's lots after the swap. A position holding several lots is
   * exposed by the earliest of them, so this — not the scalar expirationDate,
   * which describes only the incoming unit — is what settles its verdict.
   */
  lotsAboard?: DeployedLot[];
  replacedLotNumber?: string;
  disposition?: ExpiredStockDisposition;
}

// ─── Template Change Log ────────────────────────────────────────────────────

export interface TemplateChangeLogEntry {
  id: string;
  templateId: string;
  userId?: string;
  userName: string;
  action: string;
  entityType: string;
  entityId?: string;
  entityName?: string;
  changes?: Record<string, unknown>;
  createdAt?: string;
}

export interface TemplateChangeLogResponse {
  items: TemplateChangeLogEntry[];
  total: number;
}

// ─── Fleet Readiness & Check Log ────────────────────────────────────────────

/**
 * How one expected check turned out.
 *
 * `missed` and `out_of_service` only exist because the backend reconstructs
 * the *expected* side of the ledger (shift x template) rather than reading
 * submitted checks alone — a check that never happened has no record of its
 * own, and without these two values the page could never show below 100%.
 */
export const CheckOutcome = {
  PASSED: 'passed',
  FAILED: 'failed',
  PARTIAL: 'partial',
  MISSED: 'missed',
  DUE: 'due',
  SCHEDULED: 'scheduled',
  OUT_OF_SERVICE: 'out_of_service',
} as const;
export type CheckOutcome = (typeof CheckOutcome)[keyof typeof CheckOutcome];

export const CHECK_OUTCOME_LABELS: Record<CheckOutcome, string> = {
  passed: 'Passed',
  failed: 'Found a problem',
  partial: 'Started, not finished',
  missed: 'Missed',
  due: 'Due today',
  scheduled: 'Scheduled',
  out_of_service: 'Out of service',
};

export const Readiness = {
  IN_SERVICE: 'in_service',
  ATTENTION: 'attention',
  OUT_OF_SERVICE: 'out_of_service',
  NO_CHECKS: 'no_checks',
} as const;
export type Readiness = (typeof Readiness)[keyof typeof Readiness];

export const READINESS_LABELS: Record<Readiness, string> = {
  in_service: 'In service',
  attention: 'Needs attention',
  out_of_service: 'Out of service',
  no_checks: 'No checks set up',
};

export interface CheckStripEntry {
  date: string;
  /** Null on a date this apparatus expected no check — idle, not neglected. */
  status?: CheckOutcome | null;
}

export interface FleetApparatusReadiness {
  apparatusId: string;
  unitLabel: string;
  name?: string;
  apparatusType?: string;
  source: string;
  readiness: Readiness;
  /** Always present — the pill never ships without the reason behind it. */
  readinessReason: string;
  statusLabel?: string;
  statusReason?: string;
  lastCheckAt?: string;
  lastCheckBy?: string;
  lastCheckByName?: string;
  lastCheckStatus?: CheckOutcome;
  lastCheckId?: string;
  openCheckId?: string;
  failedItemCount: number;
  outOfServiceItemCount: number;
  expiringItemCount: number;
  restockItemCount: number;
  dueTodayCount: number;
  overdueCount: number;
  expected: number;
  completed: number;
  completionRate?: number | null;
  recent: CheckStripEntry[];
  asOf: string;
}

export interface FleetTotals {
  inService: number;
  attention: number;
  outOfService: number;
  noChecks: number;
  dueToday: number;
  overdue: number;
  openFindings: number;
  expiringItems: number;
}

export interface FleetReadinessResponse {
  generatedAt: string;
  expiringWindowDays: number;
  stripDates: number;
  apparatus: FleetApparatusReadiness[];
  totals: FleetTotals;
}

export interface CheckLogCellCheck {
  checkId?: string;
  templateName: string;
  checkTiming: string;
  status: CheckOutcome;
  findingCount: number;
}

export interface CheckLogCell {
  date: string;
  status?: CheckOutcome | null;
  checks: CheckLogCellCheck[];
}

export interface CheckLogRow {
  apparatusId: string;
  unitLabel: string;
  apparatusType?: string;
  cells: CheckLogCell[];
  expected: number;
  completed: number;
  /** Measured against this apparatus's own occasions, not the columns. */
  completionRate?: number | null;
}

export interface CheckLogEntry {
  /** Null for a check that was expected and never submitted. */
  checkId?: string;
  shiftId: string;
  shiftDate: string;
  apparatusId: string;
  unitLabel: string;
  templateId: string;
  templateName: string;
  checkTiming: string;
  status: CheckOutcome;
  checkedAt?: string;
  checkedBy?: string;
  checkedByName?: string;
  totalItems?: number;
  completedItems?: number;
  failedItems?: number;
  findingCount: number;
  findings: string[];
}

export interface CheckLogSummary {
  expected: number;
  completed: number;
  completionRate?: number | null;
  missed: number;
  withFindings: number;
  outOfServiceDays: number;
}

export interface CheckLogResponse {
  windowDates: number;
  dates: string[];
  /** `own` when the caller lacks equipment_check.view; the grid is withheld. */
  scope: 'fleet' | 'own';
  rows: CheckLogRow[];
  entries: CheckLogEntry[];
  summary: CheckLogSummary;
}
