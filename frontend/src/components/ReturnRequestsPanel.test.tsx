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

  // W41-6: a write-off retires the item, which for pool stock is the whole shelf.
  it('offers no write-off review when receiving a damaged pool return', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ReturnRequestsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Receive Nitrile Gloves from Jordan Avery' }));
    const dialog = screen.getByRole('dialog', { name: 'Receive Item' });
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Observed condition/ }), 'out_of_service');

    const followUp = within(dialog).getByRole('combobox', { name: /Safety follow-up/ });
    expect(within(followUp).getByRole('option', { name: 'Charge review' })).toBeInTheDocument();
    expect(within(followUp).getByRole('option', { name: 'Maintenance' })).toBeInTheDocument();
    expect(within(followUp).queryByRole('option', { name: 'Write-off review' })).not.toBeInTheDocument();
  });

  it('still offers write-off review for a damaged individual item', async () => {
    mockGetReturnRequests.mockResolvedValue([
      {
        ...gloves,
        id: 'rr-2',
        return_type: 'assignment',
        item_name: 'Helmet',
        issuance_id: undefined,
        assignment_id: 'as-1',
        quantity_returning: 1,
      },
    ]);
    const user = userEvent.setup();
    renderWithRouter(<ReturnRequestsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Receive Helmet from Jordan Avery' }));
    const dialog = screen.getByRole('dialog', { name: 'Receive Item' });
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Observed condition/ }), 'damaged');

    const followUp = within(dialog).getByRole('combobox', { name: /Safety follow-up/ });
    expect(within(followUp).getByRole('option', { name: 'Write-off review' })).toBeInTheDocument();
    expect(within(followUp).queryByRole('option', { name: 'Charge review' })).not.toBeInTheDocument();
  });

  // W39-5: a notice whose gear came back another way is marked received and
  // leaves the Requested queue; the filter is how a quartermaster finds it.
  it('lists notices received another way, with no Receive or Deny action', async () => {
    mockGetReturnRequests.mockResolvedValue([
      {
        ...gloves,
        status: 'received',
        review_notes: 'Received through a direct pool return, not through this notice; not inspected here.',
      },
    ]);
    const user = userEvent.setup();
    renderWithRouter(<ReturnRequestsPanel />);

    await user.selectOptions(await screen.findByRole('combobox', { name: /Status/ }), 'received');

    await waitFor(() => expect(mockGetReturnRequests).toHaveBeenLastCalledWith({ status: 'received' }));
    expect(await screen.findByText(/not through this notice/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Receive Nitrile Gloves/ })).not.toBeInTheDocument();
  });

  // W39-5 follow-on: the received notice is inspected, not received again —
  // no identifier or count, just what the officer observes.
  it('inspects a notice received another way without asking for a count', async () => {
    mockGetReturnRequests.mockResolvedValue([{ ...gloves, status: 'received' }]);
    const user = userEvent.setup();
    renderWithRouter(<ReturnRequestsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Inspect Nitrile Gloves from Jordan Avery' }));
    const dialog = screen.getByRole('dialog', { name: 'Inspect Returned Item' });
    expect(within(dialog).queryByRole('spinbutton', { name: /Quantity physically received/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: /Scanned barcode/ })).not.toBeInTheDocument();

    const submit = within(dialog).getByRole('button', { name: 'Record inspection' });
    expect(submit).toBeDisabled();
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Observed condition/ }), 'damaged');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Safety follow-up/ }), 'charge_review');
    await user.type(within(dialog).getByRole('textbox', { name: /Notes/ }), 'Two torn');
    await user.click(submit);

    await waitFor(() => expect(mockReviewReturnRequest).toHaveBeenCalledTimes(1));
    expect(mockReviewReturnRequest).toHaveBeenCalledWith('rr-1', {
      status: 'inspected',
      review_notes: 'Two torn',
      observed_condition: 'damaged',
      verified_identifier: undefined,
      received_quantity: undefined,
      follow_up: 'charge_review',
    });
  });

  it('offers no Inspect action on a notice still awaiting receipt', async () => {
    renderWithRouter(<ReturnRequestsPanel />);

    expect(await screen.findByRole('button', { name: 'Receive Nitrile Gloves from Jordan Avery' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Inspect Nitrile Gloves/ })).not.toBeInTheDocument();
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
