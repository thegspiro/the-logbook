/**
 * Linking a checklist position to the catalog, and adding to the catalog when
 * there is nothing to link to.
 *
 * The rule these exist to protect is the one that is easy to break by
 * accident: a catalog row is shared by every place the item is stocked, so the
 * position's own numbers must never ride along with it. A test that only
 * proved "an item was created" would pass while a required quantity leaked
 * onto the shared row, so these assert on the exact payload.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetItems = vi.fn();
const mockGetItem = vi.fn();
const mockCreateItem = vi.fn();
const mockItemNameExists = vi.fn();

vi.mock('@/services/inventoryService', () => ({
  inventoryService: {
    getItems: (...a: unknown[]) => mockGetItems(...a) as unknown,
    getItem: (...a: unknown[]) => mockGetItem(...a) as unknown,
    createItem: (...a: unknown[]) => mockCreateItem(...a) as unknown,
    itemNameExists: (...a: unknown[]) => mockItemNameExists(...a) as unknown,
  },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]) => mockToastSuccess(...a) as unknown,
    error: (...a: unknown[]) => mockToastError(...a) as unknown,
  },
}));

import InventoryItemPicker from './InventoryItemPicker';

const catalogItem = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  name: 'Gauze Pads, 4x4 Sterile',
  manufacturer: 'Dynarex',
  model_number: '3111',
  ...over,
});

const emptyResults = { items: [], total: 0, skip: 0, limit: 10 };

describe('InventoryItemPicker', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockReset();
    mockGetItems.mockReset();
    mockGetItem.mockReset();
    mockCreateItem.mockReset();
    mockItemNameExists.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockGetItems.mockResolvedValue(emptyResults);
    mockGetItem.mockResolvedValue(catalogItem());
    mockCreateItem.mockResolvedValue(catalogItem({ id: 'inv-new', name: 'Code Oxygen Cylinder' }));
    mockItemNameExists.mockResolvedValue(false);
  });

  const typeSearch = async (text: string) => {
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search inventory to link…'), text);
    return user;
  };

  describe('without permission to write to the catalog', () => {
    it('dead-ends on the empty state rather than offering to create', async () => {
      render(<InventoryItemPicker onChange={onChange} />);
      await typeSearch('Code Oxygen Cylinder');

      expect(await screen.findByText('No matching items.')).toBeInTheDocument();
      expect(screen.queryByText(/Create .* in inventory/)).not.toBeInTheDocument();
    });
  });

  describe('with inventory.manage', () => {
    it('offers to create the typed name when the catalog has no match', async () => {
      render(<InventoryItemPicker onChange={onChange} canCreateInventory />);
      await typeSearch('Code Oxygen Cylinder');

      expect(await screen.findByText('Create “Code Oxygen Cylinder” in inventory')).toBeInTheDocument();
      expect(screen.queryByText('No matching items.')).not.toBeInTheDocument();
    });

    it('does not offer to create a duplicate of an exact match', async () => {
      mockGetItems.mockResolvedValue({
        items: [catalogItem({ name: 'Code Oxygen Cylinder' })],
        total: 1,
        skip: 0,
        limit: 10,
      });
      render(<InventoryItemPicker onChange={onChange} canCreateInventory />);
      await typeSearch('code oxygen cylinder');

      expect(await screen.findByText('Code Oxygen Cylinder')).toBeInTheDocument();
      expect(screen.queryByText(/Create .* in inventory/)).not.toBeInTheDocument();
    });

    it('creates a bare pool row with nothing on hand, and links it', async () => {
      render(<InventoryItemPicker onChange={onChange} canCreateInventory createTrackingType="pool" />);
      const user = await typeSearch('Code Oxygen Cylinder');

      await user.click(await screen.findByText('Create “Code Oxygen Cylinder” in inventory'));

      await waitFor(() => expect(mockCreateItem).toHaveBeenCalledTimes(1));
      // The whole payload, not a subset: this is the assertion that catches a
      // required quantity, critical minimum or reorder point being added later.
      expect(mockCreateItem).toHaveBeenCalledWith({
        name: 'Code Oxygen Cylinder',
        tracking_type: 'pool',
        quantity: 0,
      });
      expect(onChange).toHaveBeenCalledWith('inv-new', 'Code Oxygen Cylinder');
      expect(mockToastSuccess).toHaveBeenCalled();
    });

    it('creates an individually tracked row for a non-count position', async () => {
      render(<InventoryItemPicker onChange={onChange} canCreateInventory createTrackingType="individual" />);
      const user = await typeSearch('Code Oxygen Cylinder');

      await user.click(await screen.findByText('Create “Code Oxygen Cylinder” in inventory'));

      await waitFor(() => expect(mockCreateItem).toHaveBeenCalledTimes(1));
      expect(mockCreateItem).toHaveBeenCalledWith({
        name: 'Code Oxygen Cylinder',
        tracking_type: 'individual',
        quantity: 1,
      });
    });

    it('refuses to create a name the catalog already holds', async () => {
      // The search cannot see medical stock or past its first page, so the
      // server is the only thing that can answer this.
      mockItemNameExists.mockResolvedValue(true);
      render(<InventoryItemPicker onChange={onChange} canCreateInventory />);
      const user = await typeSearch('Gauze Pads, 4x4 Sterile');

      await user.click(await screen.findByText('Create “Gauze Pads, 4x4 Sterile” in inventory'));

      await waitFor(() => expect(mockItemNameExists).toHaveBeenCalledWith('Gauze Pads, 4x4 Sterile'));
      expect(mockCreateItem).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
      expect(mockToastError).toHaveBeenCalled();
    });

    it('does not create when the existence check itself fails', async () => {
      mockItemNameExists.mockRejectedValue(new Error('Network Error'));
      render(<InventoryItemPicker onChange={onChange} canCreateInventory />);
      const user = await typeSearch('Code Oxygen Cylinder');

      await user.click(await screen.findByText('Create “Code Oxygen Cylinder” in inventory'));

      await waitFor(() => expect(mockToastError).toHaveBeenCalled());
      expect(mockCreateItem).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('links an existing item instead of creating a second one', async () => {
      mockGetItems.mockResolvedValue({ items: [catalogItem()], total: 1, skip: 0, limit: 10 });
      render(<InventoryItemPicker onChange={onChange} canCreateInventory />);
      const user = await typeSearch('Gauze');

      await user.click(await screen.findByText('Gauze Pads, 4x4 Sterile'));

      expect(onChange).toHaveBeenCalledWith('inv-1', 'Gauze Pads, 4x4 Sterile');
      expect(mockCreateItem).not.toHaveBeenCalled();
    });

    it('does not offer creation when the search itself failed', async () => {
      // A failed search proves nothing about the catalog. Offering to create
      // here is how one item ends up as two rows with its links and lots split
      // between them.
      mockGetItems.mockRejectedValue(new Error('Network Error'));
      render(<InventoryItemPicker onChange={onChange} canCreateInventory />);
      await typeSearch('Code Oxygen Cylinder');

      expect(await screen.findByText(/Couldn’t search the catalog/)).toBeInTheDocument();
      expect(screen.queryByText(/Create .* in inventory/)).not.toBeInTheDocument();
      expect(screen.queryByText('No matching items.')).not.toBeInTheDocument();
    });

    it('reports a failed create and leaves the position unlinked', async () => {
      mockCreateItem.mockRejectedValue(new Error('Pool item quantity cannot be negative'));
      render(<InventoryItemPicker onChange={onChange} canCreateInventory />);
      const user = await typeSearch('Code Oxygen Cylinder');

      await user.click(await screen.findByText('Create “Code Oxygen Cylinder” in inventory'));

      await waitFor(() => expect(mockToastError).toHaveBeenCalled());
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
