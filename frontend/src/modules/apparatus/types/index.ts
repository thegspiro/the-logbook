/**
 * Apparatus Module Types
 *
 * TypeScript interfaces and types for the Apparatus module.
 */

// =============================================================================
// Enumerations
// =============================================================================

export type ApparatusCategory =
  | 'fire'
  | 'ems'
  | 'rescue'
  | 'support'
  | 'command'
  | 'marine'
  | 'aircraft'
  | 'admin'
  | 'other';

export type DefaultApparatusType =
  | 'engine'
  | 'ladder'
  | 'quint'
  | 'rescue'
  | 'ambulance'
  | 'squad'
  | 'tanker'
  | 'brush'
  | 'hazmat'
  | 'command'
  | 'utility'
  | 'boat'
  | 'atv'
  | 'staff'
  | 'reserve'
  | 'other';

export type DefaultApparatusStatus =
  | 'in_service'
  | 'out_of_service'
  | 'in_maintenance'
  | 'reserve'
  | 'on_order'
  | 'sold'
  | 'disposed';

export type FuelType =
  | 'gasoline'
  | 'diesel'
  | 'electric'
  | 'hybrid'
  | 'propane'
  | 'cng'
  | 'other';

export type CustomFieldType =
  | 'text'
  | 'number'
  | 'decimal'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'select'
  | 'multi_select'
  | 'url'
  | 'email';

export type MaintenanceCategory =
  | 'preventive'
  | 'repair'
  | 'inspection'
  | 'certification'
  | 'fluid'
  | 'cleaning'
  | 'other';

export type MaintenanceIntervalUnit =
  | 'days'
  | 'weeks'
  | 'months'
  | 'years'
  | 'miles'
  | 'kilometers'
  | 'hours';

// =============================================================================
// Apparatus Type
// =============================================================================

