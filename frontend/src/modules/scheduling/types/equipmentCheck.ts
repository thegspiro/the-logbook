/**
 * Equipment Check Types
 *
 * TypeScript interfaces for equipment check templates, compartments,
 * items, and shift check submissions.
 */

// ============================================================================
// Check Type & Template Type Enums
// ============================================================================

export const CheckType = {
  PASS_FAIL: "pass_fail",
  PRESENT: "present",
  FUNCTIONAL: "functional",
  QUANTITY: "quantity",
  LEVEL: "level",
  DATE_LOT: "date_lot",
  READING: "reading",
} as const;
export type CheckType = (typeof CheckType)[keyof typeof CheckType];

export const TemplateType = {
  EQUIPMENT: "equipment",
  VEHICLE: "vehicle",
  COMBINED: "combined",
} as const;
export type TemplateType = (typeof TemplateType)[keyof typeof TemplateType];

export const CHECK_TYPE_LABELS: Record<CheckType, string> = {
  pass_fail: "Pass / Fail",
  present: "Present",
  functional: "Functional",
  quantity: "Quantity",
  level: "Level",
  date_lot: "Date / Lot",
  reading: "Reading",
};

export const TEMPLATE_TYPE_LABELS: Record<TemplateType, string> = {
  equipment: "Equipment Check",
  vehicle: "Vehicle Check",
  combined: "Combined",
};

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
  minLevel?: number;
  levelUnit?: string;
  serialNumber?: string;
  lotNumber?: string;
  imageUrl?: string;
  equipmentId?: string;
  hasExpiration: boolean;
  expirationDate?: string;
  expirationWarningDays: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CheckTemplateItemCreate {
  name: string;
  description?: string | undefined;
  sort_order?: number | undefined;
  check_type?: string | undefined;
  is_required?: boolean | undefined;
  required_quantity?: number | undefined;
  expected_quantity?: number | undefined;
  min_level?: number | undefined;
  level_unit?: string | undefined;
  serial_number?: string | undefined;
  lot_number?: string | undefined;
  image_url?: string | undefined;
  equipment_id?: string | undefined;
  has_expiration?: boolean | undefined;
  expiration_date?: string | undefined;
  expiration_warning_days?: number | undefined;
}

export interface CheckTemplateItemUpdate {
  name?: string | undefined;
  description?: string | undefined;
  sort_order?: number | undefined;
  check_type?: string | undefined;
  is_required?: boolean | undefined;
  required_quantity?: number | undefined;
  expected_quantity?: number | undefined;
  min_level?: number | undefined;
  level_unit?: string | undefined;
  serial_number?: string | undefined;
  lot_number?: string | undefined;
  image_url?: string | undefined;
  equipment_id?: string | undefined;
  has_expiration?: boolean | undefined;
  expiration_date?: string | undefined;
  expiration_warning_days?: number | undefined;
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
  parent_compartment_id?: string | undefined;
  items?: CheckTemplateItemCreate[] | undefined;
}

export interface CheckTemplateCompartmentUpdate {
  name?: string | undefined;
  description?: string | undefined;
  sort_order?: number | undefined;
  image_url?: string | undefined;
  parent_compartment_id?: string | undefined;
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
  checkTiming: "start_of_shift" | "end_of_shift";
  templateType: TemplateType;
  assignedPositions?: string[];
  isActive: boolean;
  sortOrder: number;
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
  description?: string | undefined;
  apparatus_id?: string | undefined;
  apparatus_type?: string | undefined;
  check_timing?: string | undefined;
  template_type?: string | undefined;
  assigned_positions?: string[] | undefined;
  is_active?: boolean | undefined;
  sort_order?: number | undefined;
}

// ============================================================================
// Shift Equipment Check Submission
// ============================================================================

export interface CheckItemResultSubmit {
  template_item_id: string;
  compartment_name: string;
  item_name: string;
  check_type?: string | undefined;
  status: "pass" | "fail" | "not_checked";
  quantity_found?: number | undefined;
  required_quantity?: number | undefined;
  level_reading?: number | undefined;
  level_unit?: string | undefined;
  serial_number?: string | undefined;
  lot_number?: string | undefined;
  photo_urls?: string[] | undefined;
  is_expired?: boolean | undefined;
  expiration_date?: string | undefined;
  notes?: string | undefined;
}

export interface ShiftEquipmentCheckCreate {
  template_id: string;
  check_timing: string;
  items: CheckItemResultSubmit[];
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
  status: "pass" | "fail" | "not_checked";
  quantityFound?: number;
  requiredQuantity?: number;
  levelReading?: number;
  levelUnit?: string;
  serialNumber?: string;
  lotNumber?: string;
  photoUrls?: string[];
  isExpired: boolean;
  expirationDate?: string;
  notes?: string;
  createdAt?: string;
}

export interface ShiftEquipmentCheckRecord {
  id: string;
  organizationId: string;
  shiftId: string;
  templateId?: string;
  apparatusId?: string;
  checkedBy?: string;
  checkedByName?: string;
  checkedAt?: string;
  checkTiming: string;
  overallStatus: "pass" | "fail" | "incomplete";
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
