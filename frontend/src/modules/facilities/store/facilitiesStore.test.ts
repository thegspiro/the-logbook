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
const mockGetFacilitiesPage = vi.fn();
const mockGetDashboard = vi.fn();

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
    getMaintenanceRecords: (...args: unknown[]) => mockGetMaintenanceRecords(...args) as unknown,
    getInspections: (...args: unknown[]) => mockGetInspections(...args) as unknown,
    getFacilitiesPage: (...args: unknown[]) => mockGetFacilitiesPage(...args) as unknown,
    getDashboard: (...args: unknown[]) => mockGetDashboard(...args) as unknown,
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

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('facilitiesStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFacilitiesStore.setState({
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
        })
      );

      const loadPromise = useFacilitiesStore.getState().loadFacilities();

      expect(useFacilitiesStore.getState().isLoading).toBe(true);
      expect(useFacilitiesStore.getState().error).toBeNull();

      resolvePromise([mockFacility]);
      await loadPromise;

      expect(useFacilitiesStore.getState().isLoading).toBe(false);
    });

    it('ignores a stale response that completes after a newer load', async () => {
      const first = deferred<(typeof mockFacility)[]>();
      const second = deferred<(typeof mockFacility)[]>();
      mockGetFacilities.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

      const firstLoad = useFacilitiesStore.getState().loadFacilities();
      const secondLoad = useFacilitiesStore.getState().loadFacilities();
      second.resolve([mockFacility2]);
      await secondLoad;
      first.resolve([mockFacility]);
      await firstLoad;

      expect(useFacilitiesStore.getState().facilities).toEqual([mockFacility2]);
      expect(useFacilitiesStore.getState().isLoading).toBe(false);
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

  describe('loadDashboardStats', () => {
    it('uses unpaginated API counts instead of list lengths', async () => {
      mockGetFacilitiesPage.mockResolvedValue({ items: [mockFacility, mockFacility2], total: 125, skip: 0, limit: 24 });
      mockGetDashboard.mockResolvedValue({
        totalFacilities: 125,
        operationalFacilities: 98,
        overdueMaintenance: 17,
        upcomingInspections: 9,
        overdueMaintenanceRecords: [],
        upcomingInspectionRecords: [],
        recentMaintenanceCompletions: [],
      });

      await useFacilitiesStore.getState().loadDashboardStats();

      expect(useFacilitiesStore.getState().dashboardStats).toMatchObject({
        totalFacilities: 125,
        operationalCount: 98,
        overdueMaintenanceCount: 17,
        upcomingInspectionCount: 9,
      });
    });

    it('uses server-provided previews with facility names', async () => {
      mockGetFacilitiesPage.mockResolvedValue({ items: [], total: 1, skip: 0, limit: 24 });
      mockGetDashboard.mockResolvedValue({
        totalFacilities: 1,
        operationalFacilities: 1,
        overdueMaintenance: 0,
        upcomingInspections: 1,
        overdueMaintenanceRecords: [],
        upcomingInspectionRecords: [
          {
            id: 'insp-upcoming',
            facilityId: 'f1',
            facilityName: 'Station 1',
            title: 'Annual fire inspection',
            nextInspectionDate: '2026-08-21',
          },
        ],
        recentMaintenanceCompletions: [],
      });

      await useFacilitiesStore.getState().loadDashboardStats();

      expect(useFacilitiesStore.getState().dashboardStats?.upcomingInspections).toEqual([
        expect.objectContaining({ id: 'insp-upcoming', facilityName: 'Station 1' }),
      ]);
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
        })
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
      expect(mockGetFacilities).toHaveBeenCalledWith({ is_archived: false });
    });

    it('waits for a failed refresh and exposes its error before resolving', async () => {
      const refresh = deferred<(typeof mockFacility)[]>();
      mockCreateFacility.mockResolvedValue(mockFacility);
      mockGetFacilities.mockReturnValue(refresh.promise);

      const creation = useFacilitiesStore.getState().createFacility({ name: mockFacility.name });
      let resolved = false;
      const resolution = creation.then(() => {
        resolved = true;
      });
      await Promise.resolve();
      expect(resolved).toBe(false);

      refresh.reject(new Error('Refresh failed'));
      await resolution;
      expect(resolved).toBe(true);
      expect(useFacilitiesStore.getState().error).toBe('Refresh failed');
    });

    it('should propagate errors on creation failure', async () => {
      mockCreateFacility.mockRejectedValue(new Error('Validation error'));

      await expect(useFacilitiesStore.getState().createFacility({ name: '' })).rejects.toThrow('Validation error');
    });
  });

  describe('updateFacility', () => {
    it('updates list and selected detail atomically from the mutation response', async () => {
      const updatedFacility = { ...mockFacility, name: 'Updated Station' };
      mockUpdateFacility.mockResolvedValue(updatedFacility);
      useFacilitiesStore.setState({ facilities: [mockFacility, mockFacility2], selectedFacility: mockFacility });

      await useFacilitiesStore.getState().updateFacility('f1', { name: 'Updated Station' });

      expect(mockUpdateFacility).toHaveBeenCalledWith('f1', { name: 'Updated Station' });
      expect(useFacilitiesStore.getState().facilities).toEqual([updatedFacility, mockFacility2]);
      expect(useFacilitiesStore.getState().selectedFacility).toEqual(updatedFacility);
      expect(mockGetFacility).not.toHaveBeenCalled();
      expect(mockGetFacilities).not.toHaveBeenCalled();
    });

    it('keeps the newest rapid update when responses complete out of order', async () => {
      const first = deferred<typeof mockFacility>();
      const second = deferred<typeof mockFacility>();
      mockUpdateFacility.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      useFacilitiesStore.setState({ facilities: [mockFacility], selectedFacility: mockFacility });

      const firstUpdate = useFacilitiesStore.getState().updateFacility('f1', { name: 'First' });
      const secondUpdate = useFacilitiesStore.getState().updateFacility('f1', { name: 'Second' });
      const newest = { ...mockFacility, name: 'Second' };
      second.resolve(newest);
      await secondUpdate;
      first.resolve({ ...mockFacility, name: 'First' });
      await firstUpdate;

      expect(useFacilitiesStore.getState().facilities[0]).toEqual(newest);
      expect(useFacilitiesStore.getState().selectedFacility).toEqual(newest);
    });

    it('should propagate errors on update failure', async () => {
      mockUpdateFacility.mockRejectedValue(new Error('Update failed'));

      await expect(useFacilitiesStore.getState().updateFacility('f1', { name: '' })).rejects.toThrow('Update failed');
    });
  });

  describe('archiveFacility / restoreFacility', () => {
    it('removes an archived facility locally and updates selected detail', async () => {
      const archived = { ...mockFacility, isArchived: true };
      mockArchiveFacility.mockResolvedValue(archived);
      useFacilitiesStore.setState({
        facilities: [mockFacility, mockFacility2],
        facilitiesTotal: 2,
        selectedFacility: mockFacility,
      });

      await useFacilitiesStore.getState().archiveFacility('f1');

      expect(mockArchiveFacility).toHaveBeenCalledWith('f1');
      expect(useFacilitiesStore.getState().facilities).toEqual([mockFacility2]);
      expect(useFacilitiesStore.getState().facilitiesTotal).toBe(1);
      expect(useFacilitiesStore.getState().selectedFacility).toEqual(archived);
      expect(mockGetFacilities).not.toHaveBeenCalled();
    });

    it('inserts a restored facility locally without duplicating it', async () => {
      mockRestoreFacility.mockResolvedValue(mockFacility);
      useFacilitiesStore.setState({
        facilities: [mockFacility2],
        facilitiesTotal: 1,
        selectedFacility: { ...mockFacility, isArchived: true },
      });

      await useFacilitiesStore.getState().restoreFacility('f1');

      expect(mockRestoreFacility).toHaveBeenCalledWith('f1');
      expect(useFacilitiesStore.getState().facilities).toEqual([mockFacility, mockFacility2]);
      expect(useFacilitiesStore.getState().facilitiesTotal).toBe(2);
      expect(useFacilitiesStore.getState().selectedFacility).toEqual(mockFacility);
      expect(mockGetFacilities).not.toHaveBeenCalled();
    });

    it('does not let a stale archive overwrite a newer restore', async () => {
      const archive = deferred<typeof mockFacility>();
      const restore = deferred<typeof mockFacility>();
      mockArchiveFacility.mockReturnValue(archive.promise);
      mockRestoreFacility.mockReturnValue(restore.promise);
      useFacilitiesStore.setState({ facilities: [mockFacility], facilitiesTotal: 1, selectedFacility: mockFacility });

      const archiveMutation = useFacilitiesStore.getState().archiveFacility('f1');
      const restoreMutation = useFacilitiesStore.getState().restoreFacility('f1');
      restore.resolve(mockFacility);
      await restoreMutation;
      archive.resolve({ ...mockFacility, isArchived: true });
      await archiveMutation;

      expect(useFacilitiesStore.getState().facilities).toEqual([mockFacility]);
      expect(useFacilitiesStore.getState().selectedFacility).toEqual(mockFacility);
    });

    it('should propagate errors on archive failure', async () => {
      mockArchiveFacility.mockRejectedValue(new Error('Archive failed'));

      await expect(useFacilitiesStore.getState().archiveFacility('f1')).rejects.toThrow('Archive failed');
    });

    it('should propagate errors on restore failure', async () => {
      mockRestoreFacility.mockRejectedValue(new Error('Restore failed'));

      await expect(useFacilitiesStore.getState().restoreFacility('f1')).rejects.toThrow('Restore failed');
    });
  });

  describe('UI state setters', () => {
    it('clearSelectedFacility should reset selected state', () => {
      useFacilitiesStore.setState({
        selectedFacility: mockFacility,
        selectedFacilityRooms: [
          { id: 'r1', facilityId: 'f1', name: 'Bay 1', condition: 'good', createdAt: '', updatedAt: '' },
        ] as never[],
        selectedFacilitySystems: [
          {
            id: 's1',
            facilityId: 'f1',
            name: 'HVAC',
            systemType: 'hvac',
            condition: 'good',
            createdAt: '',
            updatedAt: '',
          },
        ] as never[],
        selectedFacilityContacts: [
          { id: 'c1', facilityId: 'f1', contactType: 'plumber', createdAt: '', updatedAt: '' },
        ] as never[],
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