export interface ApparatusType {
  id: string;
  organizationId: string | null;
  name: string;
  code: string;
  description: string | null;
  category: ApparatusCategory;
  isSystem: boolean;
  defaultType: DefaultApparatusType | null;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApparatusTypeCreate {
  name: string;
  code: string;
  description?: string;
  category?: ApparatusCategory;
  icon?: string;
  color?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface ApparatusTypeUpdate {
  name?: string;
  code?: string;
  description?: string;
  category?: ApparatusCategory;
  icon?: string;
  color?: string;
  sortOrder?: number;
  isActive?: boolean;
}

// =============================================================================
// Apparatus Status
// =============================================================================

export interface ApparatusStatus {
  id: string;
  organizationId: string | null;
  name: string;
  code: string;
  description: string | null;
  isSystem: boolean;
  defaultStatus: DefaultApparatusStatus | null;
  isAvailable: boolean;
  isOperational: boolean;
  requiresReason: boolean;
  isArchivedStatus: boolean;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApparatusStatusCreate {
  name: string;
  code: string;
  description?: string;
  isAvailable?: boolean;
  isOperational?: boolean;
  requiresReason?: boolean;
  isArchivedStatus?: boolean;
  color?: string;
  icon?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface ApparatusStatusUpdate {
  name?: string;
  code?: string;
  description?: string;
  isAvailable?: boolean;
  isOperational?: boolean;
  requiresReason?: boolean;
  isArchivedStatus?: boolean;
  color?: string;
  icon?: string;
  sortOrder?: number;
  isActive?: boolean;
}

// =============================================================================
// Main Apparatus
// =============================================================================

export interface Apparatus {
  id: string;
  organizationId: string;

  // Identification
  unitNumber: string;
  name: string | null;
  vin: string | null;
  licensePlate: string | null;
  licenseState: string | null;
  radioId: string | null;
  assetTag: string | null;

  // Type and Status
  apparatusTypeId: string;
  statusId: string;
  statusReason: string | null;
  statusChangedAt: string | null;
  statusChangedBy: string | null;

  // Vehicle Specifications
  year: number | null;
  make: string | null;
  model: string | null;
  bodyManufacturer: string | null;
  color: string | null;

  // Fuel
  fuelType: FuelType | null;
  fuelCapacityGallons: number | null;

  // Capacity
  seatingCapacity: number | null;
  gvwr: number | null;

  // Fire/EMS Specifications
  pumpCapacityGpm: number | null;
  tankCapacityGallons: number | null;
  foamCapacityGallons: number | null;
  ladderLengthFeet: number | null;

  // Location
  primaryStationId: string | null;
  currentLocationId: string | null;

  // Usage Tracking
  currentMileage: number | null;
  currentHours: number | null;
  mileageUpdatedAt: string | null;
  hoursUpdatedAt: string | null;

  // Purchase Information
  purchaseDate: string | null;
  purchasePrice: number | null;
  purchaseVendor: string | null;
  purchaseOrderNumber: string | null;
  inServiceDate: string | null;

  // Financing
  isFinanced: boolean;
  financingCompany: string | null;
  financingEndDate: string | null;
  monthlyPayment: number | null;

  // Value Tracking
  originalValue: number | null;
  currentValue: number | null;
  valueUpdatedAt: string | null;
  depreciationMethod: string | null;
  depreciationYears: number | null;
  salvageValue: number | null;

  // Warranty
  warrantyExpiration: string | null;
  extendedWarrantyExpiration: string | null;
  warrantyProvider: string | null;
  warrantyNotes: string | null;

  // Insurance
  insurancePolicyNumber: string | null;
  insuranceProvider: string | null;
  insuranceExpiration: string | null;

  // Registration
  registrationExpiration: string | null;
  inspectionExpiration: string | null;

  // Archive/Disposal
  isArchived: boolean;
  archivedAt: string | null;
  archivedBy: string | null;
  soldDate: string | null;
  soldPrice: number | null;
  soldTo: string | null;
  soldToContact: string | null;
  disposalDate: string | null;
  disposalMethod: string | null;
  disposalReason: string | null;
  disposalNotes: string | null;

  // NFPA
  nfpaTrackingEnabled: boolean;

  // Custom Fields
  customFieldValues: Record<string, unknown>;

  // Notes
  description: string | null;
  notes: string | null;

  // Metadata
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;

  // Nested relationships
  apparatusType?: ApparatusType;
  statusRecord?: ApparatusStatus;
}

export interface ApparatusListItem {
  id: string;
  unitNumber: string;
  name: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  apparatusTypeId: string;
  statusId: string;
  primaryStationId: string | null;
  currentMileage: number | null;
  currentHours: number | null;
  isArchived: boolean;
  apparatusType?: ApparatusType;
  statusRecord?: ApparatusStatus;
}

export interface ApparatusCreate {
  unitNumber: string;
  name?: string;
  vin?: string;
  licensePlate?: string;
  licenseState?: string;
  radioId?: string;
  assetTag?: string;
  apparatusTypeId: string;
  statusId: string;
  statusReason?: string;
  year?: number;
  make?: string;
  model?: string;
  bodyManufacturer?: string;
  color?: string;
  fuelType?: FuelType;
  fuelCapacityGallons?: number;
  seatingCapacity?: number;
  gvwr?: number;
  pumpCapacityGpm?: number;
  tankCapacityGallons?: number;
  foamCapacityGallons?: number;
  ladderLengthFeet?: number;
  primaryStationId?: string;
  currentLocationId?: string;
  currentMileage?: number;
  currentHours?: number;
  purchaseDate?: string;
  purchasePrice?: number;
  purchaseVendor?: string;
  purchaseOrderNumber?: string;
  inServiceDate?: string;
  isFinanced?: boolean;
  financingCompany?: string;
  financingEndDate?: string;
  monthlyPayment?: number;
  originalValue?: number;
  currentValue?: number;
  depreciationMethod?: string;
  depreciationYears?: number;
  salvageValue?: number;
  warrantyExpiration?: string;
  extendedWarrantyExpiration?: string;
  warrantyProvider?: string;
  warrantyNotes?: string;
  insurancePolicyNumber?: string;
  insuranceProvider?: string;
  insuranceExpiration?: string;
  registrationExpiration?: string;
  inspectionExpiration?: string;
  nfpaTrackingEnabled?: boolean;
  customFieldValues?: Record<string, unknown>;
  description?: string;
  notes?: string;
}

export interface ApparatusUpdate extends Partial<ApparatusCreate> {}

export interface ApparatusStatusChange {
  statusId: string;
  reason?: string;
  currentMileage?: number;
  currentHours?: number;
}

export interface ApparatusArchive {
  disposalMethod: string;
  disposalReason?: string;
  disposalDate?: string;
  disposalNotes?: string;
  soldDate?: string;
  soldPrice?: number;
  soldTo?: string;
  soldToContact?: string;
}

// =============================================================================
// Pagination
// =============================================================================

export interface PaginatedApparatusList {
  items: ApparatusListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApparatusListFilters {
  apparatusTypeId?: string;
  statusId?: string;
  primaryStationId?: string;
  isArchived?: boolean;
  yearMin?: number;
  yearMax?: number;
  make?: string;
  search?: string;
}

// =============================================================================
// Fleet Summary
// =============================================================================

export interface ApparatusFleetSummary {
  totalApparatus: number;
  inServiceCount: number;
  outOfServiceCount: number;
  inMaintenanceCount: number;
  reserveCount: number;
  archivedCount: number;
  byType: Record<string, number>;
  maintenanceDueSoon: number;
  maintenanceOverdue: number;
  registrationsExpiringSoon: number;
  inspectionsExpiringSoon: number;
  insuranceExpiringSoon: number;
}

// =============================================================================
// Maintenance
// =============================================================================

export interface ApparatusMaintenanceType {
  id: string;
  organizationId: string | null;
  name: string;
  code: string;
  description: string | null;
  category: MaintenanceCategory;
  isSystem: boolean;
  defaultIntervalValue: number | null;
  defaultIntervalUnit: MaintenanceIntervalUnit | null;
  defaultIntervalMiles: number | null;
  defaultIntervalHours: number | null;
  isNfpaRequired: boolean;
  nfpaReference: string | null;
  appliesToTypes: string[] | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApparatusMaintenance {
  id: string;
  organizationId: string;
  apparatusId: string;
  maintenanceTypeId: string;
  scheduledDate: string | null;
  dueDate: string | null;
  completedDate: string | null;
  completedBy: string | null;
  performedBy: string | null;
  isCompleted: boolean;
  isOverdue: boolean;
  description: string | null;
  workPerformed: string | null;
  findings: string | null;
  mileageAtService: number | null;
  hoursAtService: number | null;
  cost: number | null;
  vendor: string | null;
  invoiceNumber: string | null;
  nextDueDate: string | null;
  nextDueMileage: number | null;
  nextDueHours: number | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  maintenanceType?: ApparatusMaintenanceType;
}

export interface ApparatusMaintenanceCreate {
  apparatusId: string;
  maintenanceTypeId: string;
  scheduledDate?: string;
  dueDate?: string;
  completedDate?: string;
  performedBy?: string;
  isCompleted?: boolean;
  description?: string;
  workPerformed?: string;
  findings?: string;
  mileageAtService?: number;
  hoursAtService?: number;
  cost?: number;
  vendor?: string;
  invoiceNumber?: string;
  nextDueDate?: string;
  nextDueMileage?: number;
  nextDueHours?: number;
  notes?: string;
}

export interface ApparatusMaintenanceUpdate extends Partial<ApparatusMaintenanceCreate> {}

export interface ApparatusMaintenanceDue {
  id: string;
  apparatusId: string;
  apparatusUnitNumber: string;
  maintenanceTypeName: string;
  dueDate: string | null;
  dueMileage: number | null;
  dueHours: number | null;
  isOverdue: boolean;
}

// =============================================================================
// Fuel Log
// =============================================================================

export interface ApparatusFuelLog {
  id: string;
  organizationId: string;
  apparatusId: string;
  fuelDate: string;
  fuelType: FuelType;
  gallons: number;
  pricePerGallon: number | null;
  totalCost: number | null;
  mileageAtFill: number | null;
  hoursAtFill: number | null;
  isFullTank: boolean;
  stationName: string | null;
  stationAddress: string | null;
  notes: string | null;
  recordedBy: string | null;
  createdAt: string;
}

export interface ApparatusFuelLogCreate {
  apparatusId: string;
  fuelDate: string;
  fuelType: FuelType;
  gallons: number;
  pricePerGallon?: number;
  totalCost?: number;
  mileageAtFill?: number;
  hoursAtFill?: number;
  isFullTank?: boolean;
  stationName?: string;
  stationAddress?: string;
  notes?: string;
}

// =============================================================================
// Operator
// =============================================================================

export interface OperatorRestriction {
  type: string;
  description: string;
  isActive: boolean;
}

export interface ApparatusOperator {
  id: string;
  organizationId: string;
  apparatusId: string;
  userId: string;
  isCertified: boolean;
  certificationDate: string | null;
  certificationExpiration: string | null;
  certifiedBy: string | null;
  licenseTypeRequired: string | null;
  licenseVerified: boolean;
  licenseVerifiedDate: string | null;
  hasRestrictions: boolean;
  restrictions: OperatorRestriction[] | null;
  restrictionNotes: string | null;
  isActive: boolean;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApparatusOperatorCreate {
  apparatusId: string;
  userId: string;
  isCertified?: boolean;
  certificationDate?: string;
  certificationExpiration?: string;
  licenseTypeRequired?: string;
  licenseVerified?: boolean;
  licenseVerifiedDate?: string;
  hasRestrictions?: boolean;
  restrictions?: OperatorRestriction[];
  restrictionNotes?: string;
  isActive?: boolean;
  notes?: string;
}

export interface ApparatusOperatorUpdate extends Partial<Omit<ApparatusOperatorCreate, 'apparatusId' | 'userId'>> {}

// =============================================================================
// Equipment
// =============================================================================

export interface ApparatusEquipment {
  id: string;
  organizationId: string;
  apparatusId: string;
  inventoryItemId: string | null;
  name: string;
  description: string | null;
  quantity: number;
  locationOnApparatus: string | null;
  isMounted: boolean;
  isRequired: boolean;
  serialNumber: string | null;
  assetTag: string | null;
  isPresent: boolean;
  notes: string | null;
  assignedBy: string | null;
  assignedAt: string;
  updatedAt: string;
}

export interface ApparatusEquipmentCreate {
  apparatusId: string;
  inventoryItemId?: string;
  name: string;
  description?: string;
  quantity?: number;
  locationOnApparatus?: string;
  isMounted?: boolean;
  isRequired?: boolean;
  serialNumber?: string;
  assetTag?: string;
  isPresent?: boolean;
  notes?: string;
}

export interface ApparatusEquipmentUpdate extends Partial<Omit<ApparatusEquipmentCreate, 'apparatusId'>> {}

// =============================================================================
// Photos and Documents
// =============================================================================

export interface ApparatusPhoto {
  id: string;
  organizationId: string;
  apparatusId: string;
  filePath: string;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  title: string | null;
  description: string | null;
  takenAt: string | null;
  photoType: string | null;
  isPrimary: boolean;
  uploadedBy: string | null;
  uploadedAt: string;
}

export interface ApparatusDocument {
  id: string;
  organizationId: string;
  apparatusId: string;
  filePath: string;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  title: string;
  description: string | null;
  documentType: string;
  expirationDate: string | null;
  documentDate: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

// =============================================================================
// Custom Fields
// =============================================================================

export interface CustomFieldOption {
  value: string;
  label: string;
}

export interface ApparatusCustomField {
  id: string;
  organizationId: string;
  name: string;
  fieldKey: string;
  description: string | null;
  fieldType: CustomFieldType;
  isRequired: boolean;
  defaultValue: string | null;
  placeholder: string | null;
  options: CustomFieldOption[] | null;
  minValue: number | null;
  maxValue: number | null;
  minLength: number | null;
  maxLength: number | null;
  regexPattern: string | null;
  appliesToTypes: string[] | null;
  sortOrder: number;
  showInList: boolean;
  showInDetail: boolean;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}
