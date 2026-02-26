/**
 * Apparatus API Service
 *
 * Handles all API calls for the Apparatus module.
 */

import axios, { AxiosError } from 'axios';
import { API_TIMEOUT_MS } from '../../../constants/config';

declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    _retry?: boolean;
  }
}
import type {
  Apparatus,
  ApparatusCreate,
  ApparatusUpdate,
  ApparatusStatusChange,
  ApparatusArchive,
  PaginatedApparatusList,
  ApparatusListFilters,
  ApparatusFleetSummary,
  ApparatusType,
  ApparatusTypeCreate,
  ApparatusTypeUpdate,
  ApparatusStatus,
  ApparatusStatusCreate,
  ApparatusStatusUpdate,
  ApparatusCustomField,
  ApparatusMaintenanceType,
  ApparatusMaintenanceTypeCreate,
  ApparatusMaintenanceTypeUpdate,
  ApparatusMaintenance,
  ApparatusMaintenanceCreate,
  ApparatusMaintenanceUpdate,
  ApparatusMaintenanceDue,
  ApparatusFuelLog,
  ApparatusFuelLogCreate,
  ApparatusOperator,
  ApparatusOperatorCreate,
  ApparatusOperatorUpdate,
  ApparatusEquipment,
  ApparatusEquipmentCreate,
  ApparatusEquipmentUpdate,
  ApparatusPhoto,
  ApparatusDocument,
} from '../types';

const API_BASE_URL = '/api/v1';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Helper to read a cookie value by name
function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]!) : null;
}

// Request interceptor to add auth token and CSRF header
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Double-submit CSRF token for state-changing requests
    const method = (config.method || '').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const csrf = getCookie('csrf_token');
      if (csrf) {
        config.headers['X-CSRF-Token'] = csrf;
      }
    }

    return config;
  },
  (error: unknown) => {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
);

// Shared refresh promise to prevent concurrent refresh attempts
let refreshPromise: Promise<string> | null = null;

// Response interceptor to handle token expiration
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('refresh_token');
        if (!refreshToken) return Promise.reject(error instanceof Error ? error : new Error(String(error)));

        if (!refreshPromise) {
          refreshPromise = axios
            .post(`${API_BASE_URL}/auth/refresh`, { refresh_token: refreshToken }, { withCredentials: true })
            .then((response) => {
              const { access_token, refresh_token: new_refresh_token } = response.data;
              localStorage.setItem('access_token', access_token);
              if (new_refresh_token) {
                localStorage.setItem('refresh_token', new_refresh_token);
              }
              return access_token;
            })
            .finally(() => { refreshPromise = null; });
        }

        const newAccessToken = await refreshPromise;
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      } catch {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
      }
    }

    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
);

// =============================================================================
// Apparatus Types
// =============================================================================

export const apparatusTypeService = {
  async getTypes(params?: { isActive?: boolean; includeSystem?: boolean }): Promise<ApparatusType[]> {
    const response = await api.get<ApparatusType[]>('/apparatus/types', {
      params: {
        is_active: params?.isActive,
        include_system: params?.includeSystem ?? true,
      },
    });
    return response.data;
  },

  async getType(typeId: string): Promise<ApparatusType> {
    const response = await api.get<ApparatusType>(`/apparatus/types/${typeId}`);
    return response.data;
  },

  async createType(typeData: ApparatusTypeCreate): Promise<ApparatusType> {
    const response = await api.post<ApparatusType>('/apparatus/types', typeData);
    return response.data;
  },

  async updateType(typeId: string, typeData: ApparatusTypeUpdate): Promise<ApparatusType> {
    const response = await api.patch<ApparatusType>(`/apparatus/types/${typeId}`, typeData);
    return response.data;
  },

  async deleteType(typeId: string): Promise<void> {
    await api.delete(`/apparatus/types/${typeId}`);
  },
};

// =============================================================================
// Apparatus Statuses
// =============================================================================

