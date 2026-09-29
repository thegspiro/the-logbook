import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetActive = vi.fn();
const mockGetOverdue = vi.fn();
const mockExtend = vi.fn();

vi.mock('../services/api', () => ({
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
