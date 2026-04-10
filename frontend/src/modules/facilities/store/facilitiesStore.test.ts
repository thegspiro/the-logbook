import { describe, it, expect, vi, beforeEach } from 'vitest';

// Declare all mocks BEFORE vi.mock
const mockGetFacilities = vi.fn();
const mockGetTypes = vi.fn();
const mockGetStatuses = vi.fn();
const mockGetMaintenanceTypes = vi.fn();
const mockGetFacility = vi.fn();
const mockGetRooms = vi.fn();
const mockGetSystems = vi.fn();
const mockGetEmergencyContacts = vi.fn();
const mockCreateFacility = vi.fn();
const mockUpdateFacility = vi.fn();
const mockArchiveFacility = vi.fn();
const mockRestoreFacility = vi.fn();
const mockGetMaintenanceRecords = vi.fn();
const mockGetInspections = vi.fn();

vi.mock('../../../services/api', () => ({
  facilitiesService: {
    getFacilities: (...args: unknown[]) => mockGetFacilities(...args) as unknown,
    getTypes: (...args: unknown[]) => mockGetTypes(...args) as unknown,
    getStatuses: (...args: unknown[]) => mockGetStatuses(...args) as unknown,
    getMaintenanceTypes: (...args: unknown[]) => mockGetMaintenanceTypes(...args) as unknown,
    getFacility: (...args: unknown[]) => mockGetFacility(...args) as unknown,
    getRooms: (...args: unknown[]) => mockGetRooms(...args) as unknown,
    getSystems: (...args: unknown[]) => mockGetSystems(...args) as unknown,
    getEmergencyContacts: (...args: unknown[]) => mockGetEmergencyContacts(...args) as unknown,
    createFacility: (...args: unknown[]) => mockCreateFacility(...args) as unknown,
    updateFacility: (...args: unknown[]) => mockUpdateFacility(...args) as unknown,
    archiveFacility: (...args: unknown[]) => mockArchiveFacility(...args) as unknown,
    restoreFacility: (...args: unknown[]) => mockRestoreFacility(...args) as unknown,
    getMaintenanceRecords: (...args: unknown[]) =>
      mockGetMaintenanceRecords(...args) as unknown,
    getInspections: (...args: unknown[]) => mockGetInspections(...args) as unknown,
  },
}));

// Import store AFTER mocks
import { useFacilitiesStore } from './facilitiesStore';

