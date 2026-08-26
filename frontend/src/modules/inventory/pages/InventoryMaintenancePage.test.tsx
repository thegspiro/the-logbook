import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { InventoryItem, MaintenanceRecord } from '../types';

const mockGetMaintenanceDueItems = vi.fn();
const mockGetItems = vi.fn();
const mockGetItemMaintenanceHistory = vi.fn();
const mockCreateMaintenanceRecord = vi.fn();
const mockUpdateItem = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getMaintenanceDueItems: (...a: unknown[]) => mockGetMaintenanceDueItems(...a) as unknown,
    getItems: (...a: unknown[]) => mockGetItems(...a) as unknown,
    getItemMaintenanceHistory: (...a: unknown[]) => mockGetItemMaintenanceHistory(...a) as unknown,
    createMaintenanceRecord: (...a: unknown[]) => mockCreateMaintenanceRecord(...a) as unknown,
    updateItem: (...a: unknown[]) => mockUpdateItem(...a) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: { user: { full_name: string; email: string } }) => unknown) => {
    const state = { user: { full_name: 'Quartermaster', email: 'qm@x.c' } };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

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

import InventoryMaintenancePage from './InventoryMaintenancePage';

const makeItem = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'it-1',
  organization_id: 'org-1',
  name: 'Helmet',
  condition: 'good',
  status: 'available',
  tracking_type: 'individual',
  quantity: 1,
  quantity_issued: 0,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  next_inspection_due: '2026-07-01T00:00:00Z',
  ...overrides,
});

const makeRecord = (overrides: Partial<MaintenanceRecord> = {}): MaintenanceRecord => ({
  id: 'm-1',
  organization_id: 'org-1',
  item_id: 'it-1',
  maintenance_type: 'inspection',
  passed: true,
  is_completed: true,
  description: 'Annual inspection',
  completed_date: '2026-02-01T00:00:00Z',
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
  ...overrides,
});

// Due items render in both a desktop table and mobile cards.
const firstButton = (name: string | RegExp): HTMLElement => {
  const [btn] = screen.getAllByRole('button', { name });
  if (!btn) throw new Error(`button not found: ${String(name)}`);
  return btn;
};

describe('InventoryMaintenancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMaintenanceDueItems.mockResolvedValue([]);
    mockGetItems.mockResolvedValue({ items: [], total: 0 });
    mockGetItemMaintenanceHistory.mockResolvedValue([]);
    mockCreateMaintenanceRecord.mockResolvedValue({});
    mockUpdateItem.mockResolvedValue({});
  });

  it('shows the empty state when nothing is due', async () => {
    renderWithRouter(<InventoryMaintenancePage />);
    expect(await screen.findByText('No items due for maintenance.')).toBeInTheDocument();
  });

  it('shows an error toast when loading fails', async () => {
    mockGetMaintenanceDueItems.mockRejectedValue(new Error('boom'));
    renderWithRouter(<InventoryMaintenancePage />);
    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
  });

  it('lists items due for maintenance', async () => {
    mockGetMaintenanceDueItems.mockResolvedValue([makeItem()]);
    renderWithRouter(<InventoryMaintenancePage />);
    expect((await screen.findAllByText('Helmet')).length).toBeGreaterThan(0);
  });

  it('schedules work with only a due date and task description', async () => {
    mockGetMaintenanceDueItems.mockResolvedValue([makeItem()]);
    const user = userEvent.setup();
    renderWithRouter(<InventoryMaintenancePage />);
    await screen.findAllByText('Helmet');

    await user.click(firstButton('Log Maintenance'));
    await user.type(await screen.findByPlaceholderText('Describe the maintenance task...'), 'Inspect shell');
    await user.type(screen.getByLabelText('Due Date *'), '2026-09-01');
    await user.click(screen.getByRole('button', { name: 'Save Record' }));

    await waitFor(() => expect(mockCreateMaintenanceRecord).toHaveBeenCalledTimes(1));
    expect(mockCreateMaintenanceRecord.mock.calls[0]?.[0]).toMatchObject({
      item_id: 'it-1',
      description: 'Inspect shell',
      scheduled_date: '2026-09-01',
      is_completed: false,
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Maintenance record saved');
  });

  it('opens an incomplete repair and confirms the out-of-service transition', async () => {
    mockGetMaintenanceDueItems.mockResolvedValue([makeItem()]);
    const user = userEvent.setup();
    renderWithRouter(<InventoryMaintenancePage />);
    await screen.findAllByText('Helmet');
    await user.click(firstButton('Log Maintenance'));
    await user.click(screen.getByRole('button', { name: 'Open repair' }));
    expect(screen.getByText('This will mark the item out of service.')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Describe the maintenance task...'), 'Broken strap');
    await user.click(screen.getByRole('button', { name: 'Save Record' }));
    await waitFor(() =>
      expect(mockCreateMaintenanceRecord).toHaveBeenCalledWith(
        expect.objectContaining({ maintenance_type: 'repair', is_completed: false })
      )
    );
  });

  it('requires and records inspection results without showing completion-only fields', async () => {
    mockGetMaintenanceDueItems.mockResolvedValue([makeItem()]);
    const user = userEvent.setup();
    renderWithRouter(<InventoryMaintenancePage />);
    await screen.findAllByText('Helmet');
    await user.click(firstButton('Log Maintenance'));
    await user.click(screen.getByRole('button', { name: 'Record inspection' }));
    expect(screen.queryByLabelText('Cost ($)')).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Describe the maintenance task...'), 'Safety inspection');
    await user.click(screen.getByRole('button', { name: 'Save Record' }));
    expect(mockToastError).toHaveBeenCalledWith('Select a pass/fail result');
    await user.click(screen.getByLabelText(/fail/i));
    expect(screen.getByText('This will mark the item out of service.')).toBeInTheDocument();
  });

  it('loads maintenance history for a selected item', async () => {
    mockGetMaintenanceDueItems.mockResolvedValue([makeItem()]);
    mockGetItemMaintenanceHistory.mockResolvedValue([makeRecord()]);
    const user = userEvent.setup();
    renderWithRouter(<InventoryMaintenancePage />);
    await screen.findAllByText('Helmet');

    await user.click(firstButton('Helmet'));
    await waitFor(() => expect(mockGetItemMaintenanceHistory).toHaveBeenCalledWith('it-1'));
    expect(await screen.findByText('Annual inspection')).toBeInTheDocument();
  });

  it('prompts to pick an item when opening history with no selection', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryMaintenancePage />);
    await screen.findByText('No items due for maintenance.');

    await user.click(screen.getByRole('button', { name: /Maintenance History/ }));
    expect(await screen.findByText(/Select an item from the Due Items tab/)).toBeInTheDocument();
  });
});
