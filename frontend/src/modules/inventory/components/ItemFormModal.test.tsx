import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InventoryItem, InventoryVendor } from '../types';

const mockCreateItem = vi.fn();
const mockUpdateItem = vi.fn();
const mockCreateSizeVariants = vi.fn();
const mockGetVendors = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    createItem: (...a: unknown[]) => mockCreateItem(...a) as unknown,
    updateItem: (...a: unknown[]) => mockUpdateItem(...a) as unknown,
    createSizeVariants: (...a: unknown[]) => mockCreateSizeVariants(...a) as unknown,
    getVendors: (...a: unknown[]) => mockGetVendors(...a) as unknown,
  },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]): void => {
      mockToastSuccess(...a);
    },
    error: (...a: unknown[]): void => {
      mockToastError(...a);
    },
  },
}));

import { ItemFormModal } from './ItemFormModal';

const baseProps = {
  onClose: vi.fn(),
  onSaved: vi.fn(),
  categories: [],
  locations: [],
  storageAreas: [],
};

const makeItem = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'it-1',
  organization_id: 'org-1',
  name: 'Old Drill',
  condition: 'good',
  status: 'available',
  tracking_type: 'individual',
  quantity: 1,
  quantity_issued: 0,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeVendor = (overrides: Partial<InventoryVendor> = {}): InventoryVendor => ({
  id: 'v-1',
  organization_id: 'org-1',
  name: 'Galls',
  is_preferred: false,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  contacts: [],
  item_count: 0,
  open_reorder_count: 0,
  ...overrides,
});

// The Name field has no associated label; it is the first textbox in the form.
const nameInput = (): HTMLElement => {
  const [el] = screen.getAllByRole('textbox');
  if (!el) throw new Error('name input not found');
  return el;
};

