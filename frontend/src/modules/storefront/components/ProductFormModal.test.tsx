/**
 * A new item starts as a draft, and a draft is offered in no order window, so
 * an item saved with the defaults never reached the store and members saw
 * "Nothing listed yet". The Status field now says so.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockCreateProduct = vi.fn();
const mockToastError = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: {
    createProduct: (...args: unknown[]) => mockCreateProduct(...args) as unknown,
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

import { ProductFormModal } from './ProductFormModal';

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

    await user.type(screen.getByLabelText('Name'), 'Station T-shirt');
    await user.click(screen.getByRole('button', { name: 'Save item' }));

    expect(mockToastError).toHaveBeenCalledWith('Enter a price (type 0 for a free item)');
    expect(mockCreateProduct).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Price/)).toBeRequired();
  });

  it('saves a price of 0 when it is typed', async () => {
    const user = userEvent.setup();
    render(<ProductFormModal isOpen product={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText('Name'), 'Free sticker');
    await user.type(screen.getByLabelText(/^Price/), '0');
    await user.click(screen.getByRole('button', { name: 'Save item' }));

    await waitFor(() => expect(mockCreateProduct).toHaveBeenCalledTimes(1));
    expect(mockCreateProduct.mock.calls[0]?.[0]).toMatchObject({ name: 'Free sticker', price: 0 });
  });
});
