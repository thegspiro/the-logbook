import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before importing the store) ----

const mockGetApparatusList = vi.fn();
const mockGetApparatus = vi.fn();
const mockGetFleetSummary = vi.fn();

const mockGetTypes = vi.fn();
const mockGetStatuses = vi.fn();
const mockGetMaintenanceDue = vi.fn();

vi.mock('../services/api', () => ({
  apparatusService: {
    getApparatusList: (...args: unknown[]) => mockGetApparatusList(...args) as unknown,
    getApparatus: (...args: unknown[]) => mockGetApparatus(...args) as unknown,
    getFleetSummary: (...args: unknown[]) => mockGetFleetSummary(...args) as unknown,
  },
  apparatusTypeService: {
    getTypes: (...args: unknown[]) => mockGetTypes(...args) as unknown,
  },
  apparatusStatusService: {
    getStatuses: (...args: unknown[]) => mockGetStatuses(...args) as unknown,
  },
  apparatusMaintenanceService: {
    getMaintenanceDue: (...args: unknown[]) => mockGetMaintenanceDue(...args) as unknown,
  },
}));

// ---- Import store AFTER mocks are in place ----
import { useApparatusStore } from './apparatusStore';

// ---- Helpers ----

function getState() {
  return useApparatusStore.getState();
}

const makeApparatusListItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'app1',
  unitNumber: 'E-1',
  name: 'Engine 1',
  year: 2020,
  make: 'Pierce',
  model: 'Enforcer',
  apparatusTypeId: 'type1',
  statusId: 'status1',
  primaryStationId: 'station1',
  currentMileage: 15000,
  currentHours: 500,
  minStaffing: 4,
  isArchived: false,
  ...overrides,
});

const makeApparatus = (overrides: Record<string, unknown> = {}) => ({
  id: 'app1',
  organizationId: 'org1',
  unitNumber: 'E-1',
  name: 'Engine 1',
  vin: '1HGCM82633A123456',
  licensePlate: 'FD-001',
  licenseState: 'NY',
  radioId: 'R-100',
  assetTag: 'A-001',
  apparatusTypeId: 'type1',
  statusId: 'status1',
  statusReason: null,
  statusChangedAt: null,
  statusChangedBy: null,
  year: 2020,
  make: 'Pierce',
  model: 'Enforcer',
  bodyManufacturer: 'Pierce',
  color: 'Red',
  fuelType: 'diesel',
  fuelCapacityGallons: 65,
  seatingCapacity: 6,
  gvwr: 44000,
  minStaffing: 4,
  pumpCapacityGpm: 1500,
  tankCapacityGallons: 750,
  foamCapacityGallons: null,
  ladderLengthFeet: null,
  primaryStationId: 'station1',
  currentLocationId: null,
  currentMileage: 15000,
  currentHours: 500,
  mileageUpdatedAt: null,
  hoursUpdatedAt: null,
  purchaseDate: null,
  purchasePrice: null,
  purchaseVendor: null,
  purchaseOrderNumber: null,
  inServiceDate: null,
  isFinanced: false,
  financingCompany: null,
  financingEndDate: null,
  monthlyPayment: null,
  originalValue: null,
  currentValue: null,
  valueUpdatedAt: null,
  depreciationMethod: null,
  depreciationYears: null,
  salvageValue: null,
  warrantyExpiration: null,
  extendedWarrantyExpiration: null,
  warrantyProvider: null,
  warrantyNotes: null,
  insurancePolicyNumber: null,
  insuranceProvider: null,
  insuranceExpiration: null,
  registrationExpiration: null,
  inspectionExpiration: null,
  isArchived: false,
  archivedAt: null,
  archivedBy: null,
  soldDate: null,
  soldPrice: null,
  soldTo: null,
  soldToContact: null,
  disposalDate: null,
  disposalMethod: null,
  disposalReason: null,
  disposalNotes: null,
  nfpaTrackingEnabled: false,
  customFieldValues: {},
  description: null,
  notes: null,
  createdBy: null,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  ...overrides,
});

const makeApparatusType = (overrides: Record<string, unknown> = {}) => ({
  id: 'type1',
  organizationId: null,
  name: 'Engine',
  code: 'engine',
  description: null,
  category: 'fire',
  isSystem: true,
  defaultType: 'engine',
  icon: null,
  color: null,
  sortOrder: 0,
  isActive: true,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  ...overrides,
});

