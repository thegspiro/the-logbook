import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockCheckPermission = vi.fn();
const mockFetchFleetSummary = vi.fn();
let grantedPermissions = new Set<string>();

const store = {
  apparatusList: [],
  types: [],
  statuses: [],
  fleetSummary: {
    totalApparatus: 6,
    inServiceCount: 4,
    outOfServiceCount: 1,
    inMaintenanceCount: 1,
    reserveCount: 0,
    maintenanceDueSoon: 0,
    maintenanceOverdue: 0,
  },
  totalApparatus: 0,
  currentPage: 1,
  totalPages: 1,
  isLoading: false,
  isLoadingTypes: false,
  isLoadingStatuses: false,
  isLoadingSummary: false,
  error: null,
  fetchApparatusList: vi.fn(),
  fetchTypes: vi.fn(),
  fetchStatuses: vi.fn(),
  fetchFleetSummary: mockFetchFleetSummary,
  setFilters: vi.fn(),
  clearError: vi.fn(),
};

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (state: { checkPermission: (permission: string) => boolean }) => unknown) =>
    selector({ checkPermission: (permission) => mockCheckPermission(permission) as boolean }),
}));

vi.mock('../store/apparatusStore', () => ({
  useApparatusStore: () => store,
}));

import ApparatusListPage from './ApparatusListPage';

describe('ApparatusListPage permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grantedPermissions = new Set();
    mockCheckPermission.mockImplementation((permission: string) => grantedPermissions.has(permission));
    localStorage.setItem('has_session', 'true');
  });

  it('keeps management actions and fleet summary cards out of the member view', async () => {
    renderWithRouter(<ApparatusListPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));

    expect(screen.queryByRole('button', { name: 'Add Apparatus' })).not.toBeInTheDocument();
    expect(screen.queryByText('Total Fleet')).not.toBeInTheDocument();
    expect(screen.queryByText('Show Archived')).not.toBeInTheDocument();
    expect(screen.getByText('No apparatus are currently available')).toBeInTheDocument();
    await waitFor(() => expect(mockFetchFleetSummary).not.toHaveBeenCalled());
  });

  it('shows management controls and loads the fleet summary for apparatus managers', async () => {
    grantedPermissions = new Set(['apparatus.manage']);

    renderWithRouter(<ApparatusListPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));

    expect(screen.getAllByRole('button', { name: 'Add Apparatus' })).toHaveLength(2);
    expect(screen.getByText('Total Fleet')).toBeInTheDocument();
    expect(screen.getByText('Show Archived')).toBeInTheDocument();
    await waitFor(() => expect(mockFetchFleetSummary).toHaveBeenCalledExactlyOnceWith());
  });

  it('shows add controls without management cards to a user with the narrower create permission', async () => {
    grantedPermissions = new Set(['apparatus.create']);

    renderWithRouter(<ApparatusListPage />);

    expect(screen.getAllByRole('button', { name: 'Add Apparatus' })).toHaveLength(2);
    expect(screen.queryByText('Total Fleet')).not.toBeInTheDocument();
    await waitFor(() => expect(mockFetchFleetSummary).not.toHaveBeenCalled());
  });
});
