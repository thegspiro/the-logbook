import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockCheckPermission = vi.fn();
const mockFetchFleetSummary = vi.fn();
let grantedPermissions = new Set<string>();

const store = {
  apparatusList: [] as Array<Record<string, unknown>>,
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

// The page header loads the enabled modules through the real service; with a
// dev stack listening, that request is answered 401, which clears
// `has_session` and sends the page to /login mid-test.
vi.mock('../../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({ enabledModules: null, isModuleOn: () => true, isLoading: false }),
}));

vi.mock('../hooks/useApparatusNfpaSettings', () => ({
  useApparatusNfpaSettings: () => ({
    enabled: true,
    settings: { enabled: true, defaultForOrganizationType: true, explicitChoice: null },
    loading: false,
    refresh: () => Promise.resolve(),
  }),
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
    expect(screen.getByText('No apparatus have been added yet.')).toBeInTheDocument();
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

describe('ApparatusListPage row actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grantedPermissions = new Set(['apparatus.manage', 'apparatus.edit']);
    mockCheckPermission.mockImplementation((permission: string) => grantedPermissions.has(permission));
    localStorage.setItem('has_session', 'true');
    store.apparatusList = [
      { id: 'a-1', unitNumber: 'E-2', name: 'Pumper', minStaffing: 3, isArchived: false },
      { id: 'a-2', unitNumber: 'U-9', name: null, minStaffing: 1, isArchived: false },
    ];
  });

  afterEach(() => {
    store.apparatusList = [];
  });

  // Every row's icon buttons were named only by a shared title, "View Details",
  // "Edit" and "Print label", so a list of units read as the same three
  // buttons over and over.
  it('names each row action after its unit', async () => {
    renderWithRouter(<ApparatusListPage />);
    expect(await screen.findByRole('button', { name: 'Print label for E-2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit U-9' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View E-2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Details' })).not.toBeInTheDocument();
  });

  // The wrench was a second "View E-2" that opened the overview, and a row
  // "Archive" button opened the same page without archiving anything.
  it('opens the maintenance tab from the wrench', async () => {
    renderWithRouter(<ApparatusListPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Maintenance for E-2' }));
    // The router commits the location after the click returns; reading it
    // straight away raced that on a loaded machine and saw the previous test's
    // path.
    await waitFor(() => {
      expect(window.location.pathname).toBe('/apparatus/a-1');
    });
    expect(window.location.search).toBe('?tab=maintenance');
  });

  it('offers no row Archive button, since archiving needs the form on the apparatus page', async () => {
    renderWithRouter(<ApparatusListPage />);
    await screen.findByRole('button', { name: 'View E-2' });
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument();
  });
});

describe('ApparatusListPage empty fleet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grantedPermissions = new Set(['apparatus.create']);
    mockCheckPermission.mockImplementation((permission: string) => grantedPermissions.has(permission));
    localStorage.setItem('has_session', 'true');
    store.apparatusList = [];
  });

  it('explains what an apparatus record is for on a fresh install', () => {
    renderWithRouter(<ApparatusListPage />);
    expect(screen.getByRole('heading', { name: 'No apparatus yet' })).toBeInTheDocument();
    expect(screen.getByText(/Add each vehicle your department runs/)).toBeInTheDocument();
  });

  it('reads as a search miss, not a first run, while a search is applied', async () => {
    renderWithRouter(<ApparatusListPage />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Search by unit number, name, or VIN' }), 'zz');
    expect(screen.getByRole('heading', { name: 'No Apparatus Found' })).toBeInTheDocument();
    expect(screen.getByText(/No apparatus match your search or filters/)).toBeInTheDocument();
    expect(screen.queryByText(/Add each vehicle your department runs/)).not.toBeInTheDocument();
  });
});

describe('ApparatusListPage NFPA department switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grantedPermissions = new Set();
    mockCheckPermission.mockImplementation((permission: string) => grantedPermissions.has(permission));
    localStorage.setItem('has_session', 'true');
  });

  it('is not offered to an apparatus manager who cannot change settings', () => {
    grantedPermissions = new Set(['apparatus.manage']);
    renderWithRouter(<ApparatusListPage />);
    expect(screen.queryByRole('switch', { name: 'NFPA Compliance' })).not.toBeInTheDocument();
  });

  it('is offered to a settings administrator', () => {
    grantedPermissions = new Set(['settings.manage']);
    renderWithRouter(<ApparatusListPage />);
    expect(screen.getByRole('switch', { name: 'NFPA Compliance' })).toBeChecked();
  });
});

// The dashboard's fleet-readiness tiles link here with a filter in the query
// string and say "View filtered results"; the list used to ignore it and open
// the whole fleet.
describe('ApparatusListPage dashboard tile filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grantedPermissions = new Set(['apparatus.manage']);
    mockCheckPermission.mockImplementation((permission: string) => grantedPermissions.has(permission));
    localStorage.setItem('has_session', 'true');
    store.apparatusList = [
      { id: 'a-1', unitNumber: 'E-2', name: 'Pumper', minStaffing: 3, isArchived: false, hasDeficiency: true },
    ];
  });

  afterEach(() => {
    store.apparatusList = [];
    window.history.pushState({}, '', '/');
  });

  const lastFilters = () => store.setFilters.mock.lastCall?.[0] as Record<string, unknown> | undefined;

  it.each([
    ['serviceStatus=unavailable', { serviceStatus: 'unavailable' }, 'out of service or in maintenance'],
    ['hasDeficiency=true', { hasDeficiency: true }, 'unresolved equipment deficiency'],
    ['inspection=overdue', { inspection: 'overdue' }, 'inspection has expired'],
  ])('applies ?%s and says so', async (query, expected, banner) => {
    window.history.pushState({}, '', `/apparatus?${query}`);
    renderWithRouter(<ApparatusListPage />);

    await waitFor(() => expect(lastFilters()).toMatchObject({ isArchived: false, ...expected }));
    expect(screen.getByText(new RegExp(banner))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View E-2' })).toBeInTheDocument();
  });

  it('clears the filter from the URL and the request', async () => {
    window.history.pushState({}, '', '/apparatus?hasDeficiency=true');
    renderWithRouter(<ApparatusListPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Clear filter: Unresolved deficiency' }));

    await waitFor(() => expect(lastFilters()).toMatchObject({ hasDeficiency: undefined }));
    expect(window.location.search).toBe('');
    expect(screen.queryByText(/unresolved equipment deficiency/)).not.toBeInTheDocument();
  });

  it('ignores a value no tile sends', async () => {
    window.history.pushState({}, '', '/apparatus?hasDeficiency=yes&serviceStatus=broken');
    renderWithRouter(<ApparatusListPage />);

    await waitFor(() => expect(store.setFilters).toHaveBeenCalled());
    expect(lastFilters()).toEqual({
      isArchived: false,
      apparatusTypeId: undefined,
      statusId: undefined,
      search: undefined,
      serviceStatus: undefined,
      hasDeficiency: undefined,
      inspection: undefined,
    });
    expect(screen.queryByRole('button', { name: /Clear filter:/ })).not.toBeInTheDocument();
  });
});
