import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetActive = vi.fn();
const mockGetOverdue = vi.fn();
const mockExtend = vi.fn();

vi.mock('../services/api', () => ({
  // Read by the Operations section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  inventoryService: {
    getActiveTemporaryLoans: (...a: unknown[]) => mockGetActive(...a) as unknown,
    getOverdueTemporaryLoans: (...a: unknown[]) => mockGetOverdue(...a) as unknown,
    extendTemporaryLoan: (...a: unknown[]) => mockExtend(...a) as unknown,
    checkInTemporaryLoan: vi.fn(),
  },
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import InventoryCheckoutsPage from './InventoryCheckoutsPage';

function firstOf(elements: HTMLElement[]): HTMLElement {
  const [head] = elements;
  if (!head) throw new Error('expected at least one matching element');
  return head;
}

const loan = {
  checkout_id: 'co-1',
  item_id: 'coat-1',
  item_name: 'Structural Coat',
  user_name: 'Alex Brooks',
  checked_out_at: '2026-09-29T20:00:00Z',
  expected_return_at: '2026-09-30T22:00:00Z',
  is_overdue: false,
};

describe('InventoryCheckoutsPage', () => {
  beforeEach(() => {
    mockGetActive.mockReset();
    mockGetActive.mockResolvedValue({ checkouts: [loan], total: 1 });
    mockGetOverdue.mockReset();
    mockGetOverdue.mockResolvedValue({ checkouts: [], total: 0 });
    mockExtend.mockReset();
    mockExtend.mockResolvedValue({});
  });

  // new Date('2026-10-05') is UTC midnight, the evening of Oct 4 in Central:
  // a loan extended to Oct 5 was listed as due Oct 4.
  it("extends a loan to the end of the chosen day in the department's zone", async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryCheckoutsPage />);
    // The phone cards and the desktop table are both in the DOM.
    await user.click(firstOf(await screen.findAllByRole('button', { name: /Extend/ })));
    const dialog = await screen.findByRole('dialog', { name: 'Extend Return Date' });
    await user.type(within(dialog).getByLabelText(/New return date/), '2026-10-05');
    await user.click(within(dialog).getByRole('button', { name: 'Extend' }));

    await waitFor(() => expect(mockExtend).toHaveBeenCalledTimes(1));
    expect(mockExtend).toHaveBeenCalledWith('co-1', '2026-10-06T04:59:00.000Z');
  });
});

describe("InventoryCheckoutsPage — the dashboard tile's ?status=overdue", () => {
  const overdueLoan = {
    ...loan,
    checkout_id: 'co-2',
    item_name: 'SCBA Mask',
    user_name: 'Jo Rivera',
    expected_return_at: '2026-09-01T22:00:00Z',
    is_overdue: true,
  };

  beforeEach(() => {
    mockGetActive.mockReset();
    mockGetActive.mockResolvedValue({ checkouts: [loan, overdueLoan], total: 2 });
    mockGetOverdue.mockReset();
    mockGetOverdue.mockResolvedValue({ checkouts: [overdueLoan], total: 1 });
  });

  // renderWithRouter mounts a BrowserRouter, which reads window.location, so
  // the URL is the fixture and has to be put back for the tests after this.
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  const renderAt = (url: string) => {
    window.history.pushState({}, '', url);
    return renderWithRouter(<InventoryCheckoutsPage />);
  };

  it('opens on the Overdue tab, listing only the overdue loans', async () => {
    renderAt('/inventory/checkouts?status=overdue');

    expect(await screen.findByRole('tab', { name: /Overdue/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Active Temporary Loans/ })).toHaveAttribute('aria-selected', 'false');
    const table = screen.getByRole('table');
    expect(within(table).getByText('SCBA Mask')).toBeInTheDocument();
    expect(within(table).queryByText('Structural Coat')).not.toBeInTheDocument();
  });

  it('opens on the Active tab without the parameter, as before', async () => {
    renderAt('/inventory/checkouts');

    expect(await screen.findByRole('tab', { name: /Active Temporary Loans/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('table')).getByText('Structural Coat')).toBeInTheDocument();
  });

  it('clears the filter from the URL when the Active tab is chosen', async () => {
    const user = userEvent.setup();
    renderAt('/inventory/checkouts?status=overdue');

    await user.click(await screen.findByRole('tab', { name: /Active Temporary Loans/ }));

    await waitFor(() => expect(window.location.search).toBe(''));
    expect(within(screen.getByRole('table')).getByText('Structural Coat')).toBeInTheDocument();
  });
});
