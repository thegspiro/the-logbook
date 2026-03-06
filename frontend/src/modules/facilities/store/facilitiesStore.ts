/**
 * Facilities Module — Zustand Store
 *
 * Centralized state for the facilities module. Manages facilities list,
 * lookup data (types, statuses, maintenance types), loading states, and
 * the currently selected facility.
 */

import { create } from 'zustand';
import { facilitiesService } from '../../../services/api';
import type {
  Facility,
  FacilityType,
  FacilityStatus,
  MaintenanceType,
  MaintenanceRecord,
  Inspection,
  Room,
  FacilitySystem,
} from '../types';
import type { EmergencyContact, FacilityCreate } from '../../../services/facilitiesServices';
import { getErrorMessage } from '../../../utils/errorHandling';

interface DashboardStats {
  totalFacilities: number;
  operationalCount: number;
  overdueMaintenanceCount: number;
  upcomingInspections: Inspection[];
  overdueMaintenanceRecords: MaintenanceRecord[];
  recentActivity: MaintenanceRecord[];
}

interface FacilitiesState {
  // Core data
  facilities: Facility[];
  facilityTypes: FacilityType[];
  facilityStatuses: FacilityStatus[];
  maintenanceTypes: MaintenanceType[];

  // Selected facility detail
  selectedFacility: Facility | null;
  selectedFacilityRooms: Room[];
  selectedFacilitySystems: FacilitySystem[];
  selectedFacilityContacts: EmergencyContact[];

  // Dashboard stats
  dashboardStats: DashboardStats | null;

  // UI state
  isLoading: boolean;
  isLoadingDetail: boolean;
  isLoadingDashboard: boolean;
  error: string | null;
  showArchived: boolean;
  searchQuery: string;

  // Actions — data loading
  loadFacilities: () => Promise<void>;
  loadLookupData: () => Promise<void>;
  loadDashboardStats: () => Promise<void>;
  loadFacilityDetail: (facilityId: string) => Promise<void>;
  loadFacilityRooms: (facilityId: string) => Promise<void>;
  loadFacilitySystems: (facilityId: string) => Promise<void>;
  loadFacilityContacts: (facilityId: string) => Promise<void>;

  // Actions — mutations
  createFacility: (data: FacilityCreate) => Promise<Facility>;
  updateFacility: (facilityId: string, data: Partial<FacilityCreate>) => Promise<void>;
  archiveFacility: (facilityId: string) => Promise<void>;
  restoreFacility: (facilityId: string) => Promise<void>;

  // Actions — UI state
  setShowArchived: (show: boolean) => void;
  setSearchQuery: (query: string) => void;
  clearSelectedFacility: () => void;
}