const makeApparatusStatus = (overrides: Record<string, unknown> = {}) => ({
  id: 'status1',
  organizationId: null,
  name: 'In Service',
  code: 'in_service',
  description: null,
  isSystem: true,
  defaultStatus: 'in_service',
  isAvailable: true,
  isOperational: true,
  requiresReason: false,
  isArchivedStatus: false,
  color: '#00FF00',
  icon: null,
  sortOrder: 0,
  isActive: true,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  ...overrides,
});

const makeFleetSummary = (overrides: Record<string, unknown> = {}) => ({
  totalApparatus: 10,
  inServiceCount: 7,
  outOfServiceCount: 1,
  inMaintenanceCount: 1,
  reserveCount: 1,
  archivedCount: 0,
  byType: { engine: 4, ladder: 2, ambulance: 4 },
  maintenanceDueSoon: 2,
  maintenanceOverdue: 0,
  registrationsExpiringSoon: 1,
  inspectionsExpiringSoon: 0,
  insuranceExpiringSoon: 0,
  ...overrides,
});

const makeMaintenanceDue = (overrides: Record<string, unknown> = {}) => ({
  id: 'maint1',
  apparatusId: 'app1',
  apparatusUnitNumber: 'E-1',
  maintenanceTypeName: 'Oil Change',
  dueDate: '2025-02-15',
  dueMileage: null,
  dueHours: null,
  isOverdue: false,
  ...overrides,
});

const defaultFilters = { isArchived: false };

const defaultInitialState = {
  apparatusList: [],
  currentApparatus: null,
  types: [],
  statuses: [],
  fleetSummary: null,
  maintenanceDue: [],
  totalApparatus: 0,
  currentPage: 1,
  pageSize: 25,
  totalPages: 0,
  filters: defaultFilters,
  isLoading: false,
  isLoadingTypes: false,
  isLoadingStatuses: false,
  isLoadingSummary: false,
  error: null,
};

// ---- Tests ----