const mockFacility = {
  id: 'f1',
  name: 'Station 1',
  facilityNumber: 'STN-001',
  isArchived: false,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

const mockFacility2 = {
  id: 'f2',
  name: 'Station 2',
  facilityNumber: 'STN-002',
  isArchived: false,
  createdAt: '2025-02-01T00:00:00Z',
  updatedAt: '2025-02-01T00:00:00Z',
};

describe('facilitiesStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFacilitiesStore.setState({
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
    });
  });

  describe('loadFacilities', () => {
    it('should load facilities successfully', async () => {
      mockGetFacilities.mockResolvedValue([mockFacility, mockFacility2]);

      await useFacilitiesStore.getState().loadFacilities();
      const state = useFacilitiesStore.getState();

      expect(state.facilities).toEqual([mockFacility, mockFacility2]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(mockGetFacilities).toHaveBeenCalledWith({ is_archived: false });
    });

    it('should set error on failure', async () => {
      mockGetFacilities.mockRejectedValue(new Error('Network error'));

      await useFacilitiesStore.getState().loadFacilities();
      const state = useFacilitiesStore.getState();

      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Network error');
      expect(state.facilities).toEqual([]);
    });

    it('should set isLoading during fetch', async () => {
      let resolvePromise: (value: unknown[]) => void = () => {};
      mockGetFacilities.mockReturnValue(
        new Promise<unknown[]>((resolve) => {
          resolvePromise = resolve;
        }),
      );

      const loadPromise = useFacilitiesStore.getState().loadFacilities();

      expect(useFacilitiesStore.getState().isLoading).toBe(true);
      expect(useFacilitiesStore.getState().error).toBeNull();

      resolvePromise([mockFacility]);
      await loadPromise;

      expect(useFacilitiesStore.getState().isLoading).toBe(false);
    });

    it('should pass showArchived flag to the service', async () => {
      useFacilitiesStore.setState({ showArchived: true });
      mockGetFacilities.mockResolvedValue([]);

      await useFacilitiesStore.getState().loadFacilities();

      expect(mockGetFacilities).toHaveBeenCalledWith({ is_archived: true });
    });
  });

  describe('loadLookupData', () => {
    it('should load all lookup data', async () => {
      const types = [{ id: 't1', name: 'Fire Station' }];
      const statuses = [{ id: 's1', name: 'Operational', isOperational: true }];
      const maintTypes = [{ id: 'm1', name: 'HVAC Service' }];

      mockGetTypes.mockResolvedValue(types);
      mockGetStatuses.mockResolvedValue(statuses);
      mockGetMaintenanceTypes.mockResolvedValue(maintTypes);

      await useFacilitiesStore.getState().loadLookupData();
      const state = useFacilitiesStore.getState();

      expect(state.facilityTypes).toEqual(types);
      expect(state.facilityStatuses).toEqual(statuses);
      expect(state.maintenanceTypes).toEqual(maintTypes);
    });

    it('should silently handle lookup data failure', async () => {
      mockGetTypes.mockRejectedValue(new Error('fail'));
      mockGetStatuses.mockRejectedValue(new Error('fail'));
      mockGetMaintenanceTypes.mockRejectedValue(new Error('fail'));

      await useFacilitiesStore.getState().loadLookupData();
      const state = useFacilitiesStore.getState();

      expect(state.facilityTypes).toEqual([]);
      expect(state.facilityStatuses).toEqual([]);
      expect(state.maintenanceTypes).toEqual([]);
      expect(state.error).toBeNull();
    });
  });

  describe('loadFacilityDetail', () => {
    it('should load facility detail successfully', async () => {
      mockGetFacility.mockResolvedValue(mockFacility);

      await useFacilitiesStore.getState().loadFacilityDetail('f1');
      const state = useFacilitiesStore.getState();

      expect(state.selectedFacility).toEqual(mockFacility);
      expect(state.isLoadingDetail).toBe(false);
      expect(mockGetFacility).toHaveBeenCalledWith('f1');
    });

    it('should handle facility not found', async () => {
      mockGetFacility.mockRejectedValue(new Error('Facility not found'));

      await useFacilitiesStore.getState().loadFacilityDetail('nonexistent');
      const state = useFacilitiesStore.getState();

      expect(state.selectedFacility).toBeNull();
      expect(state.isLoadingDetail).toBe(false);
      expect(state.error).toBe('Facility not found');
    });

    it('should set isLoadingDetail during fetch', async () => {
      let resolvePromise: (value: unknown) => void = () => {};
      mockGetFacility.mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve;
        }),
      );

      const loadPromise = useFacilitiesStore.getState().loadFacilityDetail('f1');

      expect(useFacilitiesStore.getState().isLoadingDetail).toBe(true);

      resolvePromise(mockFacility);
      await loadPromise;

      expect(useFacilitiesStore.getState().isLoadingDetail).toBe(false);
    });
  });

  describe('createFacility', () => {
    it('should create facility and refresh list', async () => {
      const newFacility = { ...mockFacility, id: 'f-new', name: 'New Station' };
      mockCreateFacility.mockResolvedValue(newFacility);
      mockGetFacilities.mockResolvedValue([mockFacility, newFacility]);

      const result = await useFacilitiesStore.getState().createFacility({
        name: 'New Station',
      });

      expect(result).toEqual(newFacility);
      expect(mockCreateFacility).toHaveBeenCalledWith({ name: 'New Station' });
      expect(mockGetFacilities).toHaveBeenCalled();
    });

    it('should propagate errors on creation failure', async () => {
      mockCreateFacility.mockRejectedValue(new Error('Validation error'));

      await expect(
        useFacilitiesStore.getState().createFacility({ name: '' }),
      ).rejects.toThrow('Validation error');
    });
  });

  describe('updateFacility', () => {
    it('should update facility and refresh detail', async () => {
      mockUpdateFacility.mockResolvedValue(undefined);
      mockGetFacility.mockResolvedValue({ ...mockFacility, name: 'Updated Station' });
      mockGetFacilities.mockResolvedValue([{ ...mockFacility, name: 'Updated Station' }]);

      await useFacilitiesStore.getState().updateFacility('f1', { name: 'Updated Station' });

      expect(mockUpdateFacility).toHaveBeenCalledWith('f1', { name: 'Updated Station' });
      expect(mockGetFacility).toHaveBeenCalledWith('f1');
      expect(mockGetFacilities).toHaveBeenCalled();
    });

    it('should propagate errors on update failure', async () => {
      mockUpdateFacility.mockRejectedValue(new Error('Update failed'));

      await expect(
        useFacilitiesStore.getState().updateFacility('f1', { name: '' }),
      ).rejects.toThrow('Update failed');
    });
  });

  describe('archiveFacility / restoreFacility', () => {
    it('should archive facility and refresh list', async () => {
      mockArchiveFacility.mockResolvedValue(undefined);
      mockGetFacilities.mockResolvedValue([]);

      await useFacilitiesStore.getState().archiveFacility('f1');

      expect(mockArchiveFacility).toHaveBeenCalledWith('f1');
      expect(mockGetFacilities).toHaveBeenCalled();
    });

    it('should restore facility and refresh list', async () => {
      mockRestoreFacility.mockResolvedValue(undefined);
      mockGetFacilities.mockResolvedValue([mockFacility]);

      await useFacilitiesStore.getState().restoreFacility('f1');

      expect(mockRestoreFacility).toHaveBeenCalledWith('f1');
      expect(mockGetFacilities).toHaveBeenCalled();
    });

    it('should propagate errors on archive failure', async () => {
      mockArchiveFacility.mockRejectedValue(new Error('Archive failed'));

      await expect(
        useFacilitiesStore.getState().archiveFacility('f1'),
      ).rejects.toThrow('Archive failed');
    });

    it('should propagate errors on restore failure', async () => {
      mockRestoreFacility.mockRejectedValue(new Error('Restore failed'));

      await expect(
        useFacilitiesStore.getState().restoreFacility('f1'),
      ).rejects.toThrow('Restore failed');
    });
  });

  describe('UI state setters', () => {
    it('setShowArchived should update state', () => {
      expect(useFacilitiesStore.getState().showArchived).toBe(false);

      useFacilitiesStore.getState().setShowArchived(true);

      expect(useFacilitiesStore.getState().showArchived).toBe(true);

      useFacilitiesStore.getState().setShowArchived(false);

      expect(useFacilitiesStore.getState().showArchived).toBe(false);
    });

    it('setSearchQuery should update state', () => {
      expect(useFacilitiesStore.getState().searchQuery).toBe('');

      useFacilitiesStore.getState().setSearchQuery('fire station');

      expect(useFacilitiesStore.getState().searchQuery).toBe('fire station');

      useFacilitiesStore.getState().setSearchQuery('');

      expect(useFacilitiesStore.getState().searchQuery).toBe('');
    });

    it('clearSelectedFacility should reset selected state', () => {
      useFacilitiesStore.setState({
        selectedFacility: mockFacility as never,
        selectedFacilityRooms: [{ id: 'r1', facilityId: 'f1', name: 'Bay 1', condition: 'good', createdAt: '', updatedAt: '' }] as never[],
        selectedFacilitySystems: [{ id: 's1', facilityId: 'f1', name: 'HVAC', systemType: 'hvac', condition: 'good', createdAt: '', updatedAt: '' }] as never[],
        selectedFacilityContacts: [{ id: 'c1', facilityId: 'f1', contactType: 'plumber', createdAt: '', updatedAt: '' }] as never[],
      });

      useFacilitiesStore.getState().clearSelectedFacility();
      const state = useFacilitiesStore.getState();

      expect(state.selectedFacility).toBeNull();
      expect(state.selectedFacilityRooms).toEqual([]);
      expect(state.selectedFacilitySystems).toEqual([]);
      expect(state.selectedFacilityContacts).toEqual([]);
    });
  });
});
