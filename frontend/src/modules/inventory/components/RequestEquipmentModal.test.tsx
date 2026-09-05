/**
 * The behaviours this modal exists for, which the type-ahead it replaced got
 * wrong: browsing with nothing typed, one row per product rather than one per
 * stocked size, a size step defaulted from the member's own sizes, and an
 * out-of-stock size that still submits.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { RequestableProduct } from '../types';

const mockGetRequestableCatalog = vi.fn();
const mockCreateEquipmentRequest = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getRequestableCatalog: (...a: unknown[]) => mockGetRequestableCatalog(...a) as unknown,
    createEquipmentRequest: (...a: unknown[]) => mockCreateEquipmentRequest(...a) as unknown,
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

import { RequestEquipmentModal } from './RequestEquipmentModal';

const shirt: RequestableProduct = {
  key: 'vg:1',
  name: 'Long Sleeve',
  category_id: 'cat-1',
  category_name: 'Uniform Shirts',
  tracking_type: 'pool',
  has_sizes: true,
  size_field: 'shirt',
  member_size: null,
  suggested_size: null,
  total_available: 5,
  variants: [
    { item_id: 'item-s', size: 's', size_label: 'S', available: 2 },
    { item_id: 'item-l', size: 'l', size_label: 'L', available: 3 },
    { item_id: 'item-xxl', size: 'xxl', size_label: 'XXL', available: 0 },
  ],
};

const radio: RequestableProduct = {
  key: 'nm:cat-2:portable radio',
  name: 'Portable Radio',
  category_id: 'cat-2',
  category_name: 'Radios',
  tracking_type: 'individual',
  has_sizes: false,
  total_available: 2,
  variants: [{ item_id: 'radio-1', size: null, size_label: null, available: 2 }],
};

const renderModal = (onSubmitted = vi.fn()) =>
  renderWithRouter(<RequestEquipmentModal isOpen onClose={vi.fn()} onSubmitted={onSubmitted} />);

describe('RequestEquipmentModal', () => {
  beforeEach(() => {
    mockGetRequestableCatalog.mockReset();
    mockGetRequestableCatalog.mockResolvedValue({
      products: [shirt, radio],
      categories: [{ id: 'cat-1', name: 'Uniform Shirts' }],
    });
    mockCreateEquipmentRequest.mockReset();
    mockCreateEquipmentRequest.mockResolvedValue({ id: 'r1' });
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
  });

  it('browses the catalog with nothing typed', async () => {
    renderModal();

    // The whole reason this call is unconditional: a member who does not know
    // what the department calls a thing has nothing to type.
    await waitFor(() => expect(mockGetRequestableCatalog).toHaveBeenCalledTimes(1));
    expect(mockGetRequestableCatalog).toHaveBeenCalledWith({ search: undefined, category_id: undefined });
    expect(await screen.findByRole('button', { name: /Long Sleeve/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Portable Radio/ })).toBeInTheDocument();
  });

  it('lists a product once, not once per stocked size', async () => {
    renderModal();

    const rows = await screen.findAllByRole('button', { name: /Long Sleeve/ });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('3 sizes');
  });

  it('sends the search term to the server rather than filtering locally', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole('button', { name: /Long Sleeve/ });

    await user.type(screen.getByLabelText('What do you need?'), 'shirt');

    // Server-side because the match has to reach the category name, which the
    // client never sees for products it was not sent.
    await waitFor(() =>
      expect(mockGetRequestableCatalog).toHaveBeenLastCalledWith({ search: 'shirt', category_id: undefined })
    );
  });

  it('preselects the size the member has on file', async () => {
    mockGetRequestableCatalog.mockResolvedValue({
      products: [{ ...shirt, member_size: 'Large', suggested_size: 'l' }],
      categories: [],
    });
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('button', { name: /Long Sleeve/ }));

    expect(screen.getByRole('button', { name: 'L, 3 on hand' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Your size on file:/)).toBeInTheDocument();
  });

  it('offers the member their own size even when nothing is stocked in it', async () => {
    mockGetRequestableCatalog.mockResolvedValue({
      products: [{ ...shirt, member_size: '4XL', suggested_size: null }],
      categories: [],
    });
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('button', { name: /Long Sleeve/ }));

    const own = screen.getByRole('button', { name: '4XL, none on hand' });
    expect(own).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /Submit Request/ }));

    // No item_id: nothing in the catalog is that size, which is exactly the
    // gap the quartermaster needs the request to report.
    await waitFor(() => expect(mockCreateEquipmentRequest).toHaveBeenCalledTimes(1));
    expect(mockCreateEquipmentRequest.mock.calls[0]?.[0]).toEqual({
      item_name: 'Long Sleeve',
      item_id: undefined,
      category_id: 'cat-1',
      quantity: 1,
      requested_duration: 'temporary',
      requested_size: '4XL',
      reason: undefined,
    });
  });

  it('submits an out-of-stock size against its catalog item', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('button', { name: /Long Sleeve/ }));
    await user.click(screen.getByRole('button', { name: 'XXL, none on hand' }));
    await user.click(screen.getByRole('button', { name: /Submit Request/ }));

    await waitFor(() => expect(mockCreateEquipmentRequest).toHaveBeenCalledTimes(1));
    expect(mockCreateEquipmentRequest.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ item_id: 'item-xxl', requested_size: 'xxl' })
    );
  });

  it('refuses to submit a sized product with no size chosen', async () => {
    const user = userEvent.setup();
    renderModal();

    // This product has several sizes and nothing on file to default from, so
    // opening it leaves the size unset. Guessing one for the member is how a
    // request for the wrong size gets filed under their name.
    await user.click(await screen.findByRole('button', { name: /Long Sleeve/ }));
    await user.click(screen.getByRole('button', { name: /Submit Request/ }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Choose a size'));
    expect(mockCreateEquipmentRequest).not.toHaveBeenCalled();
  });

  it('omits the quantity box for a serialized product', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('button', { name: /Portable Radio/ }));

    expect(screen.queryByLabelText('Quantity')).not.toBeInTheDocument();
    expect(screen.queryByText('Size')).not.toBeInTheDocument();
  });

  it('submits a free-text request for something not in the catalog', async () => {
    const user = userEvent.setup();
    const onSubmitted = vi.fn();
    renderModal(onSubmitted);
    await screen.findByRole('button', { name: /Long Sleeve/ });

    await user.type(screen.getByLabelText(/Describe what you need/), 'Wildland gloves, size L');
    await user.click(screen.getByRole('button', { name: /Submit Request/ }));

    await waitFor(() => expect(mockCreateEquipmentRequest).toHaveBeenCalledTimes(1));
    expect(mockCreateEquipmentRequest.mock.calls[0]?.[0]).toEqual({
      item_name: 'Wildland gloves, size L',
      item_id: undefined,
      category_id: undefined,
      quantity: 1,
      requested_duration: 'temporary',
      requested_size: undefined,
      reason: undefined,
    });
    expect(onSubmitted).toHaveBeenCalled();
  });

  it('lets a free-text request state an ongoing need', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole('button', { name: /Long Sleeve/ });

    await user.type(screen.getByLabelText(/Describe what you need/), 'Wildland gloves');
    // The duration control used to render only alongside a chosen product, so
    // gear the department does not carry — the case most likely to be an
    // ongoing need — could only ever be filed as temporary.
    await user.selectOptions(screen.getByLabelText('How long do you need it?'), 'ongoing');
    await user.click(screen.getByRole('button', { name: /Submit Request/ }));

    await waitFor(() => expect(mockCreateEquipmentRequest).toHaveBeenCalledTimes(1));
    expect(mockCreateEquipmentRequest.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ item_name: 'Wildland gloves', requested_duration: 'ongoing' })
    );
  });

  it('ignores a superseded catalog response', async () => {
    // The unfiltered browse load fires on open and is not debounced. If it is
    // slow, the newer filtered response can land first and then be overwritten
    // by the older one, leaving a list that contradicts the search box.
    let releaseFirst: (value: unknown) => void = () => {};
    const first = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    mockGetRequestableCatalog.mockReset();
    mockGetRequestableCatalog
      .mockImplementationOnce(async () => {
        await first;
        return { products: [shirt, radio], categories: [] };
      })
      .mockResolvedValue({ products: [radio], categories: [] });

    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText('What do you need?'), 'radio');
    await waitFor(() => expect(mockGetRequestableCatalog).toHaveBeenCalledTimes(2));
    await screen.findByRole('button', { name: /Portable Radio/ });

    // Release the stale browse response and let it settle before asserting.
    // Checking immediately proves nothing: the stale write has not landed yet,
    // so the assertion passes whether or not the guard exists.
    releaseFirst(null);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.queryByRole('button', { name: /Long Sleeve/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Portable Radio/ })).toBeInTheDocument();
  });

  it('sends the duration intent the member chose', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('button', { name: /Portable Radio/ }));
    await user.selectOptions(screen.getByLabelText('How long do you need it?'), 'ongoing');
    await user.click(screen.getByRole('button', { name: /Submit Request/ }));

    await waitFor(() =>
      expect(mockCreateEquipmentRequest).toHaveBeenCalledWith(
        expect.objectContaining({ requested_duration: 'ongoing', item_id: 'radio-1' })
      )
    );
  });
});
