import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { ReturnRequestItem } from '../services/eventServices';

const mockGetReturnRequests = vi.fn();
const mockReviewReturnRequest = vi.fn();

vi.mock('../services/inventoryService', () => ({
  inventoryService: {
    getReturnRequests: (...a: unknown[]) => mockGetReturnRequests(...a) as unknown,
    reviewReturnRequest: (...a: unknown[]) => mockReviewReturnRequest(...a) as unknown,
  },
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import ReturnRequestsPanel from './ReturnRequestsPanel';

const gloves: ReturnRequestItem = {
  id: 'rr-1',
  organization_id: 'org-1',
  requester_id: 'u-1',
  requester_name: 'Jordan Avery',
  return_type: 'issuance',
  item_id: 'it-1',
  item_name: 'Nitrile Gloves',
  issuance_id: 'is-1',
  quantity_returning: 2,
  reported_condition: 'good',
  status: 'requested',
  created_at: '2026-09-29T21:00:00Z',
  updated_at: '2026-09-29T21:00:00Z',
};

describe('ReturnRequestsPanel', () => {
  beforeEach(() => {
    mockGetReturnRequests.mockReset();
    mockGetReturnRequests.mockResolvedValue([gloves]);
    mockReviewReturnRequest.mockReset();
    mockReviewReturnRequest.mockResolvedValue({});
  });

  // The count started at 1 and the server accepts only the quantity being
  // returned, so receiving 2 boxes on the default was refused every time.
  it('receives a multi-unit return only once the count matches what the member reported', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ReturnRequestsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Receive Nitrile Gloves from Jordan Avery' }));
    const dialog = screen.getByRole('dialog', { name: 'Receive Item' });
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Observed condition/ }), 'good');

    const count = within(dialog).getByRole('spinbutton', { name: /Quantity physically received/ });
    expect(count).toHaveValue(null);
    expect(count).toHaveAccessibleDescription(/must match the 2 the member reported/);
    const receive = within(dialog).getByRole('button', { name: 'Receive item' });
    expect(receive).toBeDisabled();

    await user.type(count, '1');
    expect(receive).toBeDisabled();
    await user.clear(count);
    await user.type(count, '2');
    await user.click(receive);

    await waitFor(() => expect(mockReviewReturnRequest).toHaveBeenCalledTimes(1));
    expect(mockReviewReturnRequest).toHaveBeenCalledWith('rr-1', expect.objectContaining({ received_quantity: 2 }));
  });

  it('names each row action after its item and member, and reads conditions as words', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ReturnRequestsPanel />);

    expect(
      await screen.findByRole('button', { name: 'Deny return of Nitrile Gloves from Jordan Avery' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Receive Nitrile Gloves from Jordan Avery' }));

    const dialog = screen.getByRole('dialog', { name: 'Receive Item' });
    expect(within(dialog).getByRole('option', { name: 'Out of service' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('option', { name: /of_service/ })).not.toBeInTheDocument();
  });
});
