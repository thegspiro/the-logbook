import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { CategoryPreset, InventoryCategory, InventorySetupStatus, StorageAreaResponse } from '../types';

const mockGetSetupStatus = vi.fn();
const mockGetCategoryPresets = vi.fn();
const mockApplyCategoryPresets = vi.fn();
const mockGetStorageAreas = vi.fn();
const mockCreateStorageArea = vi.fn();
const mockGetCategories = vi.fn();
const mockGetLocations = vi.fn();
const mockCreateLocation = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getSetupStatus: (...a: unknown[]) => mockGetSetupStatus(...a) as unknown,
    getCategoryPresets: (...a: unknown[]) => mockGetCategoryPresets(...a) as unknown,
    applyCategoryPresets: (...a: unknown[]) => mockApplyCategoryPresets(...a) as unknown,
    getStorageAreas: (...a: unknown[]) => mockGetStorageAreas(...a) as unknown,
    createStorageArea: (...a: unknown[]) => mockCreateStorageArea(...a) as unknown,
    getCategories: (...a: unknown[]) => mockGetCategories(...a) as unknown,
  },
  locationsService: {
    getLocations: (...a: unknown[]) => mockGetLocations(...a) as unknown,
    createLocation: (...a: unknown[]) => mockCreateLocation(...a) as unknown,
  },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: Object.assign(
    (...a: unknown[]): void => {
      mockToastSuccess(...a);
    },
    {
      success: (...a: unknown[]): void => {
        mockToastSuccess(...a);
      },
      error: (...a: unknown[]): void => {
        mockToastError(...a);
      },
    }
  ),
}));

import InventorySetupPage from './InventorySetupPage';

const emptyStatus: InventorySetupStatus = {
  rooms: 0,
  storage_areas: 0,
  categories: 0,
  items: 0,
  is_complete: false,
};

