import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InventoryItem } from '../types';

const mockCreateItem = vi.fn();
const mockUpdateItem = vi.fn();
const mockCreateSizeVariants = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    createItem: (...a: unknown[]) => mockCreateItem(...a) as unknown,
    updateItem: (...a: unknown[]) => mockUpdateItem(...a) as unknown,
    createSizeVariants: (...a: unknown[]) => mockCreateSizeVariants(...a) as unknown,
  },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]): void => { mockToastSuccess(...a); },
    error: (...a: unknown[]): void => { mockToastError(...a); },
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
});
