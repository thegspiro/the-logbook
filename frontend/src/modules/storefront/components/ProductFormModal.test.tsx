/**
 * A new item starts as a draft, and a draft is offered in no order window, so
 * an item saved with the defaults never reached the store and members saw
 * "Nothing listed yet". The Status field now says so.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockCreateProduct = vi.fn();
const mockUpdateProduct = vi.fn();
const mockToastError = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: {
    createProduct: (...args: unknown[]) => mockCreateProduct(...args) as unknown,
    updateProduct: (...args: unknown[]) => mockUpdateProduct(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({
  default: {
    error: (...args: unknown[]): void => {
      mockToastError(...args);
    },
    success: vi.fn(),
  },
}));

import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import type { StoreProduct } from '../types';
import { ProductFormModal } from './ProductFormModal';

// The app shell mounts ConfirmProvider; the dialog needs it to ask before discarding.
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: ConfirmProvider });

describe('ProductFormModal status', () => {
  it('starts a new item as a draft and says drafts are not shown to members', () => {
    render(<ProductFormModal isOpen product={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    const status = screen.getByRole('combobox', { name: 'Status' });
    expect(status).toHaveValue('draft');
    expect(status).toHaveAccessibleDescription("Draft items aren't shown to members. Choose Active to sell it.");
  });
});

describe('ProductFormModal price', () => {
  beforeEach(() => {
    mockCreateProduct.mockReset();
    mockCreateProduct.mockResolvedValue({});
    mockToastError.mockReset();
  });

  it('will not save an item whose price was left blank', async () => {
    // A blank price used to go out as 0, putting the item on sale for free.
    const user = userEvent.setup();
    render(<ProductFormModal isOpen product={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText(/^Name/), 'Station T-shirt');
    await user.click(screen.getByRole('button', { name: 'Save item' }));

    expect(screen.getByLabelText(/^Price/)).toHaveAccessibleDescription('Enter a price (type 0 for a free item).');
    expect(mockCreateProduct).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Price/)).toBeRequired();
  });

  it('saves a price of 0 when it is typed', async () => {
    const user = userEvent.setup();
    render(<ProductFormModal isOpen product={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText(/^Name/), 'Free sticker');
    await user.type(screen.getByLabelText(/^Price/), '0');
    await user.click(screen.getByRole('button', { name: 'Save item' }));

    await waitFor(() => expect(mockCreateProduct).toHaveBeenCalledTimes(1));
    expect(mockCreateProduct.mock.calls[0]?.[0]).toMatchObject({ name: 'Free sticker', price: 0 });
  });
});

describe('ProductFormModal errors and discarding', () => {
  const tooLong = (field: string) => ({
    response: { status: 422, data: { detail: [{ field, message: 'Value is too long.' }] } },
  });

  beforeEach(() => {
    mockCreateProduct.mockReset();
    mockCreateProduct.mockResolvedValue({});
    mockUpdateProduct.mockReset();
    mockUpdateProduct.mockResolvedValue({});
    mockToastError.mockReset();
  });

  it('puts a refusal of a new item on its field, announced, and adds nothing', async () => {
    mockCreateProduct.mockRejectedValueOnce(tooLong('sku'));
    const user = userEvent.setup();
    render(<ProductFormModal isOpen product={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText(/^Name/), 'Station T-shirt');
    await user.type(screen.getByLabelText(/^Price/), '20');
    await user.type(screen.getByLabelText(/^SKU/), 'TS-1');
    await user.click(screen.getByRole('button', { name: 'Save item' }));

    const sku = screen.getByLabelText(/^SKU/);
    await waitFor(() => expect(sku).toHaveAccessibleDescription('SKU is too long — keep it to 100 characters.'));
    expect(sku).toHaveAttribute('aria-invalid', 'true');
    expect(mockToastError).toHaveBeenCalledWith('Fix the fields marked below, then save again.');
  });

  it('saves the rest of an edit, keeps the stored price when it is blanked and flags it', async () => {
    const product = {
      id: 'p-1',
      name: 'Station T-shirt',
      sku: null,
      description: null,
      imageUrl: null,
      category: 'Apparel',
      price: 20,
      cost: null,
      isTaxable: false,
      status: 'active',
      maxPerMember: null,
      trackStock: false,
      stockQuantity: null,
      requiresVariant: false,
      personalizationEnabled: false,
      personalizationRequired: false,
      personalizationLabel: null,
      sortOrder: 0,
      internalNotes: null,
      variants: [],
    } as unknown as StoreProduct;
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<ProductFormModal isOpen product={product} onClose={vi.fn()} onSaved={onSaved} />);
    await user.clear(screen.getByLabelText(/^Price/));
    await user.clear(screen.getByLabelText('Category'));
    await user.click(screen.getByRole('button', { name: 'Save item' }));

    await waitFor(() => expect(mockUpdateProduct).toHaveBeenCalledTimes(1));
    const payload = mockUpdateProduct.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('price');
    expect(payload).toMatchObject({ category: null });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/^Price/)).toHaveAccessibleDescription('Enter a price (type 0 for a free item).');
  });

  it('asks before Escape or Cancel discards what was typed', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ProductFormModal isOpen product={null} onClose={onClose} onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText(/^Name/), 'Station T-shirt');

    fireEvent.keyDown(document, { key: 'Escape' });
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
