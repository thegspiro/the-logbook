/**
 * facilitiesServices — extracted from services/api.ts
 */

import api from './apiClient';
import type { Location, LocationCreate } from './communicationsServices';

export const facilitiesService = {
  // Facility Types
  async getTypes(): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>('/facilities/types');
    return response.data;
  },
  async createType(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/facilities/types', data);
    return response.data;
  },
  async updateType(typeId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/types/${typeId}`, data);
    return response.data;
  },
  async deleteType(typeId: string): Promise<void> {
    await api.delete(`/facilities/types/${typeId}`);
  },

  // Facility Statuses
  async getStatuses(): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>('/facilities/statuses');
    return response.data;
  },
  async createStatus(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/facilities/statuses', data);
    return response.data;
  },
  async updateStatus(statusId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/statuses/${statusId}`, data);
    return response.data;
  },
  async deleteStatus(statusId: string): Promise<void> {
    await api.delete(`/facilities/statuses/${statusId}`);
  },

  // Facilities CRUD
  async getFacilities(params?: { facility_type_id?: string; status_id?: string; is_archived?: boolean; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>('/facilities', { params });
    return response.data;
  },
  async getFacility(facilityId: string): Promise<Record<string, unknown>> {
    const response = await api.get<Record<string, unknown>>(`/facilities/${facilityId}`);
    return response.data;
  },
  async createFacility(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/facilities', data);
    return response.data;
  },
  async updateFacility(facilityId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/${facilityId}`, data);
    return response.data;
  },
  async archiveFacility(facilityId: string): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>(`/facilities/${facilityId}/archive`);
    return response.data;
  },
  async restoreFacility(facilityId: string): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>(`/facilities/${facilityId}/restore`);
    return response.data;
  },

  // Maintenance
  async getMaintenanceRecords(params?: { facility_id?: string; status?: string; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>('/facilities/maintenance', { params });
    return response.data;
  },
  async getMaintenanceRecord(recordId: string): Promise<Record<string, unknown>> {
    const response = await api.get<Record<string, unknown>>(`/facilities/maintenance/${recordId}`);
    return response.data;
  },
  async createMaintenanceRecord(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/facilities/maintenance', data);
    return response.data;
  },
  async updateMaintenanceRecord(recordId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/maintenance/${recordId}`, data);
    return response.data;
  },
  async deleteMaintenanceRecord(recordId: string): Promise<void> {
    await api.delete(`/facilities/maintenance/${recordId}`);
  },

  // Inspections
  async getInspections(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>('/facilities/inspections', { params });
    return response.data;
  },
  async getInspection(inspectionId: string): Promise<Record<string, unknown>> {
    const response = await api.get<Record<string, unknown>>(`/facilities/inspections/${inspectionId}`);
    return response.data;
  },
  async createInspection(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/facilities/inspections', data);
    return response.data;
  },
  async updateInspection(inspectionId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/inspections/${inspectionId}`, data);
    return response.data;
  },
  async deleteInspection(inspectionId: string): Promise<void> {
    await api.delete(`/facilities/inspections/${inspectionId}`);
  },

  // Rooms
  async getRooms(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>('/facilities/rooms', { params });
    return response.data;
  },
  async getRoom(roomId: string): Promise<Record<string, unknown>> {
    const response = await api.get<Record<string, unknown>>(`/facilities/rooms/${roomId}`);
    return response.data;
  },
  async createRoom(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/facilities/rooms', data);
    return response.data;
  },
  async updateRoom(roomId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/rooms/${roomId}`, data);
    return response.data;
  },
  async deleteRoom(roomId: string): Promise<void> {
    await api.delete(`/facilities/rooms/${roomId}`);
  },

  // Maintenance Types
  async getMaintenanceTypes(params?: { skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>('/facilities/maintenance-types', { params });
    return response.data;
  },
  async createMaintenanceType(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/facilities/maintenance-types', data);
    return response.data;
  },
  async updateMaintenanceType(typeId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/maintenance-types/${typeId}`, data);
    return response.data;
  },
  async deleteMaintenanceType(typeId: string): Promise<void> {
    await api.delete(`/facilities/maintenance-types/${typeId}`);
  },

  // Building Systems
  async getSystems(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>('/facilities/systems', { params });
    return response.data;
  },
  async getSystem(systemId: string): Promise<Record<string, unknown>> {
    const response = await api.get<Record<string, unknown>>(`/facilities/systems/${systemId}`);
    return response.data;
  },
  async createSystem(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/facilities/systems', data);
    return response.data;
  },
  async updateSystem(systemId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/systems/${systemId}`, data);
    return response.data;
  },
  async deleteSystem(systemId: string): Promise<void> {
    await api.delete(`/facilities/systems/${systemId}`);
  },

  // Emergency Contacts
  async getEmergencyContacts(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>('/facilities/emergency-contacts', { params });
    return response.data;
  },
  async createEmergencyContact(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/facilities/emergency-contacts', data);
    return response.data;
  },
  async updateEmergencyContact(contactId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/emergency-contacts/${contactId}`, data);
    return response.data;
  },
  async deleteEmergencyContact(contactId: string): Promise<void> {
    await api.delete(`/facilities/emergency-contacts/${contactId}`);
  },

  // Shutoff Locations
  async getShutoffLocations(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>('/facilities/shutoff-locations', { params });
    return response.data;
  },
  async createShutoffLocation(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/facilities/shutoff-locations', data);
    return response.data;
  },
  async updateShutoffLocation(locationId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/shutoff-locations/${locationId}`, data);
    return response.data;
  },
  async deleteShutoffLocation(locationId: string): Promise<void> {
    await api.delete(`/facilities/shutoff-locations/${locationId}`);
  },

  // Capital Projects
  async getCapitalProjects(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>('/facilities/capital-projects', { params });
    return response.data;
  },
  async getCapitalProject(projectId: string): Promise<Record<string, unknown>> {
    const response = await api.get<Record<string, unknown>>(`/facilities/capital-projects/${projectId}`);
    return response.data;
  },
  async createCapitalProject(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/facilities/capital-projects', data);
    return response.data;
  },
  async updateCapitalProject(projectId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/capital-projects/${projectId}`, data);
    return response.data;
  },
  async deleteCapitalProject(projectId: string): Promise<void> {
    await api.delete(`/facilities/capital-projects/${projectId}`);
  },

  // Insurance Policies
  async getInsurancePolicies(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>('/facilities/insurance-policies', { params });
    return response.data;
  },
  async getInsurancePolicy(policyId: string): Promise<Record<string, unknown>> {
    const response = await api.get<Record<string, unknown>>(`/facilities/insurance-policies/${policyId}`);
    return response.data;
  },
  async createInsurancePolicy(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/facilities/insurance-policies', data);
    return response.data;
  },
  async updateInsurancePolicy(policyId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/insurance-policies/${policyId}`, data);
    return response.data;
  },
  async deleteInsurancePolicy(policyId: string): Promise<void> {
    await api.delete(`/facilities/insurance-policies/${policyId}`);
  },

  // Occupants
  async getOccupants(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>('/facilities/occupants', { params });
    return response.data;
  },
  async getOccupant(occupantId: string): Promise<Record<string, unknown>> {
    const response = await api.get<Record<string, unknown>>(`/facilities/occupants/${occupantId}`);
    return response.data;
  },
  async createOccupant(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/facilities/occupants', data);
    return response.data;
  },
  async updateOccupant(occupantId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/occupants/${occupantId}`, data);
    return response.data;
  },
  async deleteOccupant(occupantId: string): Promise<void> {
    await api.delete(`/facilities/occupants/${occupantId}`);
  },

  // Utility Accounts
  async getUtilityAccounts(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>('/facilities/utility-accounts', { params });
    return response.data;
  },
  async getUtilityAccount(accountId: string): Promise<Record<string, unknown>> {
    const response = await api.get<Record<string, unknown>>(`/facilities/utility-accounts/${accountId}`);
    return response.data;
  },
  async createUtilityAccount(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/facilities/utility-accounts', data);
    return response.data;
  },
  async updateUtilityAccount(accountId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/utility-accounts/${accountId}`, data);
    return response.data;
  },
  async deleteUtilityAccount(accountId: string): Promise<void> {
    await api.delete(`/facilities/utility-accounts/${accountId}`);
  },

  // Photos
  async getPhotos(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>('/facilities/photos', { params });
    return response.data;
  },
  async createPhoto(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/facilities/photos', data);
    return response.data;
  },
  async updatePhoto(photoId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/photos/${photoId}`, data);
    return response.data;
  },
  async deletePhoto(photoId: string): Promise<void> {
    await api.delete(`/facilities/photos/${photoId}`);
  },

  // Documents
  async getFacilityDocuments(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>('/facilities/documents', { params });
    return response.data;
  },
  async createFacilityDocument(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/facilities/documents', data);
    return response.data;
  },
  async updateFacilityDocument(documentId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/documents/${documentId}`, data);
    return response.data;
  },
  async deleteFacilityDocument(documentId: string): Promise<void> {
    await api.delete(`/facilities/documents/${documentId}`);
  },

  // Utility Readings
  async getUtilityReadings(accountId: string, params?: { skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>(`/facilities/utility-accounts/${accountId}/readings`, { params });
    return response.data;
  },
  async createUtilityReading(accountId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>(`/facilities/utility-accounts/${accountId}/readings`, data);
    return response.data;
  },
  async updateUtilityReading(readingId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/utility-readings/${readingId}`, data);
    return response.data;
  },
  async deleteUtilityReading(readingId: string): Promise<void> {
    await api.delete(`/facilities/utility-readings/${readingId}`);
  },

  // Access Keys
  async getAccessKeys(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>('/facilities/access-keys', { params });
    return response.data;
  },
  async getAccessKey(keyId: string): Promise<Record<string, unknown>> {
    const response = await api.get<Record<string, unknown>>(`/facilities/access-keys/${keyId}`);
    return response.data;
  },
  async createAccessKey(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/facilities/access-keys', data);
    return response.data;
  },
  async updateAccessKey(keyId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/access-keys/${keyId}`, data);
    return response.data;
  },
  async deleteAccessKey(keyId: string): Promise<void> {
    await api.delete(`/facilities/access-keys/${keyId}`);
  },

  // Compliance Checklists
  async getComplianceChecklists(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>('/facilities/compliance-checklists', { params });
    return response.data;
  },
  async getComplianceChecklist(checklistId: string): Promise<Record<string, unknown>> {
    const response = await api.get<Record<string, unknown>>(`/facilities/compliance-checklists/${checklistId}`);
    return response.data;
  },
  async createComplianceChecklist(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/facilities/compliance-checklists', data);
    return response.data;
  },
  async updateComplianceChecklist(checklistId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/compliance-checklists/${checklistId}`, data);
    return response.data;
  },
  async deleteComplianceChecklist(checklistId: string): Promise<void> {
    await api.delete(`/facilities/compliance-checklists/${checklistId}`);
  },

  // Compliance Items
  async getComplianceItems(checklistId: string): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>(`/facilities/compliance-checklists/${checklistId}/items`);
    return response.data;
  },
  async createComplianceItem(checklistId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>(`/facilities/compliance-checklists/${checklistId}/items`, data);
    return response.data;
  },
  async updateComplianceItem(itemId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/facilities/compliance-items/${itemId}`, data);
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
  async getLocations(params?: { is_active?: boolean; skip?: number; limit?: number }): Promise<Location[]> {
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
  created_at: string;
  updated_at: string;
}

export interface OperationalRankCreate {
  rank_code: string;
  display_name: string;
  description?: string;
  sort_order?: number;
  is_active?: boolean;
}

export interface OperationalRankUpdate {
  rank_code?: string;
  display_name?: string;
  description?: string | null;
  sort_order?: number;
  is_active?: boolean;
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