const makeRoom = (id: string, name: string) => ({
  id,
  organization_id: 'org-1',
  name,
  building: 'Station 1',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const makeArea = (overrides: Partial<StorageAreaResponse> = {}): StorageAreaResponse => ({
  id: 'area-1',
  organization_id: 'org-1',
  name: 'Rack A',
  storage_type: 'rack',
  location_id: 'room-1',
  sort_order: 0,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  children: [],
  item_count: 0,
  ...overrides,
});

const makeCategory = (overrides: Partial<InventoryCategory> = {}): InventoryCategory => ({
  id: 'cat-1',
  organization_id: 'org-1',
  name: 'Turnout Gear',
  item_type: 'ppe',
  requires_assignment: true,
  requires_serial_number: true,
  requires_maintenance: true,
  nfpa_tracking_enabled: true,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const presets: CategoryPreset[] = [
  {
    key: 'turnout_gear',
    name: 'Turnout Gear',
    description: 'Coats, pants, and liners issued to a member.',
    item_type: 'ppe',
    requires_assignment: true,
    requires_serial_number: true,
    requires_maintenance: true,
    nfpa_tracking_enabled: true,
    low_stock_threshold: null,
    exists: false,
  },
  {
    key: 'radios',
    name: 'Radios & Pagers',
    description: 'Portables, chargers, and pagers issued by serial.',
    item_type: 'electronics',
    requires_assignment: true,
    requires_serial_number: true,
    requires_maintenance: false,
    nfpa_tracking_enabled: false,
    low_stock_threshold: null,
    exists: true,
  },
];

/** Walk the wizard forward by clicking Continue n times. */
const advance = async (user: ReturnType<typeof userEvent.setup>, times: number) => {
  for (let i = 0; i < times; i++) {
    await user.click(screen.getByRole('button', { name: /Continue/ }));
  }
};

describe('InventorySetupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The current step lives in the query string, and BrowserRouter reads the
    // real jsdom URL — without this every test after the first starts on
    // whatever step its predecessor navigated to.
    window.history.replaceState({}, '', '/');
    mockGetSetupStatus.mockResolvedValue(emptyStatus);
    mockGetCategoryPresets.mockResolvedValue(presets);
    mockApplyCategoryPresets.mockResolvedValue({ created: [], skipped: [] });
    mockGetStorageAreas.mockResolvedValue([]);
    mockCreateStorageArea.mockResolvedValue(makeArea());
    mockGetCategories.mockResolvedValue([]);
    mockGetLocations.mockResolvedValue([]);
    mockCreateLocation.mockResolvedValue(makeRoom('room-1', 'Gear Room'));
  });

  it('opens on the rooms step and loads every prerequisite in one pass', async () => {
    renderWithRouter(<InventorySetupPage />);

    expect(await screen.findByRole('heading', { name: 'Rooms' })).toBeInTheDocument();
    expect(mockGetSetupStatus).toHaveBeenCalledTimes(1);
    expect(mockGetLocations).toHaveBeenCalledWith({ is_active: true });
    expect(mockGetStorageAreas).toHaveBeenCalledWith({ flat: true });
    expect(mockGetCategories).toHaveBeenCalledTimes(1);
    expect(mockGetCategoryPresets).toHaveBeenCalledTimes(1);
  });

  it('creates a room without sending blank optional fields', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventorySetupPage />);
    await screen.findByLabelText(/Room name/);

    await user.type(screen.getByLabelText(/Room name/), 'Gear Room');
    await user.click(screen.getByRole('button', { name: /Add room/ }));

    await waitFor(() => {
      expect(mockCreateLocation).toHaveBeenCalledWith({
        name: 'Gear Room',
        building: undefined,
        room_number: undefined,
      });
    });
  });

  it('blocks the storage step until a room exists', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventorySetupPage />);
    await screen.findByRole('heading', { name: 'Rooms' });

    await advance(user, 1);

    expect(await screen.findByText(/Add a room in step 1 first/)).toBeInTheDocument();
  });

  it('files a new storage area under the selected room', async () => {
    mockGetLocations.mockResolvedValue([makeRoom('room-1', 'Gear Room'), makeRoom('room-2', 'Supply Closet')]);
    const user = userEvent.setup();
    renderWithRouter(<InventorySetupPage />);
    await screen.findByRole('heading', { name: 'Rooms' });

    await advance(user, 1);
    await screen.findByRole('heading', { name: 'Storage areas' });

    await user.selectOptions(screen.getByLabelText('Room'), 'room-2');
    await user.type(screen.getByLabelText(/Storage area name/), 'Rack B');
    await user.click(screen.getByRole('button', { name: /Add storage area/ }));

    await waitFor(() => {
      expect(mockCreateStorageArea).toHaveBeenCalledWith({
        name: 'Rack B',
        storage_type: 'rack',
        location_id: 'room-2',
      });
    });
  });

  it('applies only the selected category presets and leaves existing ones alone', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventorySetupPage />);
    await screen.findByRole('heading', { name: 'Rooms' });

    await advance(user, 2);
    await screen.findByRole('heading', { name: 'Categories' });

    // A preset the org already has is shown as done, with no checkbox to tick.
    expect(screen.getByText('already added')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Add 1 category/ }));

    await waitFor(() => {
      expect(mockApplyCategoryPresets).toHaveBeenCalledWith(['turnout_gear']);
    });
  });

  it('carries the chosen room, storage area, and category into the item form', async () => {
    mockGetLocations.mockResolvedValue([makeRoom('room-1', 'Gear Room')]);
    mockGetStorageAreas.mockResolvedValue([makeArea()]);
    mockGetCategories.mockResolvedValue([makeCategory()]);
    const user = userEvent.setup();
    renderWithRouter(<InventorySetupPage />);
    await screen.findByRole('heading', { name: 'Rooms' });

    await advance(user, 3);
    await screen.findByRole('heading', { name: 'First items' });

    await user.selectOptions(screen.getByLabelText('Storage area'), 'area-1');
    await user.click(screen.getByRole('button', { name: /Add an item/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Category')).toHaveValue('cat-1');
    expect(within(dialog).getByLabelText('Facility / Room')).toHaveValue('room-1');
    expect(within(dialog).getByLabelText('Storage Area')).toHaveValue('area-1');
  });

  it('lets the room be cleared back to none on the item step', async () => {
    // The picker defaults to the first room; an effect that re-applied that
    // default on every change would put it straight back.
    mockGetLocations.mockResolvedValue([makeRoom('room-1', 'Gear Room')]);
    const user = userEvent.setup();
    renderWithRouter(<InventorySetupPage />);
    await screen.findByRole('heading', { name: 'Rooms' });

    await advance(user, 3);
    await screen.findByRole('heading', { name: 'First items' });

    const roomSelect = screen.getByLabelText('Room');
    expect(roomSelect).toHaveValue('room-1');

    await user.selectOptions(roomSelect, '');
    expect(roomSelect).toHaveValue('');
  });

  it('offers a skip only while the step is unfinished', async () => {
    mockGetLocations.mockResolvedValue([makeRoom('room-1', 'Gear Room')]);
    renderWithRouter(<InventorySetupPage />);
    await screen.findByRole('heading', { name: 'Rooms' });

    expect(screen.queryByRole('button', { name: /Skip this step/ })).not.toBeInTheDocument();
  });

  it('offers a skip when the step has produced nothing', async () => {
    renderWithRouter(<InventorySetupPage />);
    await screen.findByRole('heading', { name: 'Rooms' });

    expect(screen.getByRole('button', { name: /Skip this step/ })).toBeInTheDocument();
  });
});
