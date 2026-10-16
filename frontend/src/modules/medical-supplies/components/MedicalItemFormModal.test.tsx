import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { InventoryCategory, InventoryItem } from '../../../services/eventServices';

const mockCreateItem = vi.fn();
const mockUpdateItem = vi.fn();
const mockGetStorageOptions = vi.fn();

vi.mock('../../../services/medicalSuppliesService', () => ({
  medicalSuppliesService: {
    createItem: (...args: unknown[]) => mockCreateItem(...args) as unknown,
    updateItem: (...args: unknown[]) => mockUpdateItem(...args) as unknown,
    getStorageOptions: (...args: unknown[]) => mockGetStorageOptions(...args) as unknown,
  },
}));

import { MedicalItemFormModal } from './MedicalItemFormModal';

const category: InventoryCategory = {
  id: 'cat-bandages',
  organization_id: 'org-1',
  name: 'Bandages',
  item_type: 'medical',
  requires_assignment: false,
  requires_serial_number: false,
  requires_maintenance: false,
  nfpa_tracking_enabled: false,
  allow_self_checkout: false,
  self_checkout_loan_days: null,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const storageOptions = {
  rooms: [
    { id: 'room-supply', name: 'Supply Room' },
    { id: 'room-bay', name: 'Apparatus Bay' },
  ],
  areas: [
    {
      id: 'area-cabinet',
      name: 'Cabinet B',
      location_id: 'room-supply',
      location_name: 'Supply Room',
      path: 'Cabinet B',
    },
    {
      id: 'area-shelf',
      name: 'Shelf 2',
      parent_id: 'area-cabinet',
      location_id: 'room-supply',
      location_name: 'Supply Room',
      path: 'Cabinet B › Shelf 2',
    },
    { id: 'area-rack', name: 'Rack 1', location_id: 'room-bay', location_name: 'Apparatus Bay', path: 'Rack 1' },
  ],
};

describe('MedicalItemFormModal', () => {
  beforeEach(() => {
    mockCreateItem.mockReset();
    mockUpdateItem.mockReset();
    mockGetStorageOptions.mockReset();
    mockCreateItem.mockResolvedValue({ id: 'item-1' });
    mockGetStorageOptions.mockResolvedValue(storageOptions);
  });

  it('keeps Save and Cancel in the pinned footer, outside the scrolling fields', () => {
    renderWithRouter(
      <MedicalItemFormModal categories={[category]} categoriesError={null} onClose={vi.fn()} onSaved={vi.fn()} />
    );

    expect(screen.getByTestId('modal-panel').tagName).toBe('FORM');
    const footer = screen.getByTestId('modal-footer');
    expect(within(footer).getByRole('button', { name: 'Add supply' })).toHaveAttribute('type', 'submit');
    expect(within(footer).getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button');
  });

  it('submits the form from the footer button', async () => {
    const onSaved = vi.fn();
    renderWithRouter(
      <MedicalItemFormModal categories={[category]} categoriesError={null} onClose={vi.fn()} onSaved={onSaved} />
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Name/), 'Gauze pads');
    await user.selectOptions(screen.getByLabelText(/^Category/), 'cat-bandages');
    await user.click(screen.getByRole('button', { name: 'Add supply' }));

    expect(mockCreateItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Gauze pads', category_id: 'cat-bandages', tracking_type: 'pool' })
    );
    expect(onSaved).toHaveBeenCalled();
  });

  // The shared create schema defaults a missing quantity to 1, so omitting
  // a blank box put one phantom unit on the shelf of a supply nobody had
  // received.
  const fillRequired = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText(/^Name/), 'Oral airway kit');
    await user.selectOptions(screen.getByLabelText(/^Category/), 'cat-bandages');
  };

  it('sends a blank On hand as 0 on create', async () => {
    renderWithRouter(
      <MedicalItemFormModal categories={[category]} categoriesError={null} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    const user = userEvent.setup();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Add supply' }));

    expect(mockCreateItem).toHaveBeenCalledWith(expect.objectContaining({ quantity: 0 }));
  });

  it('sends a typed On hand as that number on create', async () => {
    renderWithRouter(
      <MedicalItemFormModal categories={[category]} categoriesError={null} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    const user = userEvent.setup();
    await fillRequired(user);
    await user.type(screen.getByLabelText(/^On hand/), '12');
    await user.click(screen.getByRole('button', { name: 'Add supply' }));

    expect(mockCreateItem).toHaveBeenCalledWith(expect.objectContaining({ quantity: 12 }));
  });

  describe('also called', () => {
    const baseItem = {
      id: 'item-1',
      organization_id: 'org-1',
      name: 'Bag Valve Mask',
      category_id: 'cat-bandages',
      condition: 'good',
      status: 'available',
      tracking_type: 'pool',
      quantity: 2,
      quantity_issued: 0,
      active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    } as unknown as InventoryItem;

    beforeEach(() => {
      mockCreateItem.mockReset();
      mockUpdateItem.mockReset();
      mockCreateItem.mockResolvedValue({ id: 'item-1' });
      mockUpdateItem.mockResolvedValue({ id: 'item-1' });
    });

    it('sends the names as a list on create', async () => {
      renderWithRouter(
        <MedicalItemFormModal categories={[category]} categoriesError={null} onClose={vi.fn()} onSaved={vi.fn()} />
      );

      const user = userEvent.setup();
      await user.type(screen.getByLabelText(/^Name/), 'Bag Valve Mask');
      await user.type(screen.getByLabelText('Also called'), 'BVM, Ambu bag');
      await user.selectOptions(screen.getByLabelText(/^Category/), 'cat-bandages');
      await user.click(screen.getByRole('button', { name: 'Add supply' }));

      expect(mockCreateItem).toHaveBeenCalledWith(expect.objectContaining({ also_called: ['BVM', 'Ambu bag'] }));
    });

    it('omits it on create when left empty', async () => {
      renderWithRouter(
        <MedicalItemFormModal categories={[category]} categoriesError={null} onClose={vi.fn()} onSaved={vi.fn()} />
      );

      const user = userEvent.setup();
      await user.type(screen.getByLabelText(/^Name/), 'Gauze pads');
      await user.selectOptions(screen.getByLabelText(/^Category/), 'cat-bandages');
      await user.click(screen.getByRole('button', { name: 'Add supply' }));

      const payload = mockCreateItem.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload['also_called']).toBeUndefined();
    });

    it('fills the box from the stored list, and an emptied box sends an empty list', async () => {
      renderWithRouter(
        <MedicalItemFormModal
          categories={[category]}
          categoriesError={null}
          item={{ ...baseItem, also_called: ['BVM', 'Ambu bag'] }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );

      const box = screen.getByLabelText('Also called');
      expect(box).toHaveValue('BVM, Ambu bag');

      const user = userEvent.setup();
      await user.clear(box);
      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockUpdateItem).toHaveBeenCalledWith('item-1', expect.objectContaining({ also_called: [] }));
    });
  });

  describe('size', () => {
    beforeEach(() => {
      mockCreateItem.mockReset();
      mockUpdateItem.mockReset();
      mockCreateItem.mockResolvedValue({ id: 'item-1' });
      mockUpdateItem.mockResolvedValue({ id: 'item-1' });
    });

    it('sends the size on create, and omits a blank one', async () => {
      renderWithRouter(
        <MedicalItemFormModal categories={[category]} categoriesError={null} onClose={vi.fn()} onSaved={vi.fn()} />
      );
      const user = userEvent.setup();
      await user.type(screen.getByLabelText(/^Name/), 'Oxygen Mask');
      await user.type(screen.getByLabelText('Size'), 'Pediatric');
      await user.selectOptions(screen.getByLabelText(/^Category/), 'cat-bandages');
      await user.click(screen.getByRole('button', { name: 'Add supply' }));

      expect(mockCreateItem).toHaveBeenCalledWith(expect.objectContaining({ size: 'Pediatric' }));
    });

    it('shows the stored size, and clearing it sends null', async () => {
      renderWithRouter(
        <MedicalItemFormModal
          categories={[category]}
          categoriesError={null}
          item={
            {
              id: 'item-1',
              name: 'Oxygen Mask',
              size: 'Adult',
              category_id: 'cat-bandages',
              tracking_type: 'pool',
              quantity: 2,
            } as unknown as InventoryItem
          }
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );
      const box = screen.getByLabelText('Size');
      expect(box).toHaveValue('Adult');

      const user = userEvent.setup();
      await user.clear(box);
      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockUpdateItem).toHaveBeenCalledWith('item-1', expect.objectContaining({ size: null }));
    });
  });

  describe('where it is kept', () => {
    const item = {
      id: 'item-1',
      organization_id: 'org-1',
      name: 'Gauze Pads',
      category_id: 'cat-bandages',
      condition: 'good',
      status: 'available',
      tracking_type: 'pool',
      quantity: 2,
      quantity_issued: 0,
      active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    } as unknown as InventoryItem;

    it('files a new supply under the area chosen, and takes the room from it', async () => {
      const user = userEvent.setup();
      renderWithRouter(
        <MedicalItemFormModal categories={[category]} categoriesError={null} onClose={vi.fn()} onSaved={vi.fn()} />
      );
      await user.type(screen.getByLabelText(/^Name/), 'Gauze Pads');
      await user.selectOptions(screen.getByLabelText(/^Category/), 'cat-bandages');

      const area = await screen.findByLabelText('Storage area');
      await user.selectOptions(area, 'area-shelf');
      expect(screen.getByLabelText('Room')).toHaveValue('room-supply');
      await user.click(screen.getByRole('button', { name: 'Add supply' }));

      expect(mockCreateItem).toHaveBeenCalledWith(
        expect.objectContaining({ location_id: 'room-supply', storage_area_id: 'area-shelf' })
      );
    });

    it('omits the location on create when none is chosen', async () => {
      const user = userEvent.setup();
      renderWithRouter(
        <MedicalItemFormModal categories={[category]} categoriesError={null} onClose={vi.fn()} onSaved={vi.fn()} />
      );
      await screen.findByRole('option', { name: 'Supply Room' });
      await user.type(screen.getByLabelText(/^Name/), 'Gauze Pads');
      await user.selectOptions(screen.getByLabelText(/^Category/), 'cat-bandages');
      await user.click(screen.getByRole('button', { name: 'Add supply' }));

      const [payload] = mockCreateItem.mock.calls[0] as [Record<string, unknown>];
      expect(payload['location_id']).toBeUndefined();
      expect(payload['storage_area_id']).toBeUndefined();
    });

    it('offers only the chosen room’s areas, and drops an area from another room', async () => {
      const user = userEvent.setup();
      renderWithRouter(
        <MedicalItemFormModal categories={[category]} categoriesError={null} onClose={vi.fn()} onSaved={vi.fn()} />
      );
      const area = await screen.findByLabelText('Storage area');
      await user.selectOptions(area, 'area-rack');
      await user.selectOptions(screen.getByLabelText('Room'), 'room-supply');

      expect(area).toHaveValue('');
      expect(within(area).queryByRole('option', { name: /Rack 1/ })).not.toBeInTheDocument();
      expect(within(area).getByRole('option', { name: 'Cabinet B › Shelf 2' })).toBeInTheDocument();
    });

    it('clears the area and room on edit as explicit nulls', async () => {
      const user = userEvent.setup();
      const filed = {
        ...item,
        location_id: 'room-supply',
        storage_area_id: 'area-shelf',
      } as InventoryItem;
      renderWithRouter(
        <MedicalItemFormModal
          categories={[category]}
          categoriesError={null}
          item={filed}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );
      const area = await screen.findByLabelText('Storage area');
      await screen.findByRole('option', { name: 'Cabinet B › Shelf 2' });
      await user.selectOptions(area, '');
      await user.selectOptions(screen.getByLabelText('Room'), '');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      expect(mockUpdateItem).toHaveBeenCalledWith(
        filed.id,
        expect.objectContaining({ location_id: null, storage_area_id: null })
      );
    });

    it("shows the area's room for a supply filed on an area with no room of its own", async () => {
      renderWithRouter(
        <MedicalItemFormModal
          categories={[category]}
          categoriesError={null}
          item={{ ...item, storage_area_id: 'area-shelf' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );

      await screen.findByRole('option', { name: 'Cabinet B › Shelf 2' });
      expect(screen.getByLabelText('Room')).toHaveValue('room-supply');
      expect(screen.getByLabelText('Storage area')).toHaveValue('area-shelf');
    });

    it('keeps a supply filed in a retired area rather than reading it as unfiled', async () => {
      const filed = {
        ...item,
        storage_area_id: 'area-retired',
        storage_path: 'Old Bin',
      } as InventoryItem;
      renderWithRouter(
        <MedicalItemFormModal
          categories={[category]}
          categoriesError={null}
          item={filed}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );

      expect(await screen.findByRole('option', { name: 'Old Bin (retired)' })).toBeInTheDocument();
      expect(screen.getByLabelText('Storage area')).toHaveValue('area-retired');
    });

    it('still saves the note when the storage areas cannot be loaded', async () => {
      mockGetStorageOptions.mockRejectedValue(new Error('Server unavailable'));
      const user = userEvent.setup();
      renderWithRouter(
        <MedicalItemFormModal categories={[category]} categoriesError={null} onClose={vi.fn()} onSaved={vi.fn()} />
      );

      expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable');
      await user.type(screen.getByLabelText(/^Name/), 'Gauze Pads');
      await user.selectOptions(screen.getByLabelText(/^Category/), 'cat-bandages');
      await user.type(screen.getByLabelText('Storage note'), 'Top drawer');
      await user.click(screen.getByRole('button', { name: 'Add supply' }));

      expect(mockCreateItem).toHaveBeenCalledWith(expect.objectContaining({ storage_location: 'Top drawer' }));
    });
  });

  describe('kept on apparatus only', () => {
    const lucas = {
      id: 'item-lucas',
      organization_id: 'org-1',
      name: 'LUCAS device',
      category_id: 'cat-bandages',
      tracking_type: 'pool',
      quantity: 3,
      quantity_issued: 0,
      storage_area_id: 'area-cabinet',
      location_id: 'room-supply',
      active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    } as unknown as InventoryItem;

    beforeEach(() => {
      mockCreateItem.mockReset();
      mockUpdateItem.mockReset();
      mockGetStorageOptions.mockReset();
      mockCreateItem.mockResolvedValue({ id: 'item-1' });
      mockUpdateItem.mockResolvedValue({ id: 'item-1' });
      mockGetStorageOptions.mockResolvedValue(storageOptions);
    });

    it('hides the shelf count and storage fields once ticked, and sends the flag on create', async () => {
      const user = userEvent.setup();
      renderWithRouter(
        <MedicalItemFormModal categories={[category]} categoriesError={null} onClose={vi.fn()} onSaved={vi.fn()} />
      );

      await user.type(screen.getByLabelText(/^Name/), 'LUCAS device');
      await user.selectOptions(screen.getByLabelText(/^Category/), 'cat-bandages');
      await user.click(screen.getByRole('checkbox', { name: 'Kept on apparatus only' }));

      expect(screen.queryByLabelText('On hand')).not.toBeInTheDocument();
      expect(screen.getByText('Counted on the apparatus checklists.')).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Where it is kept' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Add supply' }));
      expect(mockCreateItem).toHaveBeenCalledWith(expect.objectContaining({ apparatus_only: true }));
    });

    it('sends false on create when left unticked', async () => {
      const user = userEvent.setup();
      renderWithRouter(
        <MedicalItemFormModal categories={[category]} categoriesError={null} onClose={vi.fn()} onSaved={vi.fn()} />
      );
      await user.type(screen.getByLabelText(/^Name/), 'Gauze Pads');
      await user.selectOptions(screen.getByLabelText(/^Category/), 'cat-bandages');
      await user.click(screen.getByRole('button', { name: 'Add supply' }));

      expect(mockCreateItem).toHaveBeenCalledWith(expect.objectContaining({ apparatus_only: false }));
    });

    it('shows the stored setting, and unticking it on an edit sends false and keeps the stored place', async () => {
      const user = userEvent.setup();
      renderWithRouter(
        <MedicalItemFormModal
          categories={[category]}
          categoriesError={null}
          item={{ ...lucas, apparatus_only: true }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );

      const box = screen.getByRole('checkbox', { name: 'Kept on apparatus only' });
      expect(box).toBeChecked();
      await user.click(box);
      expect(await screen.findByLabelText('On hand')).toHaveValue(3);
      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockUpdateItem).toHaveBeenCalledWith(
        'item-lucas',
        expect.objectContaining({ apparatus_only: false, storage_area_id: 'area-cabinet', location_id: 'room-supply' })
      );
    });
  });
});
