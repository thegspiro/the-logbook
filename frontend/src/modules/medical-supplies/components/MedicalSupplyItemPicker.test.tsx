import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockGetItems = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../../services/medicalSuppliesService', () => ({
  medicalSuppliesService: {
    getItems: (...args: unknown[]) => mockGetItems(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => mockToastError(...args) as unknown },
}));

import { MedicalSupplyItemPicker } from './MedicalSupplyItemPicker';

/** `n` items named "Gauze 1".."Gauze n", offset by `skip`. */
const page = (skip: number, count: number, total: number) => ({
  items: Array.from({ length: count }, (_, i) => ({ id: `item-${skip + i}`, name: `Gauze ${skip + i}` })),
  total,
  skip,
  limit: 20,
});

const renderPicker = (
  props: { value?: string; selectedName?: string; onChange?: (id: string, name?: string) => void } = {}
) =>
  renderWithRouter(
    <MedicalSupplyItemPicker
      id="line-0-item"
      value={props.value ?? ''}
      selectedName={props.selectedName}
      onChange={props.onChange ?? vi.fn()}
    />
  );

describe('MedicalSupplyItemPicker', () => {
  beforeEach(() => {
    [mockGetItems, mockToastError].forEach((mock) => mock.mockReset());
    mockGetItems.mockResolvedValue(page(0, 0, 0));
  });

  it('asks for the next page by skip rather than a larger limit', async () => {
    // The endpoint caps limit at 500 (le=500). Growing the limit by 20 per
    // activation therefore walked into a 422 on the 25th click, and the catch
    // cleared every result and left Try again repeating the same bad request.
    mockGetItems.mockResolvedValue(page(0, 20, 45));

    const user = userEvent.setup();
    renderPicker();
    await user.type(screen.getByRole('combobox'), 'gauze');

    expect(await screen.findByRole('option', { name: 'Gauze 0' })).toBeInTheDocument();
    expect(await screen.findByText('Show more (20 of 45)')).toBeInTheDocument();
    expect(mockGetItems).toHaveBeenLastCalledWith({ search: 'gauze', active_only: true, skip: 0, limit: 20 });

    mockGetItems.mockResolvedValue(page(20, 20, 45));
    await user.click(screen.getByText('Show more (20 of 45)'));

    // The second page is requested at an offset, and the limit never grows.
    await waitFor(() =>
      expect(mockGetItems).toHaveBeenLastCalledWith({ search: 'gauze', active_only: true, skip: 20, limit: 20 })
    );
    // ...and it is appended, so the first page's matches stay selectable.
    expect(await screen.findByRole('option', { name: 'Gauze 20' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Gauze 0' })).toBeInTheDocument();
  });

  it('keeps the pages already shown when the next one fails', async () => {
    mockGetItems.mockResolvedValue(page(0, 20, 45));

    const user = userEvent.setup();
    renderPicker();
    await user.type(screen.getByRole('combobox'), 'gauze');
    expect(await screen.findByText('Show more (20 of 45)')).toBeInTheDocument();

    mockGetItems.mockRejectedValue(new Error('Network Error'));
    await user.click(screen.getByText('Show more (20 of 45)'));

    expect(await screen.findByText('Could not search the catalog.')).toBeInTheDocument();
    // A failed *next* page does not invalidate what is already on screen.
    expect(screen.getByRole('option', { name: 'Gauze 0' })).toBeInTheDocument();
  });

  it('moves focus to Clear after a selection instead of dropping it on the body', async () => {
    // Selecting unmounts the combobox for the selected-item view. Without this
    // the next Tab restarts at the dialog's first control rather than
    // continuing to Qty.
    mockGetItems.mockResolvedValue(page(0, 1, 1));

    const user = userEvent.setup();
    let selected = '';
    const { rerender } = renderPicker({ onChange: (id) => (selected = id) });
    await user.type(screen.getByRole('combobox'), 'gauze');
    await user.click(await screen.findByRole('option', { name: 'Gauze 0' }));
    expect(selected).toBe('item-0');

    rerender(<MedicalSupplyItemPicker id="line-0-item" value="item-0" selectedName="Gauze 0" onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Clear Gauze 0' })).toHaveFocus());
  });

  it('scrolls the keyboard-highlighted option into view', async () => {
    // The list caps at max-h-56 while a page holds 20 options, so arrowing
    // past the first few left the highlight outside the scrollport.
    mockGetItems.mockResolvedValue(page(0, 20, 20));
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });

    const user = userEvent.setup();
    renderPicker();
    const input = screen.getByRole('combobox');
    await user.type(input, 'gauze');
    await screen.findByRole('option', { name: 'Gauze 0' });

    await user.keyboard('{ArrowDown}');

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' }));
  });
});
