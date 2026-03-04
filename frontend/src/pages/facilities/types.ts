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
  findings?: string;
  correctiveActions?: string;
  correctiveActionDeadline?: string;
  correctiveActionCompleted?: boolean;
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
const ACRONYMS = new Set(['ada', 'hvac', 'id']);

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
