import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';

// Mock the facilities service
const mockGetFacilities = vi.fn();
const mockGetTypes = vi.fn();
const mockGetStatuses = vi.fn();
const mockCreateFacility = vi.fn();
const mockGetFacility = vi.fn();
const mockGetMaintenanceRecords = vi.fn();
const mockGetMaintenanceTypes = vi.fn();
const mockGetInspections = vi.fn();

vi.mock('../services/api', () => ({
  facilitiesService: {
    getFacilities: (...args: unknown[]) => mockGetFacilities(...args) as unknown,
    getTypes: (...args: unknown[]) => mockGetTypes(...args) as unknown,
    getStatuses: (...args: unknown[]) => mockGetStatuses(...args) as unknown,
    createFacility: (...args: unknown[]) => mockCreateFacility(...args) as unknown,
    getFacility: (...args: unknown[]) => mockGetFacility(...args) as unknown,
    getMaintenanceRecords: (...args: unknown[]) => mockGetMaintenanceRecords(...args) as unknown,
    getMaintenanceTypes: (...args: unknown[]) => mockGetMaintenanceTypes(...args) as unknown,
    getInspections: (...args: unknown[]) => mockGetInspections(...args) as unknown,
    archiveFacility: vi.fn().mockResolvedValue({}),
    restoreFacility: vi.fn().mockResolvedValue({}),
    getRooms: vi.fn().mockResolvedValue([]),
    getSystems: vi.fn().mockResolvedValue([]),
    getEmergencyContacts: vi.fn().mockResolvedValue([]),
  },
}));

// Must import after mocks
import FacilitiesDashboard from '../modules/facilities/pages/FacilitiesDashboard';
import { useFacilitiesStore } from '../modules/facilities/store/facilitiesStore';

const mockFacilities = [
  {
    id: '1',
    name: 'Station 1',
    facilityNumber: 'STA-01',
    addressLine1: '123 Main St',
    city: 'Anytown',
    state: 'NY',
    zipCode: '12345',
    facilityTypeId: 'type-1',
    facilityType: { id: 'type-1', name: 'Fire Station' },
    statusId: 'status-1',
    statusRecord: { id: 'status-1', name: 'Operational', color: '#22c55e', isOperational: true },
    isArchived: false,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: '2',
    name: 'Training Center',
    facilityNumber: 'TC-01',
    addressLine1: '456 Oak Ave',
    city: 'Springfield',
    state: 'IL',
    facilityType: { id: 'type-2', name: 'Training Facility' },
    statusRecord: { id: 'status-1', name: 'Operational' },
    isArchived: false,
    createdAt: '2025-02-01T00:00:00Z',
    updatedAt: '2025-02-01T00:00:00Z',
  },
];

const mockTypes = [
  { id: 'type-1', name: 'Fire Station', isActive: true },
  { id: 'type-2', name: 'Training Facility', isActive: true },
];

const mockStatuses = [
  { id: 'status-1', name: 'Operational', isActive: true, color: '#22c55e', isOperational: true },
  { id: 'status-2', name: 'Under Renovation', isActive: true, color: '#f59e0b', isOperational: false },
];

function renderPage() {
  return render(
    <BrowserRouter>
      <FacilitiesDashboard />
    </BrowserRouter>
  );
}

describe('FacilitiesDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the store between tests
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
    mockGetFacilities.mockResolvedValue(mockFacilities);
    mockGetTypes.mockResolvedValue(mockTypes);
    mockGetStatuses.mockResolvedValue(mockStatuses);
    mockGetMaintenanceTypes.mockResolvedValue([]);
    mockGetMaintenanceRecords.mockResolvedValue([]);
    mockGetInspections.mockResolvedValue([]);
    mockGetFacility.mockResolvedValue(mockFacilities[0]);
  });

  it('renders the page header', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Facilities' })).toBeInTheDocument();
    expect(screen.getByText('Manage stations, buildings, maintenance, and inspections')).toBeInTheDocument();
  });

  it('shows loading state then facility cards', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Station 1')).toBeInTheDocument();
      // "Training Center" appears as both facility name and facility type badge
      expect(screen.getAllByText('Training Center').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders facility cards with address and type', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Station 1')).toBeInTheDocument();
    });
    expect(screen.getByText('123 Main St, Anytown, NY')).toBeInTheDocument();
    expect(screen.getByText('Fire Station')).toBeInTheDocument();
  });

  it('shows summary cards', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Total Facilities')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Operational').length).toBeGreaterThanOrEqual(1);
  });

  it('shows sections for maintenance and inspections', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('Overdue Maintenance').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText('Upcoming Inspections').length).toBeGreaterThanOrEqual(1);
  });

  it('opens create facility modal', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Station 1')).toBeInTheDocument();
    });

    // Find the header "Add Facility" button (first one in the DOM)
    const addButtons = screen.getAllByText('Add Facility');
    const firstAddButton = addButtons[0];
    expect(firstAddButton).toBeDefined();
    await user.click(firstAddButton as HTMLElement);

    expect(screen.getByText('Name *')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g., Station 1')).toBeInTheDocument();
  });

  it('creates a facility when form is submitted', async () => {
    const user = userEvent.setup();
    mockCreateFacility.mockResolvedValue({ id: '3', name: 'Station 3' });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Station 1')).toBeInTheDocument();
    });

    // Open modal
    const addButtons = screen.getAllByText('Add Facility');
    const openButton = addButtons[0];
    expect(openButton).toBeDefined();
    await user.click(openButton as HTMLElement);

    const nameInput = screen.getByPlaceholderText('e.g., Station 1');
    await user.type(nameInput, 'Station 3');

    // Find the submit button in the modal (the last "Add Facility" button)
    const submitButtons = screen.getAllByText('Add Facility');
    const modalSubmit = submitButtons[submitButtons.length - 1] ?? submitButtons[0] ?? document.body;
    await user.click(modalSubmit);

    await waitFor(() => {
      expect(mockCreateFacility).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Station 3' }),
      );
    });
  });

  it('shows empty state when no facilities exist', async () => {
    mockGetFacilities.mockResolvedValue([]);
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText('No facilities yet. Add your first facility to get started.'),
      ).toBeInTheDocument();
    });
  });

  it('calls getFacilities for dashboard stats', async () => {
    renderPage();

    await waitFor(() => {
      expect(mockGetFacilities).toHaveBeenCalledWith({ is_archived: false });
    });
  });

  it('shows overdue maintenance section', async () => {
    renderPage();
    await waitFor(() => {
      // "Overdue Maintenance" appears in both summary card and section header
      expect(screen.getAllByText('Overdue Maintenance').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows upcoming inspections section', async () => {
    renderPage();
    await waitFor(() => {
      // "Upcoming Inspections" appears in both summary card and section header
      expect(screen.getAllByText('Upcoming Inspections').length).toBeGreaterThanOrEqual(2);
    });
  });
});
