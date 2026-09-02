/**
 * Facilities Module — Zustand Store
 *
 * Centralized state for the facilities module. Manages facilities list,
 * lookup data (types, statuses, maintenance types), loading states, and
 * the currently selected facility.
 */

import { create } from 'zustand';
import { facilitiesService } from '../../../services/api';
import type { Facility, FacilityType, FacilityStatus, MaintenanceType, Room, FacilitySystem } from '../types';
import type {
  EmergencyContact,
  FacilityCreate,
  FacilityDashboardInspectionPreview,
  FacilityDashboardMaintenancePreview,
} from '../../../services/facilitiesServices';
import { getErrorMessage } from '../../../utils/errorHandling';

interface DashboardStats {
  totalFacilities: number;
  operationalCount: number;
  overdueMaintenanceCount: number;
  upcomingInspections: FacilityDashboardInspectionPreview[];
  upcomingInspectionCount: number;
  overdueMaintenanceRecords: FacilityDashboardMaintenancePreview[];
  recentActivity: FacilityDashboardMaintenancePreview[];
}

interface FacilitiesState {
  // Core data
  facilities: Facility[];
  facilitiesTotal: number;
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
  clearSelectedFacility: () => void;
}

export const useFacilitiesStore = create<FacilitiesState>((set, get) => {
  let latestListRequest = 0;
  let latestDetailRequest = 0;
  const facilityMutationVersions = new Map<string, number>();

  const beginFacilityMutation = (facilityId: string) => {
    const version = (facilityMutationVersions.get(facilityId) ?? 0) + 1;
    facilityMutationVersions.set(facilityId, version);
    return version;
  };

  const isLatestFacilityMutation = (facilityId: string, version: number) =>
    facilityMutationVersions.get(facilityId) === version;

  return {
    // Initial state
    facilities: [],
    facilitiesTotal: 0,
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

    // Load all facilities (list view)
    loadFacilities: async () => {
      const request = ++latestListRequest;
      set({ isLoading: true, error: null });
      try {
        const data = await facilitiesService.getFacilities({ is_archived: false });
        if (request === latestListRequest) {
          set({ facilities: data, facilitiesTotal: data.length, isLoading: false });
        }
      } catch (err: unknown) {
        if (request === latestListRequest) {
          set({
            isLoading: false,
            error: getErrorMessage(err, 'Failed to load facilities'),
          });
        }
      }
    },

    // Load lookup data (types, statuses, maintenance types)
    loadLookupData: async () => {
      try {
        // Active only. This store feeds the pickers on the facility create and
        // edit forms, and the types/statuses endpoints apply no filter by
        // default — so deactivating a lookup on the settings screen changed
        // nothing anywhere, which is a switch wired to nothing (pitfall #19).
        // The settings screen calls the service directly and still sees both.
        const [types, statuses, maintTypes] = await Promise.all([
          facilitiesService.getTypes({ is_active: true }),
          facilitiesService.getStatuses({ is_active: true }),
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
      const listRequest = ++latestListRequest;
      set({ isLoadingDashboard: true });
      try {
        const [facilityPage, dashboard] = await Promise.all([
          facilitiesService.getFacilitiesPage({ is_archived: false, skip: 0, limit: 24 }),
          facilitiesService.getDashboard(),
        ]);

        set({
          ...(listRequest === latestListRequest
            ? { facilities: facilityPage.items, facilitiesTotal: facilityPage.total }
            : {}),
          dashboardStats: {
            totalFacilities: dashboard.totalFacilities,
            operationalCount: dashboard.operationalFacilities,
            overdueMaintenanceCount: dashboard.overdueMaintenance,
            upcomingInspections: dashboard.upcomingInspectionRecords,
            upcomingInspectionCount: dashboard.upcomingInspections,
            overdueMaintenanceRecords: dashboard.overdueMaintenanceRecords,
            recentActivity: dashboard.recentMaintenanceCompletions,
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
      const request = ++latestDetailRequest;
      // Drop a different facility before the request goes out. The detail
      // page's spinner guard is `isLoadingDetail && !facility`, so leaving
      // the previous one in place renders the wrong facility's name, address
      // and sections for the whole duration of this request — with a working
      // Archive button in its header.
      set((state) => ({
        isLoadingDetail: true,
        ...(state.selectedFacility && state.selectedFacility.id !== facilityId
          ? {
              selectedFacility: null,
              selectedFacilityRooms: [],
              selectedFacilitySystems: [],
              selectedFacilityContacts: [],
            }
          : {}),
      }));
      try {
        const facility = await facilitiesService.getFacility(facilityId);
        if (request === latestDetailRequest) {
          set({ selectedFacility: facility, isLoadingDetail: false });
        }
      } catch (err: unknown) {
        if (request === latestDetailRequest) {
          set({
            isLoadingDetail: false,
            error: getErrorMessage(err, 'Failed to load facility'),
          });
        }
      }
    },

    // Load rooms for the selected facility
    loadFacilityRooms: async (facilityId: string) => {
      try {
        const rooms = await facilitiesService.getRooms({ facility_id: facilityId });
        set({ selectedFacilityRooms: rooms });
      } catch (err: unknown) {
        set({
          selectedFacilityRooms: [],
          error: getErrorMessage(err, 'Failed to load rooms'),
        });
      }
    },

    // Load building systems for the selected facility
    loadFacilitySystems: async (facilityId: string) => {
      try {
        const systems = await facilitiesService.getSystems({ facility_id: facilityId });
        set({ selectedFacilitySystems: systems });
      } catch (err: unknown) {
        set({
          selectedFacilitySystems: [],
          error: getErrorMessage(err, 'Failed to load building systems'),
        });
      }
    },

    // Load emergency contacts for the selected facility
    loadFacilityContacts: async (facilityId: string) => {
      try {
        const contacts = await facilitiesService.getEmergencyContacts({ facility_id: facilityId });
        set({ selectedFacilityContacts: contacts });
      } catch (err: unknown) {
        set({
          selectedFacilityContacts: [],
          error: getErrorMessage(err, 'Failed to load emergency contacts'),
        });
      }
    },

    // Create a new facility
    createFacility: async (data: FacilityCreate) => {
      const result = await facilitiesService.createFacility(data);
      await get().loadFacilities();
      return result;
    },

    // Update an existing facility
    updateFacility: async (facilityId: string, data: Partial<FacilityCreate>) => {
      const version = beginFacilityMutation(facilityId);
      const facility = await facilitiesService.updateFacility(facilityId, data);
      if (!isLatestFacilityMutation(facilityId, version)) return;

      ++latestListRequest;
      ++latestDetailRequest;
      set((state) => ({
        facilities: state.facilities.map((item) => (item.id === facilityId ? facility : item)),
        selectedFacility: state.selectedFacility?.id === facilityId ? facility : state.selectedFacility,
        isLoading: false,
        isLoadingDetail: false,
      }));
    },

    // Archive a facility
    archiveFacility: async (facilityId: string) => {
      const version = beginFacilityMutation(facilityId);
      const facility = await facilitiesService.archiveFacility(facilityId);
      if (!isLatestFacilityMutation(facilityId, version)) return;

      ++latestListRequest;
      ++latestDetailRequest;
      set((state) => {
        const wasListed = state.facilities.some((item) => item.id === facilityId);
        return {
          facilities: state.facilities.filter((item) => item.id !== facilityId),
          facilitiesTotal: wasListed ? Math.max(0, state.facilitiesTotal - 1) : state.facilitiesTotal,
          selectedFacility: state.selectedFacility?.id === facilityId ? facility : state.selectedFacility,
          isLoading: false,
          isLoadingDetail: false,
        };
      });
    },

    // Restore a facility
    restoreFacility: async (facilityId: string) => {
      const version = beginFacilityMutation(facilityId);
      const facility = await facilitiesService.restoreFacility(facilityId);
      if (!isLatestFacilityMutation(facilityId, version)) return;

      ++latestListRequest;
      ++latestDetailRequest;
      set((state) => {
        const wasListed = state.facilities.some((item) => item.id === facilityId);
        return {
          facilities: wasListed
            ? state.facilities.map((item) => (item.id === facilityId ? facility : item))
            : [facility, ...state.facilities],
          facilitiesTotal: wasListed ? state.facilitiesTotal : state.facilitiesTotal + 1,
          selectedFacility: state.selectedFacility?.id === facilityId ? facility : state.selectedFacility,
          isLoading: false,
          isLoadingDetail: false,
        };
      });
    },

    // UI state setters
    clearSelectedFacility: () => {
      // Invalidate any detail load still in flight. The detail page clears on
      // unmount, but a request that resolves afterwards would otherwise write
      // its facility back into a store nobody is looking at — and the next
      // detail page then opens on it.
      ++latestDetailRequest;
      set({
        selectedFacility: null,
        selectedFacilityRooms: [],
        selectedFacilitySystems: [],
        selectedFacilityContacts: [],
        isLoadingDetail: false,
      });
    },
  };
});
