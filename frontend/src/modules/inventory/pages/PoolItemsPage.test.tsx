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
    success: (...a: unknown[]): void => {
      mockToastSuccess(...a);
    },
    error: (...a: unknown[]): void => {
      mockToastError(...a);
    },
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

    await user.click(screen.getByRole('button', { name: 'Issue Dept Polo' }));
    await user.type(await screen.findByRole('textbox', { name: 'Member' }), 'Jane');
    await user.click(await screen.findByRole('button', { name: /Jane Doe/ }));
    await waitFor(() => expect(mockCheckAllowance).toHaveBeenCalledWith('u-1', 'c-1'));

    await user.click(lastButton('Issue'));
    await waitFor(() => expect(mockIssueFromPool).toHaveBeenCalledTimes(1));
    expect(mockIssueFromPool.mock.calls[0]?.slice(0, 3)).toEqual(['p-1', 'u-1', 1]);
    expect(mockToastSuccess).toHaveBeenCalledWith('Issued 1 Dept Polo');
  });

  const openIssueFor = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Issue Dept Polo' }));
    await user.type(await screen.findByRole('textbox', { name: 'Member' }), 'Jane');
    await user.click(await screen.findByRole('button', { name: /Jane Doe/ }));
    await waitFor(() => expect(mockCheckAllowance).toHaveBeenCalledWith('u-1', 'c-1'));
  };

  // Typing more than was on hand was quietly lowered to the maximum, so a
  // mistyped 25 against 19 on the shelf issued all 19 to one member.
  it('refuses a quantity above what is on hand instead of lowering it', async () => {
    mockGetItems.mockResolvedValue({ items: [poolItem()], total: 1 });
    const user = userEvent.setup();
    renderWithRouter(<PoolItemsPage />);
    await screen.findByText('Dept Polo');
    await openIssueFor(user);

    const qty = screen.getByRole('spinbutton', { name: 'Quantity (max 10)' });
    await user.clear(qty);
    await user.type(qty, '25');

    expect(qty).toHaveValue(25);
    expect(screen.getByRole('alert')).toHaveTextContent('Only 10 on hand.');
    expect(lastButton('Issue')).toBeDisabled();
    expect(mockIssueFromPool).not.toHaveBeenCalled();
  });

  // The server refuses an over-allowance issue without the override, and the
  // dialog already said so, yet Issue stayed live and sent it to be refused.
  it('waits for the override before issuing over the allowance', async () => {
    mockGetItems.mockResolvedValue({ items: [poolItem()], total: 1 });
    const user = userEvent.setup();
    renderWithRouter(<PoolItemsPage />);
    await screen.findByText('Dept Polo');
    await openIssueFor(user);

    const qty = screen.getByRole('spinbutton', { name: 'Quantity (max 10)' });
    await user.clear(qty);
    await user.type(qty, '5');

    expect(lastButton('Issue')).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Override allowance' }));
    expect(lastButton('Issue')).toBeEnabled();
  });

  it('says plainly when a category has no allowance', async () => {
    mockGetItems.mockResolvedValue({ items: [poolItem()], total: 1 });
    mockCheckAllowance.mockReset();
    mockCheckAllowance.mockResolvedValue({
      category_id: 'c-1',
      max_quantity: -1,
      issued_this_period: 0,
      remaining: -1,
      period_type: 'none',
    });
    const user = userEvent.setup();
    renderWithRouter(<PoolItemsPage />);
    await screen.findByText('Dept Polo');
    await openIssueFor(user);

    expect(await screen.findByText('No issuance allowance is set for this category.')).toBeInTheDocument();
    expect(screen.queryByText(/-1/)).not.toBeInTheDocument();
  });

  // The log showed the first eight characters of each holder's user id, with
  // the quantity run into the date: "4e6fcf03...qty 199/29/2026".
  it('names who holds each issuance, and returns from them by name', async () => {
    mockGetItems.mockResolvedValue({ items: [poolItem()], total: 1 });
    mockGetItemIssuances.mockResolvedValue([
      {
        id: 'iss-1',
        organization_id: 'org-1',
        item_id: 'p-1',
        user_id: 'u-1',
        quantity_issued: 3,
        issued_at: '2026-09-29T19:46:04Z',
        is_returned: false,
        created_at: '2026-09-29T19:46:04Z',
        updated_at: '2026-09-29T19:46:04Z',
      },
      {
        id: 'iss-2',
        organization_id: 'org-1',
        item_id: 'p-1',
        user_id: 'u-gone',
        quantity_issued: 1,
        issued_at: '2026-09-28T19:46:04Z',
        is_returned: false,
        created_at: '2026-09-28T19:46:04Z',
        updated_at: '2026-09-28T19:46:04Z',
      },
    ]);
    const user = userEvent.setup();
    renderWithRouter(<PoolItemsPage />);
    await screen.findByText('Dept Polo');

    await user.click(screen.getByRole('button', { name: 'Issuances of Dept Polo' }));

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Former member')).toBeInTheDocument();
    expect(screen.queryByText(/u-gone/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Return 3 from Jane Doe' }));

    const dialog = await screen.findByRole('dialog', { name: 'Return to Pool' });
    expect(within(dialog).getByText('Jane Doe')).toBeInTheDocument();
    const qty = within(dialog).getByRole('spinbutton', { name: 'Quantity to return (max 3)' });
    await user.clear(qty);
    await user.type(qty, '5');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Only 3 issued.');
    expect(within(dialog).getByRole('button', { name: 'Return' })).toBeDisabled();
  });

  it('names the category filter and each bulk recipient row', async () => {
    mockGetItems.mockResolvedValue({ items: [poolItem()], total: 1 });
    const user = userEvent.setup();
    renderWithRouter(<PoolItemsPage />);
    await screen.findByText('Dept Polo');

    expect(screen.getByRole('combobox', { name: 'Filter by category' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Bulk Issue/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Add recipient/ }));

    expect(within(dialog).getByRole('combobox', { name: 'Pool Item' })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Recipient 2' })).toBeInTheDocument();
    expect(within(dialog).getByRole('spinbutton', { name: 'Quantity for recipient 2' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Remove recipient 2' })).toBeInTheDocument();
  });

  it('counts lot-stocked items by their lots, not the dead quantity column', async () => {
    // Once an item has any lot, receiving writes to the lots and issuance
    // draws from them, while `quantity` keeps whatever it held the day the
    // item crossed over. Reading that column showed a consumable received as
    // a five-unit lot as out of stock — hidden from the bulk-issuance picker
    // and capped at zero in the issue dialog — for stock the backend will
    // happily dispense.
    mockGetItems.mockResolvedValue({
      items: [poolItem({ quantity: 0, lot_stock: 5, is_lot_stocked: true })],
      total: 1,
    });
    const user = userEvent.setup();
    renderWithRouter(<PoolItemsPage />);
    await screen.findByText('Dept Polo');

    await user.click(screen.getByRole('button', { name: /Bulk Issue/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('option', { name: 'Dept Polo (5 available)' })).toBeInTheDocument();
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
