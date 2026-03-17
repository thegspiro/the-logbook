/**
 * facilitiesServices — typed API client for the facilities module
 */

import api from './apiClient';
import type { Location, LocationCreate } from './communicationsServices';
import type {
  Facility,
  FacilityType,
  FacilityStatus,
  MaintenanceRecord,
  MaintenanceType,
  Inspection,
  Room,
  FacilitySystem,
} from '../pages/facilities/types';

// ============================================
// Facilities Create / Update payloads
// ============================================

export interface FacilityTypeCreate {
  name: string;
  description?: string;
  category?: string;
}

export interface FacilityStatusCreate {
  name: string;
  description?: string;
  color?: string;
  is_operational?: boolean;
}

export interface FacilityCreate {
  name: string;
  facility_number?: string;
  facility_type_id?: string;
  status_id?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  county?: string;
  latitude?: number;
  longitude?: number;
  year_built?: number;
  year_renovated?: number;
  square_footage?: number;
  num_floors?: number;
  num_bays?: number;
  lot_size_acres?: number;
  is_owned?: boolean;
  lease_expiration?: string;
  property_tax_id?: string;
  max_occupancy?: number;
  sleeping_quarters?: number;
  phone?: string;
  fax?: string;
  email?: string;
  description?: string;
  notes?: string;
}

export interface MaintenanceRecordCreate {
  facility_id: string;
  maintenance_type_id?: string;
  system_id?: string;
  description?: string;
  scheduled_date?: string;
  due_date?: string;
  completed_date?: string;
  performed_by?: string;
  is_completed?: boolean;
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
}

export interface InspectionCreate {
  facility_id: string;
  inspection_type: string;
  title: string;
  description?: string;
  inspection_date: string;
  next_inspection_date?: string;
  passed?: boolean | null;
  inspector_name?: string;
  inspector_organization?: string;
  inspector_license_number?: string;
  inspector_agency?: string;
  findings?: string;
  corrective_actions?: string;
  corrective_action_deadline?: string;
  corrective_action_completed?: boolean;
  notes?: string;
}

export interface RoomCreate {
  facility_id: string;
  name: string;
  room_number?: string;
  floor?: number;
  room_type?: string;
  zone_classification?: string;
  square_footage?: number;
  capacity?: number;
  description?: string;
  equipment?: string;
}

export interface FacilitySystemCreate {
  facility_id: string;
  name: string;
  system_type: string;
  description?: string;
  manufacturer?: string;
  model_number?: string;
  serial_number?: string;
  install_date?: string;
  warranty_expiration?: string;
  expected_life_years?: number;
  condition?: string;
  last_tested_date?: string;
  next_test_due?: string;
  test_result?: string;
  certification_number?: string;
  certified_by?: string;
  test_frequency_days?: number;
  notes?: string;
}