describe('ItemFormModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateItem.mockResolvedValue({});
    mockUpdateItem.mockResolvedValue({});
    mockCreateSizeVariants.mockResolvedValue({ created_count: 1, items: [] });
    mockGetVendors.mockResolvedValue([]);
  });

  it('renders nothing when closed', () => {
    render(<ItemFormModal {...baseProps} isOpen={false} />);
    expect(screen.queryByText('Add Item')).not.toBeInTheDocument();
  });

  it('creates a new item', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ItemFormModal {...baseProps} isOpen onSaved={onSaved} onClose={onClose} />);

    await user.type(nameInput(), 'New Drill');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mockCreateItem).toHaveBeenCalledTimes(1));
    expect(mockCreateItem.mock.calls[0]?.[0]).toMatchObject({ name: 'New Drill' });
    expect(mockToastSuccess).toHaveBeenCalledWith('Item created');
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('edits an existing item', async () => {
    const user = userEvent.setup();
    render(<ItemFormModal {...baseProps} isOpen editItem={makeItem()} />);

    expect(screen.getByText('Edit Item')).toBeInTheDocument();
    expect(nameInput()).toHaveValue('Old Drill');

    await user.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(mockUpdateItem).toHaveBeenCalledTimes(1));
    expect(mockUpdateItem.mock.calls[0]?.[0]).toBe('it-1');
    expect(mockToastSuccess).toHaveBeenCalledWith('Item updated');
  });

  it('shows an error toast when saving fails', async () => {
    mockCreateItem.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<ItemFormModal {...baseProps} isOpen />);

    await user.type(nameInput(), 'X');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
  });

  it('generates size variants when the toggle is enabled', async () => {
    const user = userEvent.setup();
    render(<ItemFormModal {...baseProps} isOpen />);

    await user.type(nameInput(), 'Dept Polo');
    await user.click(screen.getByRole('checkbox')); // Generate Sizes & Styles
    await user.click(screen.getByRole('button', { name: 'M' })); // size chip
    await user.click(screen.getByRole('button', { name: /Create 1 Item/ }));

    await waitFor(() => expect(mockCreateSizeVariants).toHaveBeenCalledTimes(1));
    expect(mockCreateSizeVariants.mock.calls[0]?.[0]).toMatchObject({
      base_name: 'Dept Polo',
      sizes: ['m'],
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Created 1 variant items');
    expect(mockCreateItem).not.toHaveBeenCalled();
  });

  it('links a new item to the picked vendor', async () => {
    const user = userEvent.setup();
    mockGetVendors.mockResolvedValue([makeVendor()]);
    render(<ItemFormModal {...baseProps} isOpen />);

    await user.type(nameInput(), 'Bunker Coat');
    await user.click(screen.getByRole('button', { name: /Financial/ }));
    await user.selectOptions(await screen.findByLabelText('Vendor'), 'v-1');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mockCreateItem).toHaveBeenCalledTimes(1));
    expect(mockCreateItem.mock.calls[0]?.[0]).toMatchObject({ vendor_id: 'v-1' });
  });

  it('offers the free-text name only while no vendor is linked', async () => {
    const user = userEvent.setup();
    mockGetVendors.mockResolvedValue([makeVendor()]);
    render(<ItemFormModal {...baseProps} isOpen />);

    await user.click(screen.getByRole('button', { name: /Financial/ }));
    expect(await screen.findByLabelText('Vendor name (not on file)')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Vendor'), 'v-1');
    expect(screen.queryByLabelText('Vendor name (not on file)')).not.toBeInTheDocument();
  });

  // The vendor fields were the only two carrying this fix; everything else in
  // the same payload still omitted a cleared box, so the old value survived.
  it('sends an explicit null for every field an edit clears', async () => {
    const user = userEvent.setup();
    mockGetVendors.mockResolvedValue([]);
    render(
      <ItemFormModal
        {...baseProps}
        isOpen
        editItem={makeItem({ serial_number: 'SN-1', description: 'old text', notes: 'old notes' })}
      />
    );

    // Fields in this modal have no associated label, so they are found by the
    // value the edit seeded them with.
    await user.clear(screen.getByDisplayValue('SN-1'));
    await user.clear(screen.getByDisplayValue('old text'));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(mockUpdateItem).toHaveBeenCalledTimes(1));
    expect(mockUpdateItem.mock.calls[0]?.[1]).toMatchObject({
      serial_number: null,
      description: null,
    });
  });

  // `|| undefined` stays correct on create — a blank must be omitted so `""`
  // never reaches a Pydantic validator.
  it('omits a blank field on create rather than sending null', async () => {
    const user = userEvent.setup();
    mockGetVendors.mockResolvedValue([]);
    render(<ItemFormModal {...baseProps} isOpen />);

    await user.type(nameInput(), 'Helmet');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mockCreateItem).toHaveBeenCalledTimes(1));
    const payload = mockCreateItem.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.serial_number).toBeUndefined();
    expect(payload.description).toBeUndefined();
  });

  // Three fields are deliberately left out of the null treatment because the
  // backend raises on them, not because the column rejects a null.
  it('leaves condition, quantity and tracking type omitted on an edit', async () => {
    const user = userEvent.setup();
    mockGetVendors.mockResolvedValue([]);
    render(<ItemFormModal {...baseProps} isOpen editItem={makeItem()} />);

    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(mockUpdateItem).toHaveBeenCalledTimes(1));
    const payload = mockUpdateItem.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.condition).not.toBeNull();
    expect(payload.quantity).not.toBeNull();
    expect(payload.tracking_type).not.toBeNull();
  });

  it('sends an explicit null when an edit unlinks the vendor', async () => {
    const user = userEvent.setup();
    mockGetVendors.mockResolvedValue([makeVendor()]);
    render(<ItemFormModal {...baseProps} isOpen editItem={makeItem({ vendor_id: 'v-1' })} />);

    await user.click(screen.getByRole('button', { name: /Financial/ }));
    await user.selectOptions(await screen.findByLabelText('Vendor'), '');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(mockUpdateItem).toHaveBeenCalledTimes(1));
    expect(mockUpdateItem.mock.calls[0]?.[1]).toMatchObject({ vendor_id: null });
  });
});
