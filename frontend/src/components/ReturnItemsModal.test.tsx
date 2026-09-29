import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetUserInventory = vi.fn();
const mockUnassignItem = vi.fn();
const mockReturnToPool = vi.fn();

vi.mock('../services/api', () => ({
  inventoryService: {
    getUserInventory: (...a: unknown[]) => mockGetUserInventory(...a) as unknown,
    unassignItem: (...a: unknown[]) => mockUnassignItem(...a) as unknown,
    returnToPool: (...a: unknown[]) => mockReturnToPool(...a) as unknown,
    checkInItem: vi.fn(),
  },
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ReturnItemsModal } from './ReturnItemsModal';

const inventory = {
  permanent_assignments: [
    {
      assignment_id: 'as-1',
      item_id: 'coat-1',
      item_name: 'Structural Coat',
      serial_number: 'TC-1001',
      asset_tag: null,
      condition: 'good',
      assigned_date: '2026-09-29T19:46:04Z',
      category_name: 'Turnout Gear',
      quantity: 1,
    },
  ],
  active_checkouts: [],
  issued_items: [
    {
      issuance_id: 'is-1',
      item_id: 'gloves-1',
      item_name: 'Nitrile Gloves',
      quantity_issued: 2,
      issued_at: '2026-09-29T19:46:04Z',
      size: null,
      category_name: 'EMS Supplies',
    },
  ],
};

const renderModal = () =>
  render(<ReturnItemsModal isOpen onClose={vi.fn()} userId="u-1" memberName="Jordan Avery" onComplete={vi.fn()} />);

describe('ReturnItemsModal', () => {
  beforeEach(() => {
    mockGetUserInventory.mockReset();
    mockGetUserInventory.mockResolvedValue(structuredClone(inventory));
    mockUnassignItem.mockReset();
    mockUnassignItem.mockResolvedValue({});
    mockReturnToPool.mockReset();
    mockReturnToPool.mockResolvedValue({});
  });

  // Each row was a clickable div with a drawn checkbox: nothing a keyboard
  // could reach or a screen reader could announce, so a quartermaster not
  // using a mouse could not return anything.
  it('offers each held item as a named checkbox', async () => {
    renderModal();

    expect(await screen.findByRole('checkbox', { name: 'Return Structural Coat (Assigned)' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Return Nitrile Gloves (Issued (Pool))' })).not.toBeChecked();
  });

  it('returns an item chosen from the keyboard', async () => {
    const user = userEvent.setup();
    renderModal();
    const coat = await screen.findByRole('checkbox', { name: 'Return Structural Coat (Assigned)' });

    coat.focus();
    await user.keyboard(' ');
    expect(coat).toBeChecked();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Return condition for Structural Coat' }), 'fair');
    await user.click(screen.getByRole('button', { name: /Return 1 Item/ }));

    expect(mockUnassignItem).toHaveBeenCalledWith('coat-1', { return_condition: 'fair' });
    expect(mockReturnToPool).not.toHaveBeenCalled();
    expect(await screen.findByText('1 returned')).toBeInTheDocument();
  });

  it('toggles once when the checkbox itself is clicked', async () => {
    const user = userEvent.setup();
    renderModal();
    const gloves = await screen.findByRole('checkbox', { name: 'Return Nitrile Gloves (Issued (Pool))' });

    await user.click(gloves);

    expect(gloves).toBeChecked();
    expect(screen.getByRole('button', { name: /Return 1 Item/ })).toBeInTheDocument();
  });
});