describe('apparatusStore', () => {
  beforeEach(() => {
    useApparatusStore.setState(defaultInitialState);
    vi.clearAllMocks();
  });

  // ---- Initial State ----

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = getState();
      expect(state.apparatusList).toEqual([]);
      expect(state.currentApparatus).toBeNull();
      expect(state.types).toEqual([]);
      expect(state.statuses).toEqual([]);
      expect(state.fleetSummary).toBeNull();
      expect(state.maintenanceDue).toEqual([]);
      expect(state.totalApparatus).toBe(0);
      expect(state.currentPage).toBe(1);
      expect(state.pageSize).toBe(25);
      expect(state.totalPages).toBe(0);
      expect(state.filters).toEqual({ isArchived: false });
      expect(state.isLoading).toBe(false);
      expect(state.isLoadingTypes).toBe(false);
      expect(state.isLoadingStatuses).toBe(false);
      expect(state.isLoadingSummary).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  // =========================================================================
  // fetchApparatusList
  // =========================================================================

  describe('fetchApparatusList', () => {
    it('should set isLoading and populate apparatus list on success', async () => {
      const items = [
        makeApparatusListItem(),
        makeApparatusListItem({ id: 'app2', unitNumber: 'L-1' }),
      ];
      mockGetApparatusList.mockResolvedValue({
        items,
        total: 2,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });

      const promise = getState().fetchApparatusList();

      expect(getState().isLoading).toBe(true);
      expect(getState().error).toBeNull();

      await promise;

      const state = getState();
      expect(state.isLoading).toBe(false);
      expect(state.apparatusList).toEqual(items);
      expect(state.totalApparatus).toBe(2);
      expect(state.currentPage).toBe(1);
      expect(state.totalPages).toBe(1);
    });

    it('should fetch the specified page', async () => {
      mockGetApparatusList.mockResolvedValue({
        items: [makeApparatusListItem()],
        total: 30,
        page: 2,
        pageSize: 25,
        totalPages: 2,
      });

      await getState().fetchApparatusList(2);

      expect(mockGetApparatusList).toHaveBeenCalledWith({
        filters: defaultFilters,
        page: 2,
        pageSize: 25,
      });
      expect(getState().currentPage).toBe(2);
    });

    it('should use the current page if no page parameter is given', async () => {
      useApparatusStore.setState({ currentPage: 3 });
      mockGetApparatusList.mockResolvedValue({
        items: [],
        total: 0,
        page: 3,
        pageSize: 25,
        totalPages: 0,
      });

      await getState().fetchApparatusList();

      expect(mockGetApparatusList).toHaveBeenCalledWith({
        filters: defaultFilters,
        page: 3,
        pageSize: 25,
      });
    });

    it('should pass current filters to the service', async () => {
      const customFilters = { isArchived: false, apparatusTypeId: 'type1', search: 'engine' };
      useApparatusStore.setState({ filters: customFilters });

      mockGetApparatusList.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        totalPages: 0,
      });

      await getState().fetchApparatusList();

      expect(mockGetApparatusList).toHaveBeenCalledWith({
        filters: customFilters,
        page: 1,
        pageSize: 25,
      });
    });

    it('should handle errors gracefully', async () => {
      mockGetApparatusList.mockRejectedValue(new Error('Network error'));

      await getState().fetchApparatusList();

      const state = getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeTypeOf('string');
      expect(state.apparatusList).toEqual([]);
    });
  });

  // =========================================================================
  // fetchApparatus
  // =========================================================================

  describe('fetchApparatus', () => {
    it('should set isLoading and populate currentApparatus on success', async () => {
      const apparatus = makeApparatus();
      mockGetApparatus.mockResolvedValue(apparatus);

      const promise = getState().fetchApparatus('app1');

      expect(getState().isLoading).toBe(true);
      expect(getState().error).toBeNull();

      await promise;

      const state = getState();
      expect(state.isLoading).toBe(false);
      expect(state.currentApparatus).toEqual(apparatus);
      expect(mockGetApparatus).toHaveBeenCalledWith('app1');
    });

    it('should handle errors gracefully', async () => {
      mockGetApparatus.mockRejectedValue(new Error('Not found'));

      await getState().fetchApparatus('bad-id');

      const state = getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeTypeOf('string');
    });
  });

  // =========================================================================
  // fetchTypes
  // =========================================================================

  describe('fetchTypes', () => {
    it('should set isLoadingTypes and populate types on success', async () => {
      const types = [
        makeApparatusType(),
        makeApparatusType({ id: 'type2', name: 'Ladder', code: 'ladder' }),
      ];
      mockGetTypes.mockResolvedValue(types);

      const promise = getState().fetchTypes();

      expect(getState().isLoadingTypes).toBe(true);

      await promise;

      const state = getState();
      expect(state.isLoadingTypes).toBe(false);
      expect(state.types).toEqual(types);
      expect(state.types).toHaveLength(2);
      expect(mockGetTypes).toHaveBeenCalledWith({ isActive: true });
    });

    it('should handle errors gracefully', async () => {
      mockGetTypes.mockRejectedValue(new Error('Failed'));

      await getState().fetchTypes();

      const state = getState();
      expect(state.isLoadingTypes).toBe(false);
      expect(state.error).toBeTypeOf('string');
    });
  });

  // =========================================================================
  // fetchStatuses
  // =========================================================================

  describe('fetchStatuses', () => {
    it('should set isLoadingStatuses and populate statuses on success', async () => {
      const statuses = [
        makeApparatusStatus(),
        makeApparatusStatus({ id: 'status2', name: 'Out of Service', code: 'out_of_service' }),
      ];
      mockGetStatuses.mockResolvedValue(statuses);

      const promise = getState().fetchStatuses();

      expect(getState().isLoadingStatuses).toBe(true);

      await promise;

      const state = getState();
      expect(state.isLoadingStatuses).toBe(false);
      expect(state.statuses).toEqual(statuses);
      expect(state.statuses).toHaveLength(2);
      expect(mockGetStatuses).toHaveBeenCalledWith({ isActive: true });
    });

    it('should handle errors gracefully', async () => {
      mockGetStatuses.mockRejectedValue(new Error('Failed'));

      await getState().fetchStatuses();

      const state = getState();
      expect(state.isLoadingStatuses).toBe(false);
      expect(state.error).toBeTypeOf('string');
    });
  });

  // =========================================================================
  // fetchFleetSummary
  // =========================================================================

  describe('fetchFleetSummary', () => {
    it('should set isLoadingSummary and populate fleetSummary on success', async () => {
      const summary = makeFleetSummary();
      mockGetFleetSummary.mockResolvedValue(summary);

      const promise = getState().fetchFleetSummary();

      expect(getState().isLoadingSummary).toBe(true);

      await promise;

      const state = getState();
      expect(state.isLoadingSummary).toBe(false);
      expect(state.fleetSummary).toEqual(summary);
    });

    it('should handle errors gracefully', async () => {
      mockGetFleetSummary.mockRejectedValue(new Error('Failed'));

      await getState().fetchFleetSummary();

      const state = getState();
      expect(state.isLoadingSummary).toBe(false);
      expect(state.error).toBeTypeOf('string');
    });
  });

  // =========================================================================
  // fetchMaintenanceDue
  // =========================================================================

  describe('fetchMaintenanceDue', () => {
    it('should populate maintenanceDue on success with default daysAhead', async () => {
      const items = [makeMaintenanceDue(), makeMaintenanceDue({ id: 'maint2', isOverdue: true })];
      mockGetMaintenanceDue.mockResolvedValue(items);

      await getState().fetchMaintenanceDue();

      expect(getState().maintenanceDue).toEqual(items);
      expect(mockGetMaintenanceDue).toHaveBeenCalledWith({ daysAhead: 30 });
    });

    it('should pass custom daysAhead parameter', async () => {
      mockGetMaintenanceDue.mockResolvedValue([]);

      await getState().fetchMaintenanceDue(60);

      expect(mockGetMaintenanceDue).toHaveBeenCalledWith({ daysAhead: 60 });
    });

    it('should handle errors gracefully', async () => {
      mockGetMaintenanceDue.mockRejectedValue(new Error('Failed'));

      await getState().fetchMaintenanceDue();

      expect(getState().error).toBeTypeOf('string');
    });
  });

  // =========================================================================
  // setFilters
  // =========================================================================

  describe('setFilters', () => {
    it('should merge new filters with existing, reset page to 1, and trigger fetch', async () => {
      mockGetApparatusList.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        totalPages: 0,
      });
      useApparatusStore.setState({ currentPage: 5 });

      getState().setFilters({ apparatusTypeId: 'type1' });

      expect(getState().filters).toEqual({ isArchived: false, apparatusTypeId: 'type1' });
      expect(getState().currentPage).toBe(1);
      expect(mockGetApparatusList).toHaveBeenCalledWith({
        filters: { isArchived: false, apparatusTypeId: 'type1' },
        page: 1,
        pageSize: 25,
      });
    });

    it('should preserve existing filters when adding new ones', async () => {
      mockGetApparatusList.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        totalPages: 0,
      });
      useApparatusStore.setState({ filters: { isArchived: false, search: 'engine' } });

      getState().setFilters({ apparatusTypeId: 'type2' });

      expect(getState().filters).toEqual({
        isArchived: false,
        search: 'engine',
        apparatusTypeId: 'type2',
      });
    });
  });

  // =========================================================================
  // clearFilters
  // =========================================================================

  describe('clearFilters', () => {
    it('should reset filters to defaults, reset page to 1, and trigger fetch', async () => {
      mockGetApparatusList.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        totalPages: 0,
      });
      useApparatusStore.setState({
        filters: { isArchived: true, apparatusTypeId: 'type1', search: 'ladder' },
        currentPage: 3,
      });

      getState().clearFilters();

      expect(getState().filters).toEqual({ isArchived: false });
      expect(getState().currentPage).toBe(1);
      expect(mockGetApparatusList).toHaveBeenCalledWith({
        filters: { isArchived: false },
        page: 1,
        pageSize: 25,
      });
    });
  });

  // =========================================================================
  // setCurrentApparatus
  // =========================================================================

  describe('setCurrentApparatus', () => {
    it('should set the current apparatus', () => {
      const apparatus = makeApparatus();
      getState().setCurrentApparatus(apparatus as ReturnType<typeof getState>['currentApparatus']);

      expect(getState().currentApparatus).toEqual(apparatus);
    });

    it('should clear the current apparatus when set to null', () => {
      useApparatusStore.setState({
        currentApparatus: makeApparatus() as ReturnType<typeof getState>['currentApparatus'],
      });

      getState().setCurrentApparatus(null);

      expect(getState().currentApparatus).toBeNull();
    });
  });

  // =========================================================================
  // clearError
  // =========================================================================

  describe('clearError', () => {
    it('should clear the error state', () => {
      useApparatusStore.setState({ error: 'Something went wrong' });

      getState().clearError();

      expect(getState().error).toBeNull();
    });
  });
});
