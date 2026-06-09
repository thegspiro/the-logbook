import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { InventoryItem, InventoryCategory } from '../types';
import type { MemberInventorySummary } from '../../../services/eventServices';

const mockGetItems = vi.fn();
const mockGetCategories = vi.fn();
const mockGetLowStockItems = vi.fn();
const mockGetMembersSummary = vi.fn();
const mockGetItemIssuances = vi.fn();
const mockCheckAllowance = vi.fn();
const mockIssueFromPool = vi.fn();
const mockReturnToPool = vi.fn();
const mockBulkIssueFromPool = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getItems: (...a: unknown[]) => mockGetItems(...a) as unknown,
    getCategories: (...a: unknown[]) => mockGetCategories(...a) as unknown,
    getLowStockItems: (...a: unknown[]) => mockGetLowStockItems(...a) as unknown,
    getMembersSummary: (...a: unknown[]) => mockGetMembersSummary(...a) as unknown,
    getItemIssuances: (...a: unknown[]) => mockGetItemIssuances(...a) as unknown,
    checkAllowance: (...a: unknown[]) => mockCheckAllowance(...a) as unknown,
    issueFromPool: (...a: unknown[]) => mockIssueFromPool(...a) as unknown,
    returnToPool: (...a: unknown[]) => mockReturnToPool(...a) as unknown,
    bulkIssueFromPool: (...a: unknown[]) => mockBulkIssueFromPool(...a) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]): void => { mockToastSuccess(...a); },
    error: (...a: unknown[]): void => { mockToastError(...a); },
  },
}));

import PoolItemsPage from './PoolItemsPage';

const poolItem = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'p-1',
  organization_id: 'org-1',
  name: 'Dept Polo',
  condition: 'good',
  status: 'available',
  tracking_type: 'pool',
  quantity: 10,
  quantity_issued: 2,
  category_id: 'c-1',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const category: InventoryCategory = {
  id: 'c-1',
  organization_id: 'org-1',
  name: 'Uniforms',
  item_type: 'uniform',
  requires_assignment: false,
  requires_serial_number: false,
  requires_maintenance: false,
  nfpa_tracking_enabled: false,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const member: MemberInventorySummary = {
  user_id: 'u-1',
  username: 'jdoe',
  full_name: 'Jane Doe',
  membership_number: 'M-1',
  permanent_count: 0,
  checkout_count: 0,
  issued_count: 0,
  overdue_count: 0,
  total_items: 0,
};

const lastButton = (name: string | RegExp): HTMLElement => {
  const btns = screen.getAllByRole('button', { name });
  const btn = btns[btns.length - 1];
  if (!btn) throw new Error(`button not found: ${String(name)}`);
  return btn;
};

function req<T>(value: T | undefined, message: string): T {
  if (!value) throw new Error(message);
  return value;
}

describe('PoolItemsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetItems.mockResolvedValue({ items: [], total: 0 });
    mockGetCategories.mockResolvedValue([category]);
    mockGetLowStockItems.mockResolvedValue([]);
    mockGetMembersSummary.mockResolvedValue({ members: [member], total: 1 });
    mockGetItemIssuances.mockResolvedValue([]);
    mockCheckAllowance.mockResolvedValue({
      category_id: 'c-1',
      max_quantity: 5,
      issued_this_period: 1,
      remaining: 4,
      period_type: 'annual',
    });
    mockIssueFromPool.mockResolvedValue({});
    mockReturnToPool.mockResolvedValue({ message: 'ok' });
    mockBulkIssueFromPool.mockResolvedValue({ successful: 1, total: 1, failed: 0, results: [] });
  });

  it('shows the empty state when there are no pool items', async () => {
    renderWithRouter(<PoolItemsPage />);
    expect(await screen.findByText('No pool items found')).toBeInTheDocument();
  });

  it('shows an error toast when loading fails', async () => {
    mockGetItems.mockRejectedValue(new Error('boom'));
    renderWithRouter(<PoolItemsPage />);
    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
  });

  it('renders pool item cards (filtering out non-pool items)', async () => {
    mockGetItems.mockResolvedValue({
      items: [poolItem(), poolItem({ id: 'ind-1', name: 'Individual Axe', tracking_type: 'individual' })],
      total: 2,
    });
    renderWithRouter(<PoolItemsPage />);
    expect(await screen.findByText('Dept Polo')).toBeInTheDocument();
    expect(screen.queryByText('Individual Axe')).not.toBeInTheDocument();
  });

  it('issues units to a selected member', async () => {
    mockGetItems.mockResolvedValue({ items: [poolItem()], total: 1 });
    const user = userEvent.setup();
    renderWithRouter(<PoolItemsPage />);
    await screen.findByText('Dept Polo');

    await user.click(screen.getByRole('button', { name: 'Issue' }));
    await user.type(await screen.findByPlaceholderText('Search members...'), 'Jane');
    await user.click(await screen.findByRole('button', { name: /Jane Doe/ }));
    await waitFor(() => expect(mockCheckAllowance).toHaveBeenCalledWith('u-1', 'c-1'));

    await user.click(lastButton('Issue'));
    await waitFor(() => expect(mockIssueFromPool).toHaveBeenCalledTimes(1));
    expect(mockIssueFromPool.mock.calls[0]?.slice(0, 3)).toEqual(['p-1', 'u-1', 1]);
    expect(mockToastSuccess).toHaveBeenCalledWith('Issued 1 Dept Polo');
  });

  it('loads issuances when a card is expanded', async () => {
    mockGetItems.mockResolvedValue({ items: [poolItem()], total: 1 });
    const user = userEvent.setup();
    renderWithRouter(<PoolItemsPage />);
    await screen.findByText('Dept Polo');

    await user.click(screen.getByRole('button', { name: /Issuances/ }));
    await waitFor(() => expect(mockGetItemIssuances).toHaveBeenCalledWith('p-1', true));
    expect(await screen.findByText('No active issuances')).toBeInTheDocument();
  });

  it('bulk-issues to selected members', async () => {
    mockGetItems.mockResolvedValue({ items: [poolItem()], total: 1 });
    const user = userEvent.setup();
    renderWithRouter(<PoolItemsPage />);
    await screen.findByText('Dept Polo');

    await user.click(screen.getByRole('button', { name: /Bulk Issue/ }));
    const dialog = await screen.findByRole('dialog');
    const selects = within(dialog).getAllByRole('combobox');
    await user.selectOptions(req(selects[0], 'item select missing'), 'p-1');
    await user.selectOptions(req(selects[1], 'member select missing'), 'u-1');
    await user.click(within(dialog).getByRole('button', { name: /Issue to All/ }));

    await waitFor(() => expect(mockBulkIssueFromPool).toHaveBeenCalledTimes(1));
    expect(mockBulkIssueFromPool.mock.calls[0]?.[0]).toBe('p-1');
    expect(mockBulkIssueFromPool.mock.calls[0]?.[1]).toEqual([{ user_id: 'u-1', quantity: 1 }]);
  });
});
