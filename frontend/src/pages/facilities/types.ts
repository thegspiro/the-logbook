/**
 * Facilities module TypeScript interfaces
 * Maps to the backend database models in app/models/facilities.py
 */

export interface FacilityType {
  id: string;
  name: string;
  description?: string;
  category?: string;
  is_system?: boolean;
  is_active?: boolean;
}

export interface FacilityStatus {
  id: string;
  name: string;
  description?: string;
  color?: string;
  is_operational?: boolean;
  is_system?: boolean;
  is_active?: boolean;
}

export interface Facility {
  id: string;
  name: string;
  facility_number?: string;
  facility_type_id?: string;
  facility_type?: FacilityType;
  status_id?: string;
  status?: FacilityStatus;
  // Address
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  county?: string;
  // Coordinates
  latitude?: number;
  longitude?: number;
  // Building Info
  year_built?: number;
  year_renovated?: number;
  square_footage?: number;
  num_floors?: number;
  num_bays?: number;
  lot_size_acres?: number;
  // Ownership
  is_owned?: boolean;
  lease_expiration?: string;
  property_tax_id?: string;
  // Capacity
  max_occupancy?: number;
  sleeping_quarters?: number;
  // Contact
  phone?: string;
  fax?: string;
  email?: string;
  // Details
  description?: string;
  notes?: string;
  // Status
  is_archived: boolean;
  archived_at?: string;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceType {
  id: string;
  name: string;
  description?: string;
  category?: string;
  default_interval_value?: number;
  default_interval_unit?: string;
  is_system?: boolean;
  is_active?: boolean;
}

export interface MaintenanceRecord {
  id: string;
  facility_id: string;
  facility?: Facility;
  maintenance_type_id?: string;
  maintenance_type?: MaintenanceType;
  system_id?: string;
  scheduled_date?: string;
  due_date?: string;
  completed_date?: string;
  performed_by?: string;
  is_completed: boolean;
  is_overdue?: boolean;
  description?: string;
  work_performed?: string;
  findings?: string;
  cost?: number;
  vendor?: string;
  invoice_number?: string;
  work_order_number?: string;
  next_due_date?: string;
  notes?: string;
  is_historic?: boolean;
  occurred_date?: string;
  historic_source?: string;
  created_at: string;
  updated_at: string;
}

export interface Inspection {
  id: string;
  facility_id: string;
  facility?: Facility;
  inspection_type: string;
  title: string;
  description?: string;
  inspection_date: string;
  next_inspection_date?: string;
  passed?: boolean | null;
  inspector_name?: string;
  inspector_organization?: string;
  certificate_number?: string;
  findings?: string;
  corrective_actions?: string;
  corrective_action_deadline?: string;
  corrective_action_completed?: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Room {
  id: string;
  facility_id: string;
  name: string;
  room_number?: string;
  floor?: number;
  room_type?: string;
  square_footage?: number;
  capacity?: number;
  description?: string;
  equipment?: string;
  is_active?: boolean;
  created_at: string;
  updated_at: string;
}

export type TabId = 'facilities' | 'maintenance' | 'inspections';

export const INSPECTION_TYPES = [
  'FIRE', 'BUILDING_CODE', 'HEALTH', 'ADA', 'ENVIRONMENTAL',
  'INSURANCE', 'ROUTINE', 'OTHER',
] as const;

export const MAINTENANCE_CATEGORIES = [
  'PREVENTIVE', 'REPAIR', 'INSPECTION', 'RENOVATION',
  'CLEANING', 'SAFETY', 'OTHER',
] as const;

export const ROOM_TYPES = [
  'APPARATUS_BAY', 'BUNK_ROOM', 'KITCHEN', 'BATHROOM', 'OFFICE',
  'TRAINING_ROOM', 'STORAGE', 'MECHANICAL', 'LOBBY', 'COMMON_AREA',
  'LAUNDRY', 'GYM', 'DECONTAMINATION', 'DISPATCH', 'OTHER',
] as const;
