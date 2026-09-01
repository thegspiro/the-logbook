import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import StorageAreasPage from './StorageAreasPage';
import type { StorageAreaResponse, Location } from '../types';

const setViewportWidth = (width: number) => {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: query === '(min-width: 768px)' ? width >= 768 : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

const hierarchySnapshot = () => {
  const tree = screen.getByTestId('storage-area-tree');
  // Scoped testing-library queries, not raw DOM traversal: the "Back" button
  // is matched by its accessible name, rows/path text by data-testid (row
  // order/nesting is siblings-in-tree, so `within(row)` never picks up a
  // different row's path span).
  const backButton = within(tree).queryByRole('button', { name: /^Back from/ });
  return {
    backLabel: backButton?.getAttribute('aria-label') ?? null,
    rows: within(tree)
      .getAllByTestId('storage-area-row')
      .map((row) => ({
        id: row.dataset.storageAreaRow,
        path: within(row).getByTestId('storage-area-row-path').getAttribute('title'),
        paddingLeft: row.style.paddingLeft,
        hasMobileIndicator: row.classList.contains('border-l-2'),
      })),
  };
};

const mockGetLocations = vi.fn();
const mockGetFacilities = vi.fn();
const mockGetStorageAreas = vi.fn();
const mockCreateStorageArea = vi.fn();
const mockUpdateStorageArea = vi.fn();
const mockDeleteStorageArea = vi.fn();

vi.mock('../../../services/api', () => ({
  locationsService: {
    getLocations: (...a: unknown[]) => mockGetLocations(...a) as unknown,
  },
  facilitiesService: {
    getFacilities: (...a: unknown[]) => mockGetFacilities(...a) as unknown,
  },
  inventoryService: {
    getStorageAreas: (...a: unknown[]) => mockGetStorageAreas(...a) as unknown,
    createStorageArea: (...a: unknown[]) => mockCreateStorageArea(...a) as unknown,
    updateStorageArea: (...a: unknown[]) => mockUpdateStorageArea(...a) as unknown,
    deleteStorageArea: (...a: unknown[]) => mockDeleteStorageArea(...a) as unknown,
    getItems: vi.fn(),
  },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]): void => {
      mockToastSuccess(...a);
    },
    error: (...a: unknown[]): void => {
      mockToastError(...a);
    },
  },
}));

const makeArea = (overrides: Partial<StorageAreaResponse> = {}): StorageAreaResponse => ({
  id: 'a-rack',
  organization_id: 'org-1',
  name: 'Rack A',
  storage_type: 'rack',
  sort_order: 0,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  children: [],
  item_count: 0,
  ...overrides,
});

