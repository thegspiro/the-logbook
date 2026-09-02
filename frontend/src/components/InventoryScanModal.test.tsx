import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryScanModal } from './InventoryScanModal';

const { lookupByCode, distributeItems, transferItem } = vi.hoisted(() => ({
  lookupByCode: vi.fn(),
  distributeItems: vi.fn(),
  transferItem: vi.fn(),
}));
vi.mock('../services/api', () => ({ inventoryService: { lookupByCode, distributeItems, transferItem } }));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: object) => unknown) => selector({ checkPermission: () => true }),
}));

/** First element of a query result, asserted present. Keeps the guard out of
 *  the test body (vitest/no-conditional-in-test) and avoids indexing into a
 *  possibly-undefined slot (noUncheckedIndexedAccess). */
function firstOf(elements: HTMLElement[]): HTMLElement {
  const [head] = elements;
  if (!head) throw new Error('expected at least one matching element');
  return head;
}

describe('InventoryScanModal custody conflicts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks silent reassignment and requires explicit transfer confirmation', async () => {
    lookupByCode.mockResolvedValue({
      total: 1,
      results: [
        {
          matched_field: 'barcode',
          matched_value: 'HELMET-1',
          item: { id: 'item-1', name: 'Helmet', status: 'assigned', tracking_type: 'individual' },
        },
      ],
    });
    distributeItems.mockResolvedValue({
      user_id: 'new-member',
      total_scanned: 1,
      successful: 0,
      failed: 1,
      results: [
        {
          code: 'HELMET-1',
          item_id: 'item-1',
          item_name: 'Helmet',
          action: 'none',
          success: false,
          error: 'Item is not available',
          conflict: {
            holder_id: 'old-member',
            holder_name: 'Alex Holder',
            holding_type: 'assignment',
            record_id: 'holding-1',
            held_since: '2026-08-01T12:00:00Z',
          },
        },
      ],
    });
    const user = userEvent.setup();
    render(
      <InventoryScanModal isOpen onClose={vi.fn()} mode="distribute" userId="new-member" memberName="New Member" />
    );
    const input = screen.getByPlaceholderText(/Search by name/);
    await user.type(input, 'HELMET-1');
    await waitFor(() => expect(lookupByCode).toHaveBeenCalled());
    await user.click(await screen.findByText('Helmet'));
    // #1885 made the operation explicit; the review step stays disabled until
    // one is chosen, so the conflict path is unreachable without it.
    await user.click(screen.getByRole('radio', { name: 'Ongoing assignment' }));
    await user.click(screen.getByRole('button', { name: /Review 1 Item/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/standard assignment was blocked/)).toBeInTheDocument();
    expect(screen.getByText(/Alex Holder/)).toBeInTheDocument();
    expect(transferItem).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Transfer item' }));
    expect(screen.getByRole('button', { name: 'Confirm transfer' })).toBeDisabled();
  });

  it('clears the holder attestation between two conflicting items', async () => {
    const conflictResult = (id: string, name: string, holder: string) => ({
      code: id,
      item_id: id,
      item_name: name,
      action: 'none',
      success: false,
      error: 'Item is not available',
      conflict: {
        holder_id: `${id}-holder`,
        holder_name: holder,
        holding_type: 'assignment',
        record_id: `holding-${id}`,
        held_since: '2026-08-01T12:00:00Z',
      },
    });
    lookupByCode.mockResolvedValue({
      total: 2,
      results: [
        {
          matched_field: 'barcode',
          matched_value: 'HELMET-1',
          item: { id: 'item-1', name: 'Helmet', status: 'assigned', tracking_type: 'individual' },
        },
        {
          matched_field: 'barcode',
          matched_value: 'HELMET-2',
          item: { id: 'item-2', name: 'Spare Helmet', status: 'assigned', tracking_type: 'individual' },
        },
      ],
    });
    distributeItems.mockResolvedValue({
      user_id: 'new-member',
      total_scanned: 2,
      successful: 0,
      failed: 2,
      results: [
        conflictResult('item-1', 'Helmet', 'Dana Reyes'),
        conflictResult('item-2', 'Spare Helmet', 'Chris Baker'),
      ],
    });
    transferItem.mockResolvedValue({ success: true });

    const user = userEvent.setup();
    render(
      <InventoryScanModal isOpen onClose={vi.fn()} mode="distribute" userId="new-member" memberName="New Member" />
    );
    await user.type(screen.getByPlaceholderText(/Search by name/), 'HELMET');
    await waitFor(() => expect(lookupByCode).toHaveBeenCalled());
    await user.click(await screen.findByText('Helmet'));
    await user.click(screen.getByRole('radio', { name: 'Ongoing assignment' }));
    await user.click(screen.getByRole('button', { name: /Review/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    // Transfer the first conflicting item, attesting to ITS holder.
    await user.click(firstOf(await screen.findAllByRole('button', { name: 'Transfer item' })));
    // Scoped to the checkbox's own label: the holder name also appears in the
    // results list behind the dialog.
    await user.click(screen.getByRole('checkbox', { name: /Dana Reyes/ }));
    await user.type(screen.getByRole('textbox', { name: /Transfer reason/ }), 'Reassigned to new member');
    await user.click(screen.getByRole('button', { name: 'Confirm transfer' }));
    await waitFor(() => expect(transferItem).toHaveBeenCalledTimes(1));

    // Now the SECOND item, whose holder the quartermaster has not yet seen.
    // Carrying the tick and reason over would present an attestation about
    // Chris Baker already agreed to, one click from being filed.
    // The transferred row loses its conflict, so only the second item's button
    // remains.
    await user.click(firstOf(await screen.findAllByRole('button', { name: 'Transfer item' })));
    expect(screen.getByRole('checkbox', { name: /Chris Baker/ })).not.toBeChecked();
    expect(screen.getByRole('textbox', { name: /Transfer reason/ })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Confirm transfer' })).toBeDisabled();
  });
});
