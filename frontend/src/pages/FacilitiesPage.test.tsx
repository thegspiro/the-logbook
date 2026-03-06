import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';

// Mock the facilities service
const mockGetFacilities = vi.fn();
const mockGetTypes = vi.fn();
const mockGetStatuses = vi.fn();
const mockCreateFacility = vi.fn();
const mockArchiveFacility = vi.fn();
const mockRestoreFacility = vi.fn();
const mockGetFacility = vi.fn();

vi.mock('../services/api', () => ({
  facilitiesService: {
    getFacilities: (...args: unknown[]) => mockGetFacilities(...args) as unknown,
    getTypes: (...args: unknown[]) => mockGetTypes(...args) as unknown,
    getStatuses: (...args: unknown[]) => mockGetStatuses(...args) as unknown,
    createFacility: (...args: unknown[]) => mockCreateFacility(...args) as unknown,
    archiveFacility: (...args: unknown[]) => mockArchiveFacility(...args) as unknown,
    restoreFacility: (...args: unknown[]) => mockRestoreFacility(...args) as unknown,
    getFacility: (...args: unknown[]) => mockGetFacility(...args) as unknown,
    getRooms: vi.fn().mockResolvedValue([]),
    getSystems: vi.fn().mockResolvedValue([]),
    getEmergencyContacts: vi.fn().mockResolvedValue([]),
    getMaintenanceRecords: vi.fn().mockResolvedValue([]),
    getMaintenanceTypes: vi.fn().mockResolvedValue([]),
    getInspections: vi.fn().mockResolvedValue([]),
  },
}));

import FacilitiesPage from './FacilitiesPage';

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
    statusRecord: { id: 'status-1', name: 'Operational', color: '#22c55e' },
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
    facilityType: { id: 'type-2', name: 'Training Center' },
    statusRecord: { id: 'status-1', name: 'Operational' },
    isArchived: false,
    createdAt: '2025-02-01T00:00:00Z',
    updatedAt: '2025-02-01T00:00:00Z',
  },
];

const mockTypes = [
  { id: 'type-1', name: 'Fire Station', isActive: true },
  { id: 'type-2', name: 'Training Center', isActive: true },
];

const mockStatuses = [
  { id: 'status-1', name: 'Operational', isActive: true, color: '#22c55e' },
  { id: 'status-2', name: 'Under Renovation', isActive: true, color: '#f59e0b' },
];

function renderPage() {
  return render(
    <BrowserRouter>
      <FacilitiesPage />
    </BrowserRouter>
  );
}

describe('FacilitiesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFacilities.mockResolvedValue(mockFacilities);
    mockGetTypes.mockResolvedValue(mockTypes);
    mockGetStatuses.mockResolvedValue(mockStatuses);
    mockGetFacility.mockResolvedValue(mockFacilities[0]);
  });

  it('renders the page header', async () => {
    renderPage();
    expect(screen.getByText('Facilities')).toBeInTheDocument();
    expect(screen.getByText('Manage stations, buildings, rooms, and maintenance')).toBeInTheDocument();
  });

  it('shows loading state then facilities', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Station 1')).toBeInTheDocument();
      expect(screen.getByText('Training Center')).toBeInTheDocument();
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

  it('filters facilities by search query', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Station 1')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search facilities...');
    await user.type(searchInput, 'Training');

    expect(screen.queryByText('Station 1')).not.toBeInTheDocument();
    expect(screen.getByText('Training Center')).toBeInTheDocument();
  });

  it('shows tabs for facilities, maintenance, and inspections', async () => {
    renderPage();
    expect(screen.getByText('Facilities')).toBeInTheDocument();
    expect(screen.getByText('Maintenance')).toBeInTheDocument();
    expect(screen.getByText('Inspections')).toBeInTheDocument();
  });

  it('opens create facility modal', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Station 1')).toBeInTheDocument();
    });

    const addButton = screen.getByText('Add Facility');
    await user.click(addButton);

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

    await user.click(screen.getByText('Add Facility'));

    const nameInput = screen.getByPlaceholderText('e.g., Station 1');
    await user.type(nameInput, 'Station 3');

    // Find and click the "Add Facility" button in the modal (not the header button)
    const submitButtons = screen.getAllByText('Add Facility');
    const modalSubmit = submitButtons[submitButtons.length - 1]!;
    await user.click(modalSubmit);

    await waitFor(() => {
      expect(mockCreateFacility).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Station 3' })
      );
    });
  });

  it('shows empty state when no facilities exist', async () => {
    mockGetFacilities.mockResolvedValue([]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No facilities yet. Add your first facility to get started.')).toBeInTheDocument();
    });
  });

  it('calls getFacilities with is_archived filter', async () => {
    renderPage();

    await waitFor(() => {
      expect(mockGetFacilities).toHaveBeenCalledWith({ is_archived: false });
    });
  });
});
