import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { IssuanceChargeListItem } from '../services/eventServices';

const mockGetCharges = vi.fn();
const mockUpdateIssuanceCharge = vi.fn();

vi.mock('../services/inventoryService', () => ({
  inventoryService: {
    getCharges: (...a: unknown[]) => mockGetCharges(...a) as unknown,
    updateIssuanceCharge: (...a: unknown[]) => mockUpdateIssuanceCharge(...a) as unknown,
  },
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import ChargeManagementPanel from './ChargeManagementPanel';

function firstOf(elements: HTMLElement[]): HTMLElement {
  const [head] = elements;
  if (!head) throw new Error('expected at least one matching element');
  return head;
}

const pending: IssuanceChargeListItem = {
  issuance_id: 'is-1',
  item_id: 'it-1',
  item_name: 'Nitrile Gloves',
  user_id: 'u-1',
  user_name: 'Jordan Avery',
  quantity_issued: 1,
  issued_at: '2026-09-29T19:46:04Z',
  returned_at: '2026-09-29T22:47:20Z',
  is_returned: true,
  return_condition: 'damaged',
  charge_status: 'pending',
};

describe('ChargeManagementPanel', () => {
  beforeEach(() => {
    mockGetCharges.mockReset();
    mockGetCharges.mockResolvedValue({
      items: [pending],
      total: 1,
      total_pending: 0,
      total_charged: 0,
      total_waived: 0,
    });
    mockUpdateIssuanceCharge.mockReset();
    mockUpdateIssuanceCharge.mockResolvedValue({});
  });

  // A charge is final once applied, and a blank or $0 amount was applied as
  // "charged $0.00" with no Charge or Waive left to correct it.
  it('applies a charge only for an amount above $0, and names its dialog', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ChargeManagementPanel />);
    await screen.findAllByText('Nitrile Gloves');

    // The desktop table and the phone cards are both in the DOM.
    await user.click(firstOf(screen.getAllByRole('button', { name: 'Charge' })));
    const dialog = screen.getByRole('dialog', { name: 'Apply Charge' });
    const amount = within(dialog).getByRole('spinbutton', { name: 'Charge Amount ($)' });
    const apply = within(dialog).getByRole('button', { name: 'Apply Charge' });

    expect(apply).toBeDisabled();
    expect(amount).toHaveAccessibleDescription(/waive the charge instead/);
    await user.type(amount, '0');
    expect(apply).toBeDisabled();

    await user.clear(amount);
    await user.type(amount, '12.50');
    await user.click(apply);

    await waitFor(() => expect(mockUpdateIssuanceCharge).toHaveBeenCalledWith('is-1', 'charged', 12.5));
  });
});
