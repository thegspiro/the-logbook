import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryScanModal } from './InventoryScanModal';

const { lookupByCode, batchCheckout, transferItem } = vi.hoisted(() => ({
  lookupByCode: vi.fn(), batchCheckout: vi.fn(), transferItem: vi.fn(),
}));
vi.mock('../services/api', () => ({ inventoryService: { lookupByCode, batchCheckout, transferItem } }));
vi.mock('../stores/authStore', () => ({ useAuthStore: (selector: (s: object) => unknown) => selector({ checkPermission: () => true }) }));

describe('InventoryScanModal custody conflicts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks silent reassignment and requires explicit transfer confirmation', async () => {
    lookupByCode.mockResolvedValue({ total: 1, results: [{ matched_field: 'barcode', matched_value: 'HELMET-1', item: { id: 'item-1', name: 'Helmet', status: 'assigned', tracking_type: 'individual' } }] });
    batchCheckout.mockResolvedValue({ user_id: 'new-member', total_scanned: 1, successful: 0, failed: 1, results: [{ code: 'HELMET-1', item_id: 'item-1', item_name: 'Helmet', action: 'none', success: false, error: 'Item is not available', conflict: { holder_id: 'old-member', holder_name: 'Alex Holder', holding_type: 'assignment', record_id: 'holding-1', held_since: '2026-08-01T12:00:00Z' } }] });
    const user = userEvent.setup();
    render(<InventoryScanModal isOpen onClose={vi.fn()} mode="checkout" userId="new-member" memberName="New Member" />);
    const input = screen.getByPlaceholderText(/Search by name/);
    await user.type(input, 'HELMET-1');
    await waitFor(() => expect(lookupByCode).toHaveBeenCalled());
    await user.click(await screen.findByText('Helmet'));
    await user.click(screen.getByRole('button', { name: /Assign 1 Item/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/standard assignment was blocked/)).toBeInTheDocument();
    expect(screen.getByText(/Alex Holder/)).toBeInTheDocument();
    expect(transferItem).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Transfer item' }));
    expect(screen.getByRole('button', { name: 'Confirm transfer' })).toBeDisabled();
  });
});
