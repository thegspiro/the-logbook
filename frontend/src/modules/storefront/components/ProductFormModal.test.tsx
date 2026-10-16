/**
 * A new item starts as a draft, and a draft is offered in no order window, so
 * an item saved with the defaults never reached the store and members saw
 * "Nothing listed yet". The Status field now says so.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../services/api', () => ({ storefrontService: {} }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import { ProductFormModal } from './ProductFormModal';

describe('ProductFormModal status', () => {
  it('starts a new item as a draft and says drafts are not shown to members', () => {
    render(<ProductFormModal isOpen product={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    const status = screen.getByRole('combobox', { name: 'Status' });
    expect(status).toHaveValue('draft');
    expect(status).toHaveAccessibleDescription("Draft items aren't shown to members. Choose Active to sell it.");
  });
});