export const useFacilitiesStore = create<FacilitiesState>((set, get) => ({
  // Initial state
  facilities: [],
  facilityTypes: [],
  facilityStatuses: [],
  maintenanceTypes: [],
  selectedFacility: null,
  selectedFacilityRooms: [],
  selectedFacilitySystems: [],
  selectedFacilityContacts: [],
  dashboardStats: null,
  isLoading: false,
  isLoadingDetail: false,
  isLoadingDashboard: false,
  error: null,
  showArchived: false,
  searchQuery: '',

  // Load all facilities (list view)
  loadFacilities: async () => {
    set({ isLoading: true, error: null });
    try {
      const { showArchived } = get();
      const data = await facilitiesService.getFacilities({ is_archived: showArchived });
      set({ facilities: data, isLoading: false });
    } catch (err: unknown) {
      set({
        isLoading: false,
        error: getErrorMessage(err, 'Failed to load facilities'),
      });
    }
  },

  // Load lookup data (types, statuses, maintenance types)
  loadLookupData: async () => {
    try {
      const [types, statuses, maintTypes] = await Promise.all([
        facilitiesService.getTypes(),
        facilitiesService.getStatuses(),
        facilitiesService.getMaintenanceTypes(),
      ]);
      set({
        facilityTypes: types,
        facilityStatuses: statuses,
        maintenanceTypes: maintTypes,
      });
    } catch {
      // Non-critical — lookup data may already be loaded
    }
  },

  // Load dashboard stats (overdue maintenance, upcoming inspections, etc.)
  loadDashboardStats: async () => {
    set({ isLoadingDashboard: true });
    try {
      const [facilities, maintenance, inspections] = await Promise.all([
        facilitiesService.getFacilities({ is_archived: false }),
        facilitiesService.getMaintenanceRecords({}),
        facilitiesService.getInspections({}),
      ]);

      const operationalCount = facilities.filter(
        (f) => f.statusRecord?.isOperational !== false,
      ).length;

      const now = new Date();
      const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const overdueMaintenanceRecords = maintenance.filter(
        (r) => r.isOverdue && !r.isCompleted,
      );

      const upcomingInspections = inspections.filter((i) => {
        if (!i.nextInspectionDate) return false;
        const nextDate = new Date(i.nextInspectionDate);
        return nextDate <= thirtyDaysFromNow && nextDate >= now;
      });

      // Recent activity: last 5 completed maintenance records
      const recentActivity = [...maintenance]
        .filter((r) => r.isCompleted)
        .sort((a, b) => {
          const dateA = a.completedDate || a.updatedAt;
          const dateB = b.completedDate || b.updatedAt;
          return new Date(dateB).getTime() - new Date(dateA).getTime();
        })
        .slice(0, 5);

      set({
        facilities,
        dashboardStats: {
          totalFacilities: facilities.length,
          operationalCount,
          overdueMaintenanceCount: overdueMaintenanceRecords.length,
          upcomingInspections,
          overdueMaintenanceRecords,
          recentActivity,
        },
        isLoadingDashboard: false,
      });
    } catch (err: unknown) {
      set({
        isLoadingDashboard: false,
        error: getErrorMessage(err, 'Failed to load dashboard'),
      });
    }
  },

  // Load full facility detail by ID
  loadFacilityDetail: async (facilityId: string) => {
    set({ isLoadingDetail: true });
    try {
      const facility = await facilitiesService.getFacility(facilityId);
      set({ selectedFacility: facility, isLoadingDetail: false });
    } catch (err: unknown) {
      set({
        isLoadingDetail: false,
        error: getErrorMessage(err, 'Failed to load facility'),
      });
    }
  },

  // Load rooms for the selected facility
  loadFacilityRooms: async (facilityId: string) => {
    try {
      const rooms = await facilitiesService.getRooms({ facility_id: facilityId });
      set({ selectedFacilityRooms: rooms });
    } catch {
      set({ selectedFacilityRooms: [] });
    }
  },

  // Load building systems for the selected facility
  loadFacilitySystems: async (facilityId: string) => {
    try {
      const systems = await facilitiesService.getSystems({ facility_id: facilityId });
      set({ selectedFacilitySystems: systems });
    } catch {
      set({ selectedFacilitySystems: [] });
    }
  },

  // Load emergency contacts for the selected facility
  loadFacilityContacts: async (facilityId: string) => {
    try {
      const contacts = await facilitiesService.getEmergencyContacts({ facility_id: facilityId });
      set({ selectedFacilityContacts: contacts });
    } catch {
      set({ selectedFacilityContacts: [] });
    }
  },

  // Create a new facility
  createFacility: async (data: FacilityCreate) => {
    const result = await facilitiesService.createFacility(data);
    // Reload the list after creation
    void get().loadFacilities();
    return result;
  },

  // Update an existing facility
  updateFacility: async (facilityId: string, data: Partial<FacilityCreate>) => {
    await facilitiesService.updateFacility(facilityId, data);
    // Reload detail and list
    void get().loadFacilityDetail(facilityId);
    void get().loadFacilities();
  },

  // Archive a facility
  archiveFacility: async (facilityId: string) => {
    await facilitiesService.archiveFacility(facilityId);
    void get().loadFacilities();
  },

  // Restore a facility
  restoreFacility: async (facilityId: string) => {
    await facilitiesService.restoreFacility(facilityId);
    void get().loadFacilities();
  },

  // UI state setters
  setShowArchived: (show: boolean) => set({ showArchived: show }),
  setSearchQuery: (query: string) => set({ searchQuery: query }),
  clearSelectedFacility: () =>
    set({
      selectedFacility: null,
      selectedFacilityRooms: [],
      selectedFacilitySystems: [],
      selectedFacilityContacts: [],
    }),
}));