export interface EmergencyContact {
  id: string;
  facilityId: string;
  contactType: string;
  companyName?: string;
  contactName?: string;
  phone?: string;
  altPhone?: string;
  email?: string;
  serviceContractNumber?: string;
  priority?: number;
  isActive?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmergencyContactCreate {
  facility_id: string;
  contact_type: string;
  company_name?: string;
  contact_name?: string;
  phone?: string;
  alt_phone?: string;
  email?: string;
  service_contract_number?: string;
  priority?: number;
}

export interface ShutoffLocation {
  id: string;
  facilityId: string;
  shutoffType: string;
  locationDescription?: string;
  floor?: number;
  photoPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShutoffLocationCreate {
  facility_id: string;
  shutoff_type: string;
  location_description?: string;
  floor?: number;
  photo_path?: string;
}

export interface CapitalProject {
  id: string;
  facilityId: string;
  projectType: string;
  name: string;
  description?: string;
  status: string;
  estimatedBudget?: number;
  actualCost?: number;
  startDate?: string;
  estimatedCompletionDate?: string;
  actualCompletionDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CapitalProjectCreate {
  facility_id: string;
  project_type: string;
  name: string;
  description?: string;
  status?: string;
  estimated_budget?: number;
  actual_cost?: number;
  start_date?: string;
  estimated_completion_date?: string;
}

export interface InsurancePolicy {
  id: string;
  facilityId: string;
  policyType: string;
  policyNumber?: string;
  provider?: string;
  coverageAmount?: number;
  deductible?: number;
  premiumAmount?: number;
  effectiveDate?: string;
  expirationDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InsurancePolicyCreate {
  facility_id: string;
  policy_type: string;
  policy_number?: string;
  provider?: string;
  coverage_amount?: number;
  deductible?: number;
  premium_amount?: number;
  effective_date?: string;
  expiration_date?: string;
}

export interface UtilityAccount {
  id: string;
  facilityId: string;
  utilityType: string;
  providerName?: string;
  accountNumber?: string;
  meterNumber?: string;
  billingCycle?: string;
  contactPhone?: string;
  contactEmail?: string;
  emergencyPhone?: string;
  isActive?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UtilityAccountCreate {
  facility_id: string;
  utility_type: string;
  provider_name?: string;
  account_number?: string;
  meter_number?: string;
  billing_cycle?: string;
  contact_phone?: string;
  contact_email?: string;
  emergency_phone?: string;
}

export interface UtilityReading {
  id: string;
  utilityAccountId: string;
  readingDate: string;
  periodStart?: string;
  periodEnd?: string;
  amount?: number;
  usageQuantity?: number;
  usageUnit?: string;
  createdAt: string;
}

export interface UtilityReadingCreate {
  reading_date: string;
  period_start?: string;
  period_end?: string;
  amount?: number;
  usage_quantity?: number;
  usage_unit?: string;
}

export interface AccessKey {
  id: string;
  facilityId: string;
  keyType: string;
  keyIdentifier?: string;
  description?: string;
  assignedToUserId?: string;
  assignedToName?: string;
  issuedDate?: string;
  returnedDate?: string;
  isActive?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccessKeyCreate {
  facility_id: string;
  key_type: string;
  key_identifier?: string;
  description?: string;
  assigned_to_user_id?: string;
  assigned_to_name?: string;
  issued_date?: string;
}

export interface ComplianceChecklist {
  id: string;
  facilityId: string;
  complianceType: string;
  title: string;
  description?: string;
  dueDate?: string;
  completedDate?: string;
  isCompleted?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceChecklistCreate {
  facility_id: string;
  compliance_type: string;
  title: string;
  description?: string;
  due_date?: string;
}

export interface ComplianceItem {
  id: string;
  checklistId: string;
  description: string;
  isCompleted: boolean;
  completedDate?: string;
  completedBy?: string;
  notes?: string;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceItemCreate {
  description: string;
  sort_order?: number;
  notes?: string;
}

export interface FacilityPhoto {
  id: string;
  facilityId: string;
  filePath: string;
  fileName?: string;
  mimeType?: string;
  caption?: string;
  isPrimary?: boolean;
  uploadedAt: string;
}

export interface FacilityDocument {
  id: string;
  facilityId: string;
  filePath: string;
  fileName?: string;
  mimeType?: string;
  documentType?: string;
  description?: string;
  documentDate?: string;
  expirationDate?: string;
  uploadedAt: string;
}

export interface Occupant {
  id: string;
  facilityId: string;
  userId?: string;
  name?: string;
  occupantType?: string;
  startDate?: string;
  endDate?: string;
  isActive?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OccupantCreate {
  facility_id: string;
  user_id?: string;
  name?: string;
  occupant_type?: string;
  start_date?: string;
}

// ============================================
// Facilities Service
// ============================================

export const facilitiesService = {
  // Facility Types
  async getTypes(): Promise<FacilityType[]> {
    const response = await api.get<FacilityType[]>('/facilities/types');
    return response.data;
  },
  async createType(data: FacilityTypeCreate): Promise<FacilityType> {
    const response = await api.post<FacilityType>('/facilities/types', data);
    return response.data;
  },
  async updateType(typeId: string, data: Partial<FacilityTypeCreate>): Promise<FacilityType> {
    const response = await api.patch<FacilityType>(`/facilities/types/${typeId}`, data);
    return response.data;
  },
  async deleteType(typeId: string): Promise<void> {
    await api.delete(`/facilities/types/${typeId}`);
  },

  // Facility Statuses
  async getStatuses(): Promise<FacilityStatus[]> {
    const response = await api.get<FacilityStatus[]>('/facilities/statuses');
    return response.data;
  },
  async createStatus(data: FacilityStatusCreate): Promise<FacilityStatus> {
    const response = await api.post<FacilityStatus>('/facilities/statuses', data);
    return response.data;
  },
  async updateStatus(statusId: string, data: Partial<FacilityStatusCreate>): Promise<FacilityStatus> {
    const response = await api.patch<FacilityStatus>(`/facilities/statuses/${statusId}`, data);
    return response.data;
  },
  async deleteStatus(statusId: string): Promise<void> {
    await api.delete(`/facilities/statuses/${statusId}`);
  },

  // Facilities CRUD
  async getFacilities(params?: { facility_type_id?: string; status_id?: string; is_archived?: boolean; skip?: number; limit?: number }): Promise<Facility[]> {
    const response = await api.get<Facility[]>('/facilities', { params });
    return response.data;
  },
  async getFacility(facilityId: string): Promise<Facility> {
    const response = await api.get<Facility>(`/facilities/${facilityId}`);
    return response.data;
  },
  async createFacility(data: FacilityCreate): Promise<Facility> {
    const response = await api.post<Facility>('/facilities', data);
    return response.data;
  },
  async updateFacility(facilityId: string, data: Partial<FacilityCreate>): Promise<Facility> {
    const response = await api.patch<Facility>(`/facilities/${facilityId}`, data);
    return response.data;
  },
  async archiveFacility(facilityId: string): Promise<Facility> {
    const response = await api.post<Facility>(`/facilities/${facilityId}/archive`);
    return response.data;
  },
  async restoreFacility(facilityId: string): Promise<Facility> {
    const response = await api.post<Facility>(`/facilities/${facilityId}/restore`);
    return response.data;
  },

  // Maintenance
  async getMaintenanceRecords(params?: { facility_id?: string; status?: string; skip?: number; limit?: number }): Promise<MaintenanceRecord[]> {
    const response = await api.get<MaintenanceRecord[]>('/facilities/maintenance', { params });
    return response.data;
  },
  async getMaintenanceRecord(recordId: string): Promise<MaintenanceRecord> {
    const response = await api.get<MaintenanceRecord>(`/facilities/maintenance/${recordId}`);
    return response.data;
  },
  async createMaintenanceRecord(data: MaintenanceRecordCreate): Promise<MaintenanceRecord> {
    const response = await api.post<MaintenanceRecord>('/facilities/maintenance', data);
    return response.data;
  },
  async updateMaintenanceRecord(recordId: string, data: Partial<MaintenanceRecordCreate>): Promise<MaintenanceRecord> {
    const response = await api.patch<MaintenanceRecord>(`/facilities/maintenance/${recordId}`, data);
    return response.data;
  },
  async deleteMaintenanceRecord(recordId: string): Promise<void> {
    await api.delete(`/facilities/maintenance/${recordId}`);
  },

  // Inspections
  async getInspections(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<Inspection[]> {
    const response = await api.get<Inspection[]>('/facilities/inspections', { params });
    return response.data;
  },
  async getInspection(inspectionId: string): Promise<Inspection> {
    const response = await api.get<Inspection>(`/facilities/inspections/${inspectionId}`);
    return response.data;
  },
  async createInspection(data: InspectionCreate): Promise<Inspection> {
    const response = await api.post<Inspection>('/facilities/inspections', data);
    return response.data;
  },
  async updateInspection(inspectionId: string, data: Partial<InspectionCreate>): Promise<Inspection> {
    const response = await api.patch<Inspection>(`/facilities/inspections/${inspectionId}`, data);
    return response.data;
  },
  async deleteInspection(inspectionId: string): Promise<void> {
    await api.delete(`/facilities/inspections/${inspectionId}`);
  },

  // Rooms
  async getRooms(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<Room[]> {
    const response = await api.get<Room[]>('/facilities/rooms', { params });
    return response.data;
  },
  async getRoom(roomId: string): Promise<Room> {
    const response = await api.get<Room>(`/facilities/rooms/${roomId}`);
    return response.data;
  },
  async createRoom(data: RoomCreate): Promise<Room> {
    const response = await api.post<Room>('/facilities/rooms', data);
    return response.data;
  },
  async updateRoom(roomId: string, data: Partial<RoomCreate>): Promise<Room> {
    const response = await api.patch<Room>(`/facilities/rooms/${roomId}`, data);
    return response.data;
  },
  async deleteRoom(roomId: string): Promise<void> {
    await api.delete(`/facilities/rooms/${roomId}`);
  },

  // Maintenance Types
  async getMaintenanceTypes(params?: { skip?: number; limit?: number }): Promise<MaintenanceType[]> {
    const response = await api.get<MaintenanceType[]>('/facilities/maintenance-types', { params });
    return response.data;
  },
  async createMaintenanceType(data: { name: string; description?: string; category?: string; default_interval_value?: number; default_interval_unit?: string }): Promise<MaintenanceType> {
    const response = await api.post<MaintenanceType>('/facilities/maintenance-types', data);
    return response.data;
  },
  async updateMaintenanceType(typeId: string, data: Record<string, unknown>): Promise<MaintenanceType> {
    const response = await api.patch<MaintenanceType>(`/facilities/maintenance-types/${typeId}`, data);
    return response.data;
  },
  async deleteMaintenanceType(typeId: string): Promise<void> {
    await api.delete(`/facilities/maintenance-types/${typeId}`);
  },

  // Building Systems
  async getSystems(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<FacilitySystem[]> {
    const response = await api.get<FacilitySystem[]>('/facilities/systems', { params });
    return response.data;
  },
  async getSystem(systemId: string): Promise<FacilitySystem> {
    const response = await api.get<FacilitySystem>(`/facilities/systems/${systemId}`);
    return response.data;
  },
  async createSystem(data: FacilitySystemCreate): Promise<FacilitySystem> {
    const response = await api.post<FacilitySystem>('/facilities/systems', data);
    return response.data;
  },
  async updateSystem(systemId: string, data: Partial<FacilitySystemCreate>): Promise<FacilitySystem> {
    const response = await api.patch<FacilitySystem>(`/facilities/systems/${systemId}`, data);
    return response.data;
  },
  async deleteSystem(systemId: string): Promise<void> {
    await api.delete(`/facilities/systems/${systemId}`);
  },

  // Emergency Contacts
  async getEmergencyContacts(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<EmergencyContact[]> {
    const response = await api.get<EmergencyContact[]>('/facilities/emergency-contacts', { params });
    return response.data;
  },
  async createEmergencyContact(data: EmergencyContactCreate): Promise<EmergencyContact> {
    const response = await api.post<EmergencyContact>('/facilities/emergency-contacts', data);
    return response.data;
  },
  async updateEmergencyContact(contactId: string, data: Partial<EmergencyContactCreate>): Promise<EmergencyContact> {
    const response = await api.patch<EmergencyContact>(`/facilities/emergency-contacts/${contactId}`, data);
    return response.data;
  },
  async deleteEmergencyContact(contactId: string): Promise<void> {
    await api.delete(`/facilities/emergency-contacts/${contactId}`);
  },

  // Shutoff Locations
  async getShutoffLocations(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<ShutoffLocation[]> {
    const response = await api.get<ShutoffLocation[]>('/facilities/shutoff-locations', { params });
    return response.data;
  },
  async createShutoffLocation(data: ShutoffLocationCreate): Promise<ShutoffLocation> {
    const response = await api.post<ShutoffLocation>('/facilities/shutoff-locations', data);
    return response.data;
  },
  async updateShutoffLocation(locationId: string, data: Partial<ShutoffLocationCreate>): Promise<ShutoffLocation> {
    const response = await api.patch<ShutoffLocation>(`/facilities/shutoff-locations/${locationId}`, data);
    return response.data;
  },
  async deleteShutoffLocation(locationId: string): Promise<void> {
    await api.delete(`/facilities/shutoff-locations/${locationId}`);
  },

  // Capital Projects
  async getCapitalProjects(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<CapitalProject[]> {
    const response = await api.get<CapitalProject[]>('/facilities/capital-projects', { params });
    return response.data;
  },
  async getCapitalProject(projectId: string): Promise<CapitalProject> {
    const response = await api.get<CapitalProject>(`/facilities/capital-projects/${projectId}`);
    return response.data;
  },
  async createCapitalProject(data: CapitalProjectCreate): Promise<CapitalProject> {
    const response = await api.post<CapitalProject>('/facilities/capital-projects', data);
    return response.data;
  },
  async updateCapitalProject(projectId: string, data: Partial<CapitalProjectCreate>): Promise<CapitalProject> {
    const response = await api.patch<CapitalProject>(`/facilities/capital-projects/${projectId}`, data);
    return response.data;
  },
  async deleteCapitalProject(projectId: string): Promise<void> {
    await api.delete(`/facilities/capital-projects/${projectId}`);
  },

  // Insurance Policies
  async getInsurancePolicies(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<InsurancePolicy[]> {
    const response = await api.get<InsurancePolicy[]>('/facilities/insurance-policies', { params });
    return response.data;
  },
  async getInsurancePolicy(policyId: string): Promise<InsurancePolicy> {
    const response = await api.get<InsurancePolicy>(`/facilities/insurance-policies/${policyId}`);
    return response.data;
  },
  async createInsurancePolicy(data: InsurancePolicyCreate): Promise<InsurancePolicy> {
    const response = await api.post<InsurancePolicy>('/facilities/insurance-policies', data);
    return response.data;
  },
  async updateInsurancePolicy(policyId: string, data: Partial<InsurancePolicyCreate>): Promise<InsurancePolicy> {
    const response = await api.patch<InsurancePolicy>(`/facilities/insurance-policies/${policyId}`, data);
    return response.data;
  },
  async deleteInsurancePolicy(policyId: string): Promise<void> {
    await api.delete(`/facilities/insurance-policies/${policyId}`);
  },

  // Occupants
  async getOccupants(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<Occupant[]> {
    const response = await api.get<Occupant[]>('/facilities/occupants', { params });
    return response.data;
  },
  async getOccupant(occupantId: string): Promise<Occupant> {
    const response = await api.get<Occupant>(`/facilities/occupants/${occupantId}`);
    return response.data;
  },
  async createOccupant(data: OccupantCreate): Promise<Occupant> {
    const response = await api.post<Occupant>('/facilities/occupants', data);
    return response.data;
  },
  async updateOccupant(occupantId: string, data: Partial<OccupantCreate>): Promise<Occupant> {
    const response = await api.patch<Occupant>(`/facilities/occupants/${occupantId}`, data);
    return response.data;
  },
  async deleteOccupant(occupantId: string): Promise<void> {
    await api.delete(`/facilities/occupants/${occupantId}`);
  },

  // Utility Accounts
  async getUtilityAccounts(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<UtilityAccount[]> {
    const response = await api.get<UtilityAccount[]>('/facilities/utility-accounts', { params });
    return response.data;
  },
  async getUtilityAccount(accountId: string): Promise<UtilityAccount> {
    const response = await api.get<UtilityAccount>(`/facilities/utility-accounts/${accountId}`);
    return response.data;
  },
  async createUtilityAccount(data: UtilityAccountCreate): Promise<UtilityAccount> {
    const response = await api.post<UtilityAccount>('/facilities/utility-accounts', data);
    return response.data;
  },
  async updateUtilityAccount(accountId: string, data: Partial<UtilityAccountCreate>): Promise<UtilityAccount> {
    const response = await api.patch<UtilityAccount>(`/facilities/utility-accounts/${accountId}`, data);
    return response.data;
  },
  async deleteUtilityAccount(accountId: string): Promise<void> {
    await api.delete(`/facilities/utility-accounts/${accountId}`);
  },

  // Photos
  async getPhotos(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<FacilityPhoto[]> {
    const response = await api.get<FacilityPhoto[]>('/facilities/photos', { params });
    return response.data;
  },
  async createPhoto(data: Record<string, unknown>): Promise<FacilityPhoto> {
    const response = await api.post<FacilityPhoto>('/facilities/photos', data);
    return response.data;
  },
  async updatePhoto(photoId: string, data: Record<string, unknown>): Promise<FacilityPhoto> {
    const response = await api.patch<FacilityPhoto>(`/facilities/photos/${photoId}`, data);
    return response.data;
  },
  async deletePhoto(photoId: string): Promise<void> {
    await api.delete(`/facilities/photos/${photoId}`);
  },

  // Documents
  async getFacilityDocuments(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<FacilityDocument[]> {
    const response = await api.get<FacilityDocument[]>('/facilities/documents', { params });
    return response.data;
  },
  async createFacilityDocument(data: Record<string, unknown>): Promise<FacilityDocument> {
    const response = await api.post<FacilityDocument>('/facilities/documents', data);
    return response.data;
  },
  async updateFacilityDocument(documentId: string, data: Record<string, unknown>): Promise<FacilityDocument> {
    const response = await api.patch<FacilityDocument>(`/facilities/documents/${documentId}`, data);
    return response.data;
  },
  async deleteFacilityDocument(documentId: string): Promise<void> {
    await api.delete(`/facilities/documents/${documentId}`);
  },

  // Utility Readings
  async getUtilityReadings(accountId: string, params?: { skip?: number; limit?: number }): Promise<UtilityReading[]> {
    const response = await api.get<UtilityReading[]>(`/facilities/utility-accounts/${accountId}/readings`, { params });
    return response.data;
  },
  async createUtilityReading(accountId: string, data: UtilityReadingCreate): Promise<UtilityReading> {
    const response = await api.post<UtilityReading>(`/facilities/utility-accounts/${accountId}/readings`, data);
    return response.data;
  },
  async updateUtilityReading(readingId: string, data: Partial<UtilityReadingCreate>): Promise<UtilityReading> {
    const response = await api.patch<UtilityReading>(`/facilities/utility-readings/${readingId}`, data);
    return response.data;
  },
  async deleteUtilityReading(readingId: string): Promise<void> {
    await api.delete(`/facilities/utility-readings/${readingId}`);
  },

  // Access Keys
  async getAccessKeys(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<AccessKey[]> {
    const response = await api.get<AccessKey[]>('/facilities/access-keys', { params });
    return response.data;
  },
  async getAccessKey(keyId: string): Promise<AccessKey> {
    const response = await api.get<AccessKey>(`/facilities/access-keys/${keyId}`);
    return response.data;
  },
  async createAccessKey(data: AccessKeyCreate): Promise<AccessKey> {
    const response = await api.post<AccessKey>('/facilities/access-keys', data);
    return response.data;
  },
  async updateAccessKey(keyId: string, data: Partial<AccessKeyCreate>): Promise<AccessKey> {
    const response = await api.patch<AccessKey>(`/facilities/access-keys/${keyId}`, data);
    return response.data;
  },
  async deleteAccessKey(keyId: string): Promise<void> {
    await api.delete(`/facilities/access-keys/${keyId}`);
  },

  // Compliance Checklists
  async getComplianceChecklists(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<ComplianceChecklist[]> {
    const response = await api.get<ComplianceChecklist[]>('/facilities/compliance-checklists', { params });
    return response.data;
  },
  async getComplianceChecklist(checklistId: string): Promise<ComplianceChecklist> {
    const response = await api.get<ComplianceChecklist>(`/facilities/compliance-checklists/${checklistId}`);
    return response.data;
  },
  async createComplianceChecklist(data: ComplianceChecklistCreate): Promise<ComplianceChecklist> {
    const response = await api.post<ComplianceChecklist>('/facilities/compliance-checklists', data);
    return response.data;
  },
  async updateComplianceChecklist(checklistId: string, data: Partial<ComplianceChecklistCreate>): Promise<ComplianceChecklist> {
    const response = await api.patch<ComplianceChecklist>(`/facilities/compliance-checklists/${checklistId}`, data);
    return response.data;
  },
  async deleteComplianceChecklist(checklistId: string): Promise<void> {
    await api.delete(`/facilities/compliance-checklists/${checklistId}`);
  },

  // Compliance Items
  async getComplianceItems(checklistId: string): Promise<ComplianceItem[]> {
    const response = await api.get<ComplianceItem[]>(`/facilities/compliance-checklists/${checklistId}/items`);
    return response.data;
  },
  async createComplianceItem(checklistId: string, data: ComplianceItemCreate): Promise<ComplianceItem> {
    const response = await api.post<ComplianceItem>(`/facilities/compliance-checklists/${checklistId}/items`, data);
    return response.data;
  },
  async updateComplianceItem(itemId: string, data: Partial<ComplianceItemCreate>): Promise<ComplianceItem> {
    const response = await api.patch<ComplianceItem>(`/facilities/compliance-items/${itemId}`, data);
    return response.data;
  },
  async deleteComplianceItem(itemId: string): Promise<void> {
    await api.delete(`/facilities/compliance-items/${itemId}`);
  },
};

// ============================================
// Member Status Service
// ============================================

export interface LeaveOfAbsenceResponse {
  id: string;
  organization_id: string;
  user_id: string;
  leave_type: string;
  reason: string | null;
  start_date: string;
  end_date: string | null;
  granted_by: string | null;
  granted_at: string | null;
  active: boolean;
  exempt_from_training_waiver: boolean;
  linked_training_waiver_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface TrainingWaiverResponse {
  id: string;
  organization_id: string;
  user_id: string;
  waiver_type: string;
  reason: string | null;
  start_date: string;
  end_date: string | null;
  requirement_ids: string[] | null;
  granted_by: string | null;
  granted_at: string | null;
  active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export const locationsService = {
  async getLocations(params?: { is_active?: boolean; exclude_rooms?: boolean; skip?: number; limit?: number }): Promise<Location[]> {
    const response = await api.get<Location[]>('/locations', { params });
    return response.data;
  },

  async getLocation(locationId: string): Promise<Location> {
    const response = await api.get<Location>(`/locations/${locationId}`);
    return response.data;
  },

  async createLocation(data: LocationCreate): Promise<Location> {
    const response = await api.post<Location>('/locations', data);
    return response.data;
  },

  async updateLocation(locationId: string, data: Partial<LocationCreate>): Promise<Location> {
    const response = await api.patch<Location>(`/locations/${locationId}`, data);
    return response.data;
  },

  async deleteLocation(locationId: string): Promise<void> {
    await api.delete(`/locations/${locationId}`);
  },
};

// ============================================
// Operational Ranks Service
// ============================================

export interface OperationalRankResponse {
  id: string;
  organization_id: string;
  rank_code: string;
  display_name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  eligible_positions: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface OperationalRankCreate {
  rank_code: string;
  display_name: string;
  description?: string;
  sort_order?: number;
  is_active?: boolean;
  eligible_positions?: string[];
}

export interface OperationalRankUpdate {
  rank_code?: string;
  display_name?: string;
  description?: string | null;
  sort_order?: number;
  is_active?: boolean;
  eligible_positions?: string[];
}

export interface RankValidationIssue {
  member_id: string;
  member_name: string;
  rank_code: string;
}

export interface RankValidationResponse {
  issues: RankValidationIssue[];
  total: number;
}

export const ranksService = {
  async getRanks(params?: { is_active?: boolean }): Promise<OperationalRankResponse[]> {
    const response = await api.get<OperationalRankResponse[]>('/operational-ranks', { params });
    return response.data;
  },

  async getRank(rankId: string): Promise<OperationalRankResponse> {
    const response = await api.get<OperationalRankResponse>(`/operational-ranks/${rankId}`);
    return response.data;
  },

  async createRank(data: OperationalRankCreate): Promise<OperationalRankResponse> {
    const response = await api.post<OperationalRankResponse>('/operational-ranks', data);
    return response.data;
  },

  async updateRank(rankId: string, data: OperationalRankUpdate): Promise<OperationalRankResponse> {
    const response = await api.patch<OperationalRankResponse>(`/operational-ranks/${rankId}`, data);
    return response.data;
  },

  async deleteRank(rankId: string): Promise<void> {
    await api.delete(`/operational-ranks/${rankId}`);
  },

  async reorderRanks(ranks: { id: string; sort_order: number }[]): Promise<OperationalRankResponse[]> {
    const response = await api.post<OperationalRankResponse[]>('/operational-ranks/reorder', { ranks });
    return response.data;
  },

  async validateRanks(): Promise<RankValidationResponse> {
    const response = await api.get<RankValidationResponse>('/operational-ranks/validate');
    return response.data;
  },
};

// ============================================
// Security Monitoring Service
// ============================================

export interface SecurityStatus {
  timestamp: string;
  overall_status: string;
  alerts: {
    total_last_hour: number;
    by_severity: Record<string, number>;
  };
  metrics: Record<string, unknown>;
}

export interface SecurityAlert {
  id: string;
  alert_type: string;
  threat_level: string;
  message: string;
  timestamp: string;
  acknowledged: boolean;
}
