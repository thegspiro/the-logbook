/**
 * Facilities module TypeScript interfaces
 * Maps to the backend database models in app/models/facilities.py
 *
 * Property names use camelCase to match the API response format.
 * The backend Pydantic schemas use alias_generator=to_camel, so JSON
 * fields are serialized as camelCase (e.g., addressLine1, zipCode).
 */

export interface FacilityType {
  id: string;
  name: string;
  description?: string;
  category?: string;
  isSystem?: boolean;
  isActive?: boolean;
}

export interface FacilityStatus {
  id: string;
  name: string;
  description?: string;
  color?: string;
  isOperational?: boolean;
  isSystem?: boolean;
  isActive?: boolean;
}

export interface Facility {
  id: string;
  name: string;
  facilityNumber?: string;
  facilityTypeId?: string;
  facilityType?: FacilityType;
  statusId?: string;
  statusRecord?: FacilityStatus;
  // Address
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  county?: string;
  // Coordinates
  latitude?: number;
  longitude?: number;
  // Building Info
  yearBuilt?: number;
  yearRenovated?: number;
  squareFootage?: number;
  numFloors?: number;
  numBays?: number;
  lotSizeAcres?: number;
  // Ownership
  isOwned?: boolean;
  leaseExpiration?: string;
  propertyTaxId?: string;
  // Capacity
  maxOccupancy?: number;
  sleepingQuarters?: number;
  // Contact
  phone?: string;
  fax?: string;
  email?: string;
  // Details
  description?: string;
  notes?: string;
  // Status
  isArchived: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceType {
  id: string;
  name: string;
  description?: string;
  category?: string;
  defaultIntervalValue?: number;
  defaultIntervalUnit?: string;
  isSystem?: boolean;
  isActive?: boolean;
}

export interface MaintenanceRecord {
  id: string;
  facilityId: string;
  facility?: Facility;
  maintenanceTypeId?: string;
  maintenanceType?: MaintenanceType;
  systemId?: string;
  scheduledDate?: string;
  dueDate?: string;
  completedDate?: string;
  performedBy?: string;
  isCompleted: boolean;
  isOverdue?: boolean;
  description?: string;
  workPerformed?: string;
  findings?: string;
  cost?: number;
  vendor?: string;
  invoiceNumber?: string;
  workOrderNumber?: string;
  nextDueDate?: string;
  notes?: string;
  isHistoric?: boolean;
  occurredDate?: string;
  historicSource?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FacilitySystem {
  id: string;
  facilityId: string;
  name: string;
  systemType: string;
  description?: string;
  manufacturer?: string;
  modelNumber?: string;
  serialNumber?: string;
  installDate?: string;
  warrantyExpiration?: string;
  expectedLifeYears?: number;
  condition: string;
  lastServicedDate?: string;
  lastInspectedDate?: string;
  // Certification / testing (NFPA compliance)
  lastTestedDate?: string;
  nextTestDue?: string;
  testResult?: string;
  certificationNumber?: string;
  certifiedBy?: string;
  testFrequencyDays?: number;
  notes?: string;
  sortOrder?: number;
  isActive?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Inspection {
  id: string;
  facilityId: string;
  facility?: Facility;
  inspectionType: string;
  title: string;
  description?: string;
  inspectionDate: string;
  nextInspectionDate?: string;
  passed?: boolean | null;
  inspectorName?: string;
  inspectorOrganization?: string;
  certificateNumber?: string;
  inspectorLicenseNumber?: string;
  inspectorAgency?: string;
  findings?: string;
  correctiveActions?: string;
  correctiveActionDeadline?: string;
  correctiveActionCompleted?: boolean;
  correctiveActionCompletedDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Room {
  id: string;
  facilityId: string;
  name: string;
  roomNumber?: string;
  floor?: number;
  roomType?: string;
  zoneClassification?: string;
  squareFootage?: number;
  capacity?: number;
  description?: string;
  equipment?: string;
  isActive?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type TabId = 'facilities' | 'maintenance' | 'inspections';

/** Words that should stay fully uppercased when formatting enum labels */
const ACRONYMS = new Set(['ada', 'hvac', 'id', 'ppe', 'nfpa', 'osha']);

/** Convert a snake_case enum value to a human-readable label (e.g. "building_code" → "Building Code") */
export function enumLabel(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .split('_')
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export const INSPECTION_TYPES = [
  'fire', 'building_code', 'health', 'ada', 'environmental',
  'insurance', 'routine', 'other',
] as const;

export const MAINTENANCE_CATEGORIES = [
  'preventive', 'repair', 'inspection', 'renovation',
  'cleaning', 'safety', 'other',
] as const;

export const ROOM_TYPES = [
  'apparatus_bay', 'bunk_room', 'kitchen', 'bathroom', 'office',
  'training_room', 'storage', 'mechanical', 'lobby', 'common_area',
  'laundry', 'gym', 'decontamination', 'dispatch', 'other',
] as const;

export const SYSTEM_TYPES = [
  'hvac', 'electrical', 'plumbing', 'fire_suppression', 'fire_alarm',
  'security', 'roofing', 'structural', 'elevator', 'generator',
  'communications', 'doors_windows', 'flooring', 'painting',
  'landscaping', 'parking', 'exhaust_extraction', 'cascade_air',
  'decontamination', 'bay_door', 'air_quality_monitor', 'ppe_cleaning',
  'alerting_system', 'shore_power', 'other',
] as const;

export const ZONE_CLASSIFICATIONS = [
  'hot', 'transition', 'cold', 'unclassified',
] as const;

/** Color mapping for zone classification badges */
export const ZONE_CLASSIFICATION_COLORS: Record<string, string> = {
  hot: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  transition: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  cold: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  unclassified: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
} as const;