const makeRoom = (overrides: Partial<Location> = {}): Location => ({
  id: 'room-1',
  organization_id: 'org-1',
  name: 'Apparatus Bay',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('StorageAreasPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLocations.mockResolvedValue([]);
    mockGetFacilities.mockResolvedValue([]);
    mockGetStorageAreas.mockResolvedValue([]);
    mockCreateStorageArea.mockResolvedValue({});
    mockUpdateStorageArea.mockResolvedValue({});
    mockDeleteStorageArea.mockResolvedValue({});
    setViewportWidth(1024);
  });

  it.each([320, 375])('matches the mobile three-level hierarchy snapshot at %ipx', async (width) => {
    setViewportWidth(width);
    mockGetStorageAreas.mockResolvedValue([
      makeArea({ id: 'cab', name: 'Cab', item_count: 4 }),
      makeArea({ id: 'medical', name: 'Medical bag', parent_id: 'cab', item_count: 12 }),
      makeArea({ id: 'airway', name: 'Airway pouch', parent_id: 'medical', item_count: 3 }),
    ]);
    const user = userEvent.setup();
    renderWithRouter(<StorageAreasPage />);
    await screen.findByText('Cab');

    await user.click(screen.getByRole('button', { name: 'Open Cab' }));
    await user.click(screen.getByRole('button', { name: 'Open Medical bag' }));
    expect(screen.getByLabelText('Cab › Medical bag › Airway pouch')).toBeInTheDocument();
    expect(screen.queryByText('Cab', { selector: '[aria-hidden="true"]' })).not.toBeInTheDocument();

    expect(hierarchySnapshot()).toMatchSnapshot();
  });

  it.each([768, 1024])('matches the desktop three-level hierarchy snapshot at %ipx', async (width) => {
    setViewportWidth(width);
    mockGetStorageAreas.mockResolvedValue([
      makeArea({ id: 'cab', name: 'Cab', item_count: 4 }),
      makeArea({ id: 'medical', name: 'Medical bag', parent_id: 'cab', item_count: 12 }),
      makeArea({ id: 'airway', name: 'Airway pouch', parent_id: 'medical', item_count: 3 }),
    ]);
    const user = userEvent.setup();
    renderWithRouter(<StorageAreasPage />);
    await screen.findByText('Cab');

    await user.click(screen.getByRole('button', { name: 'Expand' }));
    await user.click(screen.getAllByRole('button', { name: 'Expand' })[0] as HTMLElement);
    expect(screen.getByLabelText('Cab › Medical bag › Airway pouch')).toBeInTheDocument();

    expect(hierarchySnapshot()).toMatchSnapshot();
  });

  it('shows every storage area when no facility or room is selected', async () => {
    mockGetStorageAreas.mockResolvedValue([
      makeArea({ id: 'a-1', name: 'Rack A', location_id: 'room-1' }),
      makeArea({ id: 'a-2', name: 'Cabinet B', location_id: 'room-2' }),
      makeArea({ id: 'a-3', name: 'Homeless Bin' }),
    ]);
    renderWithRouter(<StorageAreasPage />);

    expect(await screen.findByText('Rack A')).toBeInTheDocument();
    expect(screen.getByText('Cabinet B')).toBeInTheDocument();
    expect(screen.getByText('Homeless Bin')).toBeInTheDocument();
    expect(mockGetStorageAreas).toHaveBeenCalledWith({ flat: true });
  });

  it('says so plainly when the organization has no storage areas at all', async () => {
    renderWithRouter(<StorageAreasPage />);
    expect(await screen.findByText('No storage areas yet.')).toBeInTheDocument();
  });

  it('lists the facilities the rooms belong to, named from the facilities API', async () => {
    mockGetLocations.mockResolvedValue([
      makeRoom({ id: 'room-1', facility_id: 'fac-1', building: 'Station 1' }),
      makeRoom({ id: 'room-2', name: 'Storage Closet', facility_id: 'fac-1', building: 'Station 1' }),
      makeRoom({ id: 'room-3', name: 'Annex Loft', building: 'Annex' }),
    ]);
    mockGetFacilities.mockResolvedValue([{ id: 'fac-1', name: 'Station 1 — Headquarters' }]);
    renderWithRouter(<StorageAreasPage />);

    expect(await screen.findByRole('option', { name: 'Station 1 — Headquarters' })).toBeInTheDocument();
    // A hand-entered location with no facility record still groups by building.
    expect(screen.getByRole('option', { name: 'Annex' })).toBeInTheDocument();
    // One option per facility, not one per room: two rooms in Station 1, one entry.
    const facilitySelect = await screen.findByLabelText(/Facility/);
    expect(within(facilitySelect).getAllByRole('option')).toHaveLength(3);
  });

  it('scopes the tree to the picked facility, then to the picked room', async () => {
    mockGetLocations.mockResolvedValue([
      makeRoom({ id: 'room-1', facility_id: 'fac-1', building: 'Station 1' }),
      makeRoom({ id: 'room-2', name: 'Storage Closet', facility_id: 'fac-1', building: 'Station 1' }),
      makeRoom({ id: 'room-3', name: 'Annex Loft', facility_id: 'fac-2', building: 'Annex' }),
    ]);
    mockGetFacilities.mockResolvedValue([
      { id: 'fac-1', name: 'Station 1' },
      { id: 'fac-2', name: 'Annex' },
    ]);
    mockGetStorageAreas.mockResolvedValue([
      makeArea({ id: 'a-1', name: 'Bay Rack', location_id: 'room-1' }),
      makeArea({ id: 'a-2', name: 'Closet Shelf', location_id: 'room-2' }),
      makeArea({ id: 'a-3', name: 'Loft Bin', location_id: 'room-3' }),
    ]);
    const user = userEvent.setup();
    renderWithRouter(<StorageAreasPage />);
    await screen.findByText('Bay Rack');

    await user.selectOptions(screen.getByLabelText(/Facility/), 'fac-1');
    expect(screen.getByText('Bay Rack')).toBeInTheDocument();
    expect(screen.getByText('Closet Shelf')).toBeInTheDocument();
    expect(screen.queryByText('Loft Bin')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Room/), 'room-2');
    expect(screen.queryByText('Bay Rack')).not.toBeInTheDocument();
    expect(screen.getByText('Closet Shelf')).toBeInTheDocument();
  });

  it('keeps a child area with its parent when the child carries no room of its own', async () => {
    mockGetLocations.mockResolvedValue([makeRoom({ id: 'room-1', facility_id: 'fac-1', building: 'Station 1' })]);
    mockGetStorageAreas.mockResolvedValue([
      makeArea({ id: 'a-1', name: 'Bay Rack', location_id: 'room-1' }),
      makeArea({ id: 'a-2', name: 'Top Shelf', parent_id: 'a-1' }),
    ]);
    const user = userEvent.setup();
    renderWithRouter(<StorageAreasPage />);
    await screen.findByText('Bay Rack');

    await user.selectOptions(screen.getByLabelText(/Room/), 'room-1');
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByText('Top Shelf')).toBeInTheDocument();
  });

  it('still renders the picker when the facilities API is not permitted', async () => {
    mockGetLocations.mockResolvedValue([makeRoom({ id: 'room-1', facility_id: 'fac-1', building: 'Station 1' })]);
    mockGetFacilities.mockRejectedValue(new Error('403'));
    renderWithRouter(<StorageAreasPage />);

    expect(await screen.findByRole('option', { name: 'Station 1' })).toBeInTheDocument();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('shows an error toast when locations fail to load', async () => {
    mockGetLocations.mockRejectedValue(new Error('nope'));
    renderWithRouter(<StorageAreasPage />);
    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
  });

  it('creates a storage area without asking for a barcode', async () => {
    const user = userEvent.setup();
    renderWithRouter(<StorageAreasPage />);
    await screen.findByText('No storage areas yet.');

    // Header button and empty-state button both open the same modal.
    await user.click(screen.getAllByRole('button', { name: /Add Storage Area/ })[0] as HTMLElement);
    await user.type(await screen.findByPlaceholderText('e.g. Rack A-1'), 'New Rack');

    const barcodeField = screen.getByLabelText('Barcode');
    expect(barcodeField).toHaveAttribute('readonly');
    expect(barcodeField).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mockCreateStorageArea).toHaveBeenCalledTimes(1));
    const payload = mockCreateStorageArea.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ name: 'New Rack' });
    expect(payload).not.toHaveProperty('barcode');
    expect(mockToastSuccess).toHaveBeenCalledWith('Storage area created');
  });

  it('shows the assigned barcode read-only when editing', async () => {
    mockGetStorageAreas.mockResolvedValue([makeArea({ barcode: 'SA-000007' })]);
    const user = userEvent.setup();
    renderWithRouter(<StorageAreasPage />);
    await screen.findByText('Rack A');

    await user.click(screen.getByRole('button', { name: 'Edit Rack A' }));
    const barcodeField = await screen.findByLabelText('Barcode');
    expect(barcodeField).toHaveValue('SA-000007');
    expect(barcodeField).toHaveAttribute('readonly');
  });

  it('renders matching areas from a search query', async () => {
    mockGetStorageAreas.mockResolvedValue([makeArea(), makeArea({ id: 'a-bin', name: 'Bin 4' })]);
    const user = userEvent.setup();
    renderWithRouter(<StorageAreasPage />);
    await screen.findByText('Rack A');

    await user.type(screen.getByPlaceholderText(/Search storage areas/), 'Rack');

    expect(await screen.findByText('Rack A')).toBeInTheDocument();
    expect(screen.queryByText('Bin 4')).not.toBeInTheDocument();
    // Search reads the already-loaded set rather than re-querying the API.
    expect(mockGetStorageAreas).toHaveBeenCalledTimes(1);
  });

  it('finds an area by its barcode', async () => {
    mockGetStorageAreas.mockResolvedValue([
      makeArea({ barcode: 'SA-000012' }),
      makeArea({ id: 'a-bin', name: 'Bin 4' }),
    ]);
    const user = userEvent.setup();
    renderWithRouter(<StorageAreasPage />);
    await screen.findByText('Rack A');

    await user.type(screen.getByPlaceholderText(/Search storage areas/), 'SA-000012');

    expect(await screen.findByText('Rack A')).toBeInTheDocument();
    expect(screen.queryByText('Bin 4')).not.toBeInTheDocument();
  });

  it('edits an area surfaced through search', async () => {
    mockGetStorageAreas.mockResolvedValue([makeArea()]);
    const user = userEvent.setup();
    renderWithRouter(<StorageAreasPage />);
    await screen.findByText('Rack A');
    await user.type(screen.getByPlaceholderText(/Search storage areas/), 'Rack');
    await screen.findByText('Rack A');

    await user.click(screen.getByRole('button', { name: 'Edit Rack A' }));
    expect(await screen.findByText('Edit Storage Area')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(mockUpdateStorageArea).toHaveBeenCalledTimes(1));
    expect(mockUpdateStorageArea.mock.calls[0]?.[0]).toBe('a-rack');
  });

  it('deletes an area after confirmation', async () => {
    mockGetStorageAreas.mockResolvedValue([makeArea()]);
    const user = userEvent.setup();
    renderWithRouter(<StorageAreasPage />);
    await screen.findByText('Rack A');

    await user.click(screen.getByRole('button', { name: 'Delete Rack A' }));
    expect(await screen.findByText('Delete Storage Area')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockDeleteStorageArea).toHaveBeenCalledTimes(1));
    expect(mockDeleteStorageArea.mock.calls[0]?.[0]).toBe('a-rack');
    expect(mockToastSuccess).toHaveBeenCalledWith('"Rack A" deleted');
  });
});