export const apparatusStatusService = {
  async getStatuses(params?: { isActive?: boolean; includeSystem?: boolean }): Promise<ApparatusStatus[]> {
    const response = await api.get<ApparatusStatus[]>('/apparatus/statuses', {
      params: {
        is_active: params?.isActive,
        include_system: params?.includeSystem ?? true,
      },
    });
    return response.data;
  },

  async getStatus(statusId: string): Promise<ApparatusStatus> {
    const response = await api.get<ApparatusStatus>(`/apparatus/statuses/${statusId}`);
    return response.data;
  },

  async createStatus(statusData: ApparatusStatusCreate): Promise<ApparatusStatus> {
    const response = await api.post<ApparatusStatus>('/apparatus/statuses', statusData);
    return response.data;
  },

  async updateStatus(statusId: string, statusData: ApparatusStatusUpdate): Promise<ApparatusStatus> {
    const response = await api.patch<ApparatusStatus>(`/apparatus/statuses/${statusId}`, statusData);
    return response.data;
  },

  async deleteStatus(statusId: string): Promise<void> {
    await api.delete(`/apparatus/statuses/${statusId}`);
  },
};

// =============================================================================
// Main Apparatus
// =============================================================================

export const apparatusService = {
  async getApparatusList(params?: {
    filters?: ApparatusListFilters;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedApparatusList> {
    const response = await api.get<PaginatedApparatusList>('/apparatus', {
      params: {
        apparatus_type_id: params?.filters?.apparatusTypeId,
        status_id: params?.filters?.statusId,
        primary_station_id: params?.filters?.primaryStationId,
        is_archived: params?.filters?.isArchived ?? false,
        year_min: params?.filters?.yearMin,
        year_max: params?.filters?.yearMax,
        make: params?.filters?.make,
        search: params?.filters?.search,
        page: params?.page ?? 1,
        page_size: params?.pageSize ?? 25,
      },
    });
    return response.data;
  },

  async getArchivedApparatus(params?: { page?: number; pageSize?: number }): Promise<PaginatedApparatusList> {
    const response = await api.get<PaginatedApparatusList>('/apparatus/archived', {
      params: {
        page: params?.page ?? 1,
        page_size: params?.pageSize ?? 25,
      },
    });
    return response.data;
  },

  async getApparatus(apparatusId: string): Promise<Apparatus> {
    const response = await api.get<Apparatus>(`/apparatus/${apparatusId}`);
    return response.data;
  },

  async createApparatus(apparatusData: ApparatusCreate): Promise<Apparatus> {
    const response = await api.post<Apparatus>('/apparatus', apparatusData);
    return response.data;
  },

  async updateApparatus(apparatusId: string, apparatusData: ApparatusUpdate): Promise<Apparatus> {
    const response = await api.patch<Apparatus>(`/apparatus/${apparatusId}`, apparatusData);
    return response.data;
  },

  async changeStatus(apparatusId: string, statusChange: ApparatusStatusChange): Promise<Apparatus> {
    const response = await api.post<Apparatus>(`/apparatus/${apparatusId}/status`, statusChange);
    return response.data;
  },

  async archiveApparatus(apparatusId: string, archiveData: ApparatusArchive): Promise<Apparatus> {
    const response = await api.post<Apparatus>(`/apparatus/${apparatusId}/archive`, archiveData);
    return response.data;
  },

  async deleteApparatus(apparatusId: string): Promise<void> {
    await api.delete(`/apparatus/${apparatusId}`);
  },

  async getFleetSummary(): Promise<ApparatusFleetSummary> {
    const response = await api.get<ApparatusFleetSummary>('/apparatus/summary');
    return response.data;
  },
};

// =============================================================================
// Custom Fields
// =============================================================================

export const apparatusCustomFieldService = {
  async getCustomFields(params?: { isActive?: boolean; apparatusTypeId?: string }): Promise<ApparatusCustomField[]> {
    const response = await api.get<ApparatusCustomField[]>('/apparatus/custom-fields', {
      params: {
        is_active: params?.isActive ?? true,
        apparatus_type_id: params?.apparatusTypeId,
      },
    });
    return response.data;
  },

  async createCustomField(fieldData: Partial<ApparatusCustomField>): Promise<ApparatusCustomField> {
    const response = await api.post<ApparatusCustomField>('/apparatus/custom-fields', fieldData);
    return response.data;
  },

  async updateCustomField(fieldId: string, fieldData: Partial<ApparatusCustomField>): Promise<ApparatusCustomField> {
    const response = await api.patch<ApparatusCustomField>(`/apparatus/custom-fields/${fieldId}`, fieldData);
    return response.data;
  },

  async deleteCustomField(fieldId: string): Promise<void> {
    await api.delete(`/apparatus/custom-fields/${fieldId}`);
  },
};

// =============================================================================
// Maintenance Types
// =============================================================================

export const apparatusMaintenanceTypeService = {
  async getMaintenanceTypes(params?: { isActive?: boolean; includeSystem?: boolean }): Promise<ApparatusMaintenanceType[]> {
    const response = await api.get<ApparatusMaintenanceType[]>('/apparatus/maintenance-types', {
      params: {
        is_active: params?.isActive ?? true,
        include_system: params?.includeSystem ?? true,
      },
    });
    return response.data;
  },

  async createMaintenanceType(typeData: ApparatusMaintenanceTypeCreate): Promise<ApparatusMaintenanceType> {
    const response = await api.post<ApparatusMaintenanceType>('/apparatus/maintenance-types', typeData);
    return response.data;
  },

  async updateMaintenanceType(typeId: string, typeData: ApparatusMaintenanceTypeUpdate): Promise<ApparatusMaintenanceType> {
    const response = await api.patch<ApparatusMaintenanceType>(`/apparatus/maintenance-types/${typeId}`, typeData);
    return response.data;
  },

  async deleteMaintenanceType(typeId: string): Promise<void> {
    await api.delete(`/apparatus/maintenance-types/${typeId}`);
  },
};

// =============================================================================
// Maintenance Records
// =============================================================================

export const apparatusMaintenanceService = {
  async getMaintenanceRecords(params?: {
    apparatusId?: string;
    maintenanceTypeId?: string;
    isCompleted?: boolean;
    isOverdue?: boolean;
    skip?: number;
    limit?: number;
  }): Promise<ApparatusMaintenance[]> {
    const response = await api.get<ApparatusMaintenance[]>('/apparatus/maintenance', {
      params: {
        apparatus_id: params?.apparatusId,
        maintenance_type_id: params?.maintenanceTypeId,
        is_completed: params?.isCompleted,
        is_overdue: params?.isOverdue,
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 100,
      },
    });
    return response.data;
  },

  async getMaintenanceDue(params?: { daysAhead?: number; includeOverdue?: boolean }): Promise<ApparatusMaintenanceDue[]> {
    const response = await api.get<ApparatusMaintenanceDue[]>('/apparatus/maintenance/due', {
      params: {
        days_ahead: params?.daysAhead ?? 30,
        include_overdue: params?.includeOverdue ?? true,
      },
    });
    return response.data;
  },

  async getMaintenanceRecord(recordId: string): Promise<ApparatusMaintenance> {
    const response = await api.get<ApparatusMaintenance>(`/apparatus/maintenance/${recordId}`);
    return response.data;
  },

  async createMaintenanceRecord(maintenanceData: ApparatusMaintenanceCreate): Promise<ApparatusMaintenance> {
    const response = await api.post<ApparatusMaintenance>('/apparatus/maintenance', maintenanceData);
    return response.data;
  },

  async updateMaintenanceRecord(recordId: string, maintenanceData: ApparatusMaintenanceUpdate): Promise<ApparatusMaintenance> {
    const response = await api.patch<ApparatusMaintenance>(`/apparatus/maintenance/${recordId}`, maintenanceData);
    return response.data;
  },

  async deleteMaintenanceRecord(recordId: string): Promise<void> {
    await api.delete(`/apparatus/maintenance/${recordId}`);
  },
};

// =============================================================================
// Fuel Logs
// =============================================================================

export const apparatusFuelLogService = {
  async getFuelLogs(params?: {
    apparatusId?: string;
    startDate?: string;
    endDate?: string;
    skip?: number;
    limit?: number;
  }): Promise<ApparatusFuelLog[]> {
    const response = await api.get<ApparatusFuelLog[]>('/apparatus/fuel-logs', {
      params: {
        apparatus_id: params?.apparatusId,
        start_date: params?.startDate,
        end_date: params?.endDate,
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 100,
      },
    });
    return response.data;
  },

  async createFuelLog(fuelData: ApparatusFuelLogCreate): Promise<ApparatusFuelLog> {
    const response = await api.post<ApparatusFuelLog>('/apparatus/fuel-logs', fuelData);
    return response.data;
  },
};

// =============================================================================
// Operators
// =============================================================================

export const apparatusOperatorService = {
  async getOperators(params?: {
    apparatusId?: string;
    userId?: string;
    isActive?: boolean;
  }): Promise<ApparatusOperator[]> {
    const response = await api.get<ApparatusOperator[]>('/apparatus/operators', {
      params: {
        apparatus_id: params?.apparatusId,
        user_id: params?.userId,
        is_active: params?.isActive ?? true,
      },
    });
    return response.data;
  },

  async createOperator(operatorData: ApparatusOperatorCreate): Promise<ApparatusOperator> {
    const response = await api.post<ApparatusOperator>('/apparatus/operators', operatorData);
    return response.data;
  },

  async updateOperator(operatorId: string, operatorData: ApparatusOperatorUpdate): Promise<ApparatusOperator> {
    const response = await api.patch<ApparatusOperator>(`/apparatus/operators/${operatorId}`, operatorData);
    return response.data;
  },

  async deleteOperator(operatorId: string): Promise<void> {
    await api.delete(`/apparatus/operators/${operatorId}`);
  },
};

// =============================================================================
// Equipment
// =============================================================================

export const apparatusEquipmentService = {
  async getEquipment(params?: {
    apparatusId?: string;
    isPresent?: boolean;
  }): Promise<ApparatusEquipment[]> {
    const response = await api.get<ApparatusEquipment[]>('/apparatus/equipment', {
      params: {
        apparatus_id: params?.apparatusId,
        is_present: params?.isPresent,
      },
    });
    return response.data;
  },

  async createEquipment(equipmentData: ApparatusEquipmentCreate): Promise<ApparatusEquipment> {
    const response = await api.post<ApparatusEquipment>('/apparatus/equipment', equipmentData);
    return response.data;
  },

  async updateEquipment(equipmentId: string, equipmentData: ApparatusEquipmentUpdate): Promise<ApparatusEquipment> {
    const response = await api.patch<ApparatusEquipment>(`/apparatus/equipment/${equipmentId}`, equipmentData);
    return response.data;
  },

  async deleteEquipment(equipmentId: string): Promise<void> {
    await api.delete(`/apparatus/equipment/${equipmentId}`);
  },
};

// =============================================================================
// Photos
// =============================================================================

export const apparatusPhotoService = {
  async getPhotos(apparatusId: string): Promise<ApparatusPhoto[]> {
    const response = await api.get<ApparatusPhoto[]>(`/apparatus/${apparatusId}/photos`);
    return response.data;
  },

  async createPhoto(apparatusId: string, photoData: Partial<ApparatusPhoto>): Promise<ApparatusPhoto> {
    const response = await api.post<ApparatusPhoto>(`/apparatus/${apparatusId}/photos`, photoData);
    return response.data;
  },

  async deletePhoto(apparatusId: string, photoId: string): Promise<void> {
    await api.delete(`/apparatus/${apparatusId}/photos/${photoId}`);
  },
};

// =============================================================================
// Documents
// =============================================================================

export const apparatusDocumentService = {
  async getDocuments(apparatusId: string): Promise<ApparatusDocument[]> {
    const response = await api.get<ApparatusDocument[]>(`/apparatus/${apparatusId}/documents`);
    return response.data;
  },

  async createDocument(apparatusId: string, documentData: Partial<ApparatusDocument>): Promise<ApparatusDocument> {
    const response = await api.post<ApparatusDocument>(`/apparatus/${apparatusId}/documents`, documentData);
    return response.data;
  },

  async deleteDocument(apparatusId: string, documentId: string): Promise<void> {
    await api.delete(`/apparatus/${apparatusId}/documents/${documentId}`);
  },
};

// Export all services
export default {
  types: apparatusTypeService,
  statuses: apparatusStatusService,
  apparatus: apparatusService,
  customFields: apparatusCustomFieldService,
  maintenanceTypes: apparatusMaintenanceTypeService,
  maintenance: apparatusMaintenanceService,
  fuelLogs: apparatusFuelLogService,
  operators: apparatusOperatorService,
  equipment: apparatusEquipmentService,
  photos: apparatusPhotoService,
  documents: apparatusDocumentService,
};
