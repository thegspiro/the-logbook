/**
 * Adding an item and linking it to the catalog as one act.
 *
 * The point of this control is that the link happens on the way in. A test
 * that only proves an item was added would pass against the old behaviour, so
 * these assert on what reaches `onAdd`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetItems = vi.fn();
const mockGetItemLots = vi.fn();
const mockCreateItem = vi.fn();

vi.mock('@/services/inventoryService', () => ({
  inventoryService: {
    getItems: (...a: unknown[]) => mockGetItems(...a) as unknown,
    getItemLots: (...a: unknown[]) => mockGetItemLots(...a) as unknown,
    createItem: (...a: unknown[]) => mockCreateItem(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import CatalogQuickAdd from './CatalogQuickAdd';

const catalogItem = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  name: 'Gauze Pads, 4x4 Sterile',
  tracking_type: 'pool',
  category_name: 'Medical',
  unit_of_measure: 'Box',
  ...over,
});

describe('CatalogQuickAdd', () => {
  const onAdd = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetItems.mockResolvedValue({ items: [catalogItem()], total: 1, skip: 0, limit: 6 });
    mockGetItemLots.mockResolvedValue([]);
    onAdd.mockResolvedValue(undefined);
  });

  /**
   * The control is controlled by the builder, and its catalog search is
   * driven by typing. A static `value` prop would render the box with text in
   * it but never trigger a search, so the harness owns the state and the
   * tests type into it exactly as a person would.
   */
  const Harness: React.FC<{ canCreate?: boolean }> = ({ canCreate = true }) => {
    const [value, setValue] = useState('');
    return <CatalogQuickAdd value={value} onChange={setValue} onAdd={onAdd} canCreateInventory={canCreate} />;
  };

  const typeName = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.type(screen.getByRole('textbox'), name);
  };

  const renderWith = (canCreate = true) => render(<Harness canCreate={canCreate} />);

  it('adds what was typed when the crew presses Enter', async () => {
    const user = userEvent.setup();
    renderWith();

    await typeName(user, 'Check tire pressure');
    await user.keyboard('{Enter}');

    // Plenty of checklist lines are not stock and never will be; free text
    // has to stay a first-class outcome.
    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith({ name: 'Check tire pressure' });
    });
  });

  it('links the catalog item when one is picked from the list', async () => {
    const user = userEvent.setup();
    renderWith();

    await typeName(user, 'gauze');
    const option = await screen.findByText('Gauze Pads, 4x4 Sterile');
    await user.click(option);

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith({
        // The catalog's name wins: two records that read differently are what
        // made the link invisible in the first place.
        name: 'Gauze Pads, 4x4 Sterile',
        inventoryItemId: 'inv-1',
        checkType: 'quantity',
      });
    });
  });

  it('turns on expiration tracking when the catalog item has dated stock', async () => {
    const user = userEvent.setup();
    mockGetItemLots.mockResolvedValue([{ id: 'lot-1', expiration_date: '2028-01-31' }]);
    renderWith();

    await typeName(user, 'gauze');
    await user.click(await screen.findByText('Gauze Pads, 4x4 Sterile'));

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ hasExpiration: true }));
    });
  });

  it('leaves a serialized catalog item as a pass/fail check', async () => {
    const user = userEvent.setup();
    mockGetItems.mockResolvedValue({
      items: [catalogItem({ id: 'inv-2', name: 'Thermal Imager', tracking_type: 'individual' })],
      total: 1,
      skip: 0,
      limit: 6,
    });
    renderWith();

    await typeName(user, 'imager');
    await user.click(await screen.findByText('Thermal Imager'));

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith({ name: 'Thermal Imager', inventoryItemId: 'inv-2' });
    });
  });

  it('still adds the item when the lot lookup fails', async () => {
    const user = userEvent.setup();
    mockGetItemLots.mockRejectedValue(new Error('network'));
    renderWith();

    await typeName(user, 'gauze');
    await user.click(await screen.findByText('Gauze Pads, 4x4 Sterile'));

    // Expiration can be switched on by hand; an item that never got added
    // cannot.
    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ inventoryItemId: 'inv-1' }));
    });
  });

  it('offers to create the item in inventory when nothing matches', async () => {
    const user = userEvent.setup();
    mockGetItems.mockResolvedValue({ items: [], total: 0, skip: 0, limit: 6 });
    mockCreateItem.mockResolvedValue({ id: 'inv-new', name: 'Burn Sheet' });
    renderWith();

    await typeName(user, 'Burn Sheet');
    await user.click(await screen.findByText(/Create .Burn Sheet. in inventory/));

    await waitFor(() => {
      expect(mockCreateItem).toHaveBeenCalledWith({
        name: 'Burn Sheet',
        tracking_type: 'pool',
        quantity: 0,
      });
    });
    expect(onAdd).toHaveBeenCalledWith({
      name: 'Burn Sheet',
      inventoryItemId: 'inv-new',
      checkType: 'quantity',
    });
  });

  it('hides the create option from someone who cannot write to the catalog', async () => {
    const user = userEvent.setup();
    mockGetItems.mockResolvedValue({ items: [], total: 0, skip: 0, limit: 6 });
    renderWith(false);

    await typeName(user, 'Burn Sheet');

    // Showing it would produce a 403 they have no way to act on.
    await waitFor(() => {
      expect(screen.getByText(/No catalog match/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Create .* in inventory/)).not.toBeInTheDocument();
  });

  it('does not offer to create a name the catalog already has', async () => {
    const user = userEvent.setup();
    mockGetItems.mockResolvedValue({
      items: [catalogItem({ name: 'Burn Sheet' })],
      total: 1,
      skip: 0,
      limit: 6,
    });
    renderWith();

    await typeName(user, 'Burn Sheet');
    await screen.findByText('Burn Sheet');

    expect(screen.queryByText(/Create .* in inventory/)).not.toBeInTheDocument();
  });

  it('does nothing on Enter with an empty box', async () => {
    const user = userEvent.setup();
    renderWith();

    await typeName(user, '   ');
    await user.keyboard('{Enter}');

    expect(onAdd).not.toHaveBeenCalled();
  });

  it('positions the results list against the viewport, not the input', () => {
    // The compartment card this bar sits in is `overflow-hidden` so it can clip
    // its own rounded corners, and the quick-add bar is the *last* element in
    // it. An absolutely-positioned results list is clipped along with
    // everything else, so it always ran past the bottom edge of the card: a
    // user typing three letters saw a sliver of the first result and could not
    // pick any of them, on the control whose only purpose is picking one.
    //
    // Asserted on the class rather than a rendered rect, because jsdom has no
    // layout — every bounding rect it reports is zero, so a geometric assertion
    // would pass against the broken version too.
    const source = readFileSync(join(__dirname, 'CatalogQuickAdd.tsx'), 'utf8');
    const list = source.slice(source.indexOf('{open && typed.length > 0'));
    expect(list).toContain('fixed');
    expect(list).not.toMatch(/className="[^"]*\babsolute\b/);
  });
});
