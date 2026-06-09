import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import StorageAreasPage from './StorageAreasPage';
import type { StorageAreaResponse } from '../types';

const mockGetLocations = vi.fn();
const mockGetStorageAreas = vi.fn();
const mockCreateStorageArea = vi.fn();
const mockUpdateStorageArea = vi.fn();
const mockDeleteStorageArea = vi.fn();

vi.mock('../../../services/api', () => ({
  locationsService: {
    getLocations: (...a: unknown[]) => mockGetLocations(...a) as unknown,
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
    success: (...a: unknown[]): void => { mockToastSuccess(...a); },
    error: (...a: unknown[]): void => { mockToastError(...a); },
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

describe('StorageAreasPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLocations.mockResolvedValue([]);
    mockGetStorageAreas.mockResolvedValue([]);
    mockCreateStorageArea.mockResolvedValue({});
    mockUpdateStorageArea.mockResolvedValue({});
    mockDeleteStorageArea.mockResolvedValue({});
  });

  it('prompts to pick a facility and room once locations load', async () => {
    renderWithRouter(<StorageAreasPage />);
    expect(
      await screen.findByText(/Select a facility and room above/),
    ).toBeInTheDocument();
    expect(mockGetLocations).toHaveBeenCalledTimes(1);
  });

  it('shows an error toast when locations fail to load', async () => {
    mockGetLocations.mockRejectedValue(new Error('nope'));
    renderWithRouter(<StorageAreasPage />);
    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
  });

  it('creates a storage area from the add modal', async () => {
    const user = userEvent.setup();
    renderWithRouter(<StorageAreasPage />);
    await screen.findByText(/Select a facility and room above/);

    await user.click(screen.getByRole('button', { name: /Add Storage Area/ }));
    await user.type(await screen.findByPlaceholderText('e.g. Rack A-1'), 'New Rack');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mockCreateStorageArea).toHaveBeenCalledTimes(1));
    expect(mockCreateStorageArea.mock.calls[0]?.[0]).toMatchObject({ name: 'New Rack' });
    expect(mockToastSuccess).toHaveBeenCalledWith('Storage area created');
  });

  it('renders matching areas from a search query', async () => {
    mockGetStorageAreas.mockResolvedValue([makeArea()]);
    const user = userEvent.setup();
    renderWithRouter(<StorageAreasPage />);
    await screen.findByText(/Select a facility and room above/);

    await user.type(
      screen.getByPlaceholderText(/Search storage areas by name/),
      'Rack',
    );

    expect(await screen.findByText('Rack A')).toBeInTheDocument();
    expect(mockGetStorageAreas).toHaveBeenCalledWith({ flat: true });
  });

  it('edits an area surfaced through search', async () => {
    mockGetStorageAreas.mockResolvedValue([makeArea()]);
    const user = userEvent.setup();
    renderWithRouter(<StorageAreasPage />);
    await screen.findByText(/Select a facility and room above/);
    await user.type(screen.getByPlaceholderText(/Search storage areas by name/), 'Rack');
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
    await screen.findByText(/Select a facility and room above/);
    await user.type(screen.getByPlaceholderText(/Search storage areas by name/), 'Rack');
    await screen.findByText('Rack A');

    await user.click(screen.getByRole('button', { name: 'Delete Rack A' }));
    expect(await screen.findByText('Delete Storage Area')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockDeleteStorageArea).toHaveBeenCalledTimes(1));
    expect(mockDeleteStorageArea.mock.calls[0]?.[0]).toBe('a-rack');
    expect(mockToastSuccess).toHaveBeenCalledWith('"Rack A" deleted');
  });
});
