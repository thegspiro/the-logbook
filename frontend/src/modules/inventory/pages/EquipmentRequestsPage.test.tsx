import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockGetEquipmentRequests = vi.fn();
const mockReviewEquipmentRequest = vi.fn();
const mockFulfillEquipmentRequest = vi.fn();
const mockGetFulfillmentOptions = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getEquipmentRequests: (...args: unknown[]) => mockGetEquipmentRequests(...args) as unknown,
    reviewEquipmentRequest: (...args: unknown[]) => mockReviewEquipmentRequest(...args) as unknown,
    fulfillEquipmentRequest: (...args: unknown[]) => mockFulfillEquipmentRequest(...args) as unknown,
    getFulfillmentOptions: (...args: unknown[]) => mockGetFulfillmentOptions(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
  },
}));

import EquipmentRequestsPage from './EquipmentRequestsPage';

const makeRequest = (overrides: Record<string, unknown> = {}) => ({
  id: 'req-1',
  item_name: 'Radio XTS 5000',
  status: 'pending',
  request_type: 'checkout',
  requested_duration: 'temporary',
  requester_name: 'John Doe',
  quantity: 1,
  reason: 'Need for shift',
  review_notes: '',
  created_at: '2026-01-15T10:00:00Z',
  ...overrides,
});

/**
 * One row of `GET /inventory/requests/{id}/fulfillment-options`.
 *
 * The judgements are fields here rather than something the test derives,
 * because they are the backend's to make: `tests/
 * test_inventory_fulfillment_options.py` pins the size aliasing, the qualifier
 * comparison, the product-identity scoping and the issuable count against the
 * service that enforces them at fulfilment. Re-checking those rules here would
 * only assert that this mock returns what it was given.
 */
const option = (id: string, overrides: Record<string, unknown> = {}) => ({
  item_id: id,
  name: 'Polo',
  identifier: null,
  size: 'l',
  size_label: 'L',
  status: 'available',
  tracking_type: 'pool',
  available: 6,
  compatible: true,
  matches_requested_size: true,
  ...overrides,
});

const fulfillmentOptions = (overrides: Record<string, unknown> = {}) => ({
  request_id: 'req-1',
  requested_size: 'l',
  quantity: 1,
  suggested_item_id: null,
  requested_size_available: true,
  can_fulfill_now: true,
  truncated: false,
  options: [],
  ...overrides,
});

describe('EquipmentRequestsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [makeRequest()], total: 1, skip: 0, limit: 25 });
    mockGetFulfillmentOptions.mockResolvedValue(
      fulfillmentOptions({ options: [option('item-9', { name: 'Radio XTS 5000', tracking_type: 'individual' })] })
    );
  });

  it('renders page title and subtitle', async () => {
    renderWithRouter(<EquipmentRequestsPage />);
    expect(screen.getByText('Gear Requests')).toBeInTheDocument();
    expect(screen.getByText('Review member requests for equipment')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockGetEquipmentRequests).toHaveBeenCalledWith({ status: 'pending', skip: 0, limit: 25 });
    });
  });

  it('renders back link to admin', () => {
    renderWithRouter(<EquipmentRequestsPage />);
    const backLink = screen.getByRole('link', { name: /Back to Admin/ });
    expect(backLink).toHaveAttribute('href', '/inventory/admin');
  });

  it('loads and displays equipment requests', async () => {
    renderWithRouter(<EquipmentRequestsPage />);
    await waitFor(() => {
      expect(screen.getByText('Radio XTS 5000')).toBeInTheDocument();
    });
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText('Temporary need')).toBeInTheDocument();
    expect(screen.getByText(/John Doe/)).toBeInTheDocument();
    expect(screen.getByText(/Need for shift/)).toBeInTheDocument();
  });

  it('does not present member-selected priority to quartermasters', async () => {
    mockGetEquipmentRequests.mockResolvedValue({
      requests: [makeRequest({ priority: 'high' })],
      total: 1,
      skip: 0,
      limit: 25,
    });
    renderWithRouter(<EquipmentRequestsPage />);

    expect(await screen.findByText('Radio XTS 5000')).toBeInTheDocument();
    expect(screen.queryByText('high', { exact: false })).not.toBeInTheDocument();
  });

  it('shows empty state when no requests', async () => {
    mockGetEquipmentRequests.mockResolvedValue({ requests: [], total: 0, skip: 0, limit: 25 });
    renderWithRouter(<EquipmentRequestsPage />);
    await waitFor(() => {
      expect(screen.getByText('No Requests')).toBeInTheDocument();
    });
  });

  it('filters requests by status', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EquipmentRequestsPage />);
    await waitFor(() => {
      expect(mockGetEquipmentRequests).toHaveBeenCalledWith({ status: 'pending', skip: 0, limit: 25 });
    });
    const select = screen.getByLabelText('Filter by status');
    await user.selectOptions(select, 'approved');
    await waitFor(() => {
      expect(mockGetEquipmentRequests).toHaveBeenCalledWith({ status: 'approved', skip: 0, limit: 25 });
    });
  });

  it('loads the next page and displays the real result total', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({
      requests: [makeRequest()],
      total: 51,
      skip: 0,
      limit: 25,
    });
    renderWithRouter(<EquipmentRequestsPage />);

    expect(await screen.findByText('Showing 1–25 of 51')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Next/ }));

    await waitFor(() => {
      expect(mockGetEquipmentRequests).toHaveBeenLastCalledWith({ status: 'pending', skip: 25, limit: 25 });
    });
  });

  it('opens review modal when Review button is clicked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EquipmentRequestsPage />);
    await waitFor(() => {
      expect(screen.getByText('Radio XTS 5000')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Review'));
    await waitFor(() => {
      expect(screen.getByText('Review Notes (optional)')).toBeInTheDocument();
    });
  });

  it('approves a request', async () => {
    const user = userEvent.setup();
    mockReviewEquipmentRequest.mockResolvedValue({});
    renderWithRouter(<EquipmentRequestsPage />);
    await waitFor(() => {
      expect(screen.getByText('Radio XTS 5000')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Review'));
    // #1884 split approval into "approve now, fulfil later" and "approve &
    // fulfil now"; this test covers the former, which is the review call.
    await user.click(await screen.findByText('Approve for later fulfillment'));
    await waitFor(() => {
      expect(mockReviewEquipmentRequest).toHaveBeenCalledWith('req-1', {
        status: 'approved',
        review_notes: undefined,
      });
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Request approved');
  });

  it('denies a request with notes', async () => {
    const user = userEvent.setup();
    mockReviewEquipmentRequest.mockResolvedValue({});
    renderWithRouter(<EquipmentRequestsPage />);
    await waitFor(() => {
      expect(screen.getByText('Radio XTS 5000')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Review'));
    const notesField = await screen.findByPlaceholderText('Optional notes for the requester...');
    await user.type(notesField, 'Not available');
    await user.click(screen.getByText('Deny'));
    await waitFor(() => {
      expect(mockReviewEquipmentRequest).toHaveBeenCalledWith('req-1', {
        status: 'denied',
        review_notes: 'Not available',
      });
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Request denied');
  });

  it('handles review error', async () => {
    const user = userEvent.setup();
    mockReviewEquipmentRequest.mockRejectedValue(new Error('Server error'));
    renderWithRouter(<EquipmentRequestsPage />);
    await waitFor(() => {
      expect(screen.getByText('Radio XTS 5000')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Review'));
    await user.click(await screen.findByText('Approve for later fulfillment'));
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(expect.any(String));
    });
  });

  it('does not show Review button for non-pending requests', async () => {
    mockGetEquipmentRequests.mockResolvedValue({
      requests: [makeRequest({ status: 'approved' })],
    });
    renderWithRouter(<EquipmentRequestsPage />);
    await waitFor(() => {
      expect(screen.getByText('Radio XTS 5000')).toBeInTheDocument();
    });
    expect(screen.queryByText('Review')).not.toBeInTheDocument();
  });

  it('shows quantity when > 1', async () => {
    mockGetEquipmentRequests.mockResolvedValue({
      requests: [makeRequest({ quantity: 3 })],
    });
    renderWithRouter(<EquipmentRequestsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Qty: 3/)).toBeInTheDocument();
    });
  });

  it('shows Fulfill button for approved requests and fulfills with the request item', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({
      requests: [makeRequest({ status: 'approved', requested_duration: 'ongoing', item_id: 'item-9', quantity: 2 })],
    });
    mockFulfillEquipmentRequest.mockResolvedValue({
      id: 'req-1',
      status: 'fulfilled',
      fulfillment_type: 'issuance',
      fulfillment_reference_id: 'iss-1',
      message: 'ok',
    });
    renderWithRouter(<EquipmentRequestsPage />);
    await waitFor(() => {
      expect(screen.getByText('Radio XTS 5000')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Fulfill'));
    await user.selectOptions(await screen.findByLabelText('Final fulfillment method'), 'assignment');
    // Modal pre-fills the request's item and quantity
    await user.click(await screen.findByRole('button', { name: /Fulfill Request/ }));
    await waitFor(() => {
      expect(mockFulfillEquipmentRequest).toHaveBeenCalledWith('req-1', {
        fulfillment_type: 'assignment',
        item_id: 'item-9',
        quantity: 2,
        expected_return_at: undefined,
        override_allowance: false,
      });
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Request fulfilled');
  });

  const poloRequest = (overrides: Record<string, unknown> = {}) =>
    makeRequest({
      item_name: 'Polo',
      status: 'approved',
      category_id: 'cat-1',
      requested_size: 'l',
      ...overrides,
    });

  it('preselects the item the backend judged unambiguous', async () => {
    const user = userEvent.setup();
    // No item_id: the member asked for a size the catalog had nothing in when
    // the request was filed, so the picker has to be told which variant fits.
    mockGetEquipmentRequests.mockResolvedValue({ requests: [poloRequest()] });
    mockGetFulfillmentOptions.mockResolvedValue(
      fulfillmentOptions({
        suggested_item_id: 'polo-l',
        options: [option('polo-m', { size: 'm', matches_requested_size: false }), option('polo-l')],
      })
    );
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Polo')).toBeInTheDocument();

    await user.click(screen.getByText('Fulfill'));

    expect(await screen.findByLabelText('Item to fulfill with')).toHaveValue('polo-l');
    // Pool stock is refused unless the method is issuance, so the automatic
    // selection has to move the method with it.
    expect(screen.getByLabelText('Final fulfillment method')).toHaveValue('issuance');
  });

  it('leaves the choice manual when the backend suggests nothing', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [poloRequest()] });
    // Null covers every case the service refuses to decide: a different
    // product in the right size, too few units for the pre-filled quantity, a
    // size qualifier that does not match, two variant groups sharing a name.
    mockGetFulfillmentOptions.mockResolvedValue(
      fulfillmentOptions({ suggested_item_id: null, options: [option('trousers-l', { name: 'Duty Trousers' })] })
    );
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Polo')).toBeInTheDocument();

    await user.click(screen.getByText('Fulfill'));

    expect(await screen.findByLabelText('Item to fulfill with')).toHaveValue('');
  });

  it('does not overwrite the item the member themselves named', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [poloRequest({ item_id: 'polo-m' })] });
    mockGetFulfillmentOptions.mockResolvedValue(
      fulfillmentOptions({ suggested_item_id: 'polo-l', options: [option('polo-m', { size: 'm' }), option('polo-l')] })
    );
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Polo')).toBeInTheDocument();

    await user.click(screen.getByText('Fulfill'));

    // They picked a stocked variant; a suggestion is for the case where they
    // could not, and must not quietly swap their choice for another size.
    expect(await screen.findByLabelText('Item to fulfill with')).toHaveValue('polo-m');
  });

  it('says so when nothing on hand is the requested size', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [poloRequest({ requested_size: 'xxl' })] });
    mockGetFulfillmentOptions.mockResolvedValue(
      fulfillmentOptions({
        requested_size_available: false,
        options: [option('polo-m', { size: 'm', matches_requested_size: false })],
      })
    );
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Polo')).toBeInTheDocument();

    await user.click(screen.getByText('Fulfill'));

    // Every option is a different size, so issuing one silently changes what
    // the member receives unless the screen says otherwise.
    expect(await screen.findByText(/Nothing on hand is size/)).toBeInTheDocument();
  });

  it('does not warn about the size before availability has been queried', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [poloRequest({ requested_size: 'xxl' })] });
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    mockGetFulfillmentOptions.mockReset();
    mockGetFulfillmentOptions.mockImplementation(async () => {
      await pending;
      return fulfillmentOptions({ suggested_item_id: 'polo-xxl', options: [option('polo-xxl', { size: 'xxl' })] });
    });
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Polo')).toBeInTheDocument();

    await user.click(screen.getByText('Fulfill'));

    // The stock is there; it just has not arrived yet. Announcing a shortage
    // now can send a quartermaster off to order gear that already exists.
    expect(screen.queryByText(/Nothing on hand is size/)).not.toBeInTheDocument();

    release(null);
    expect(await screen.findByLabelText('Item to fulfill with')).toHaveValue('polo-xxl');
    expect(screen.queryByText(/Nothing on hand is size/)).not.toBeInTheDocument();
  });

  it('ignores a stale options load from a dialog that has been closed', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({
      requests: [poloRequest({ id: 'req-a', requested_size: 'm' }), poloRequest({ id: 'req-b', requested_size: 'l' })],
    });
    let releaseFirst: (value: unknown) => void = () => {};
    const first = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    mockGetFulfillmentOptions.mockReset();
    mockGetFulfillmentOptions
      .mockImplementationOnce(async () => {
        await first;
        return fulfillmentOptions({ suggested_item_id: 'polo-m', options: [option('polo-m', { size: 'm' })] });
      })
      .mockResolvedValue(fulfillmentOptions({ suggested_item_id: 'polo-l', options: [option('polo-l')] }));
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findAllByText('Polo')).toHaveLength(2);

    // Open request A (size M), close it, open request B (size L) — all before
    // A's options query lands.
    // A guard rather than `!`: an indexed lookup is `T | undefined` under
    // noUncheckedIndexedAccess, and a non-null assertion would turn a fixture
    // that stopped rendering two rows into a confusing null-deref instead of
    // this message.
    const nthFulfill = (index: number): HTMLElement => {
      const button = screen.getAllByText('Fulfill')[index];
      if (!button) throw new Error(`expected a Fulfill button at index ${String(index)}`);
      return button;
    };

    await user.click(nthFulfill(0));
    await user.click(screen.getByRole('button', { name: 'Close modal' }));
    await user.click(nthFulfill(1));

    releaseFirst(null);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // A's callback must not reach into B's dialog: the backend would accept
    // A's item as category-compatible and issue the wrong size.
    expect(screen.getByLabelText('Item to fulfill with')).toHaveValue('polo-l');
  });

  it('labels each option with its size, availability and role', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [poloRequest()] });
    mockGetFulfillmentOptions.mockResolvedValue(
      fulfillmentOptions({
        options: [
          option('polo-l', { identifier: 'POLO-4417' }),
          option('boot-l', { name: 'Station Boot', compatible: false, available: 2 }),
        ],
      })
    );
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Polo')).toBeInTheDocument();

    await user.click(screen.getByText('Fulfill'));

    // No "— available —": the unremarkable status said nothing and consumed the
    // width the requested-size marker and the count need.
    expect(
      await screen.findByRole('option', { name: 'Polo — POLO-4417 — size L · requested size · 6 issuable' })
    ).toBeInTheDocument();
    // Marked, because under the override the list carries rows the request
    // does not cover and nothing else on screen distinguishes them.
    expect(
      screen.getByRole('option', {
        name: 'Station Boot — size L · requested size · substitution · 2 issuable',
      })
    ).toBeInTheDocument();
  });

  it('names a status only when it is not the unremarkable one', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [poloRequest()] });
    mockGetFulfillmentOptions.mockResolvedValue(
      fulfillmentOptions({
        options: [option('gloves', { name: 'Gloves', status: 'in_maintenance', available: 0 })],
      })
    );
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Polo')).toBeInTheDocument();

    await user.click(screen.getByText('Fulfill'));

    // Readable, not the raw enum: the status is now the thing that draws the
    // eye, so an underscore in it is what the reader is left looking at.
    expect(
      await screen.findByRole('option', { name: 'Gloves — size L · requested size · in maintenance · 0 issuable' })
    ).toBeInTheDocument();
  });

  it('repeats the chosen row details where a select cannot clip them', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [poloRequest()] });
    mockGetFulfillmentOptions.mockResolvedValue(
      fulfillmentOptions({ suggested_item_id: 'polo-l', options: [option('polo-l')] })
    );
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Polo')).toBeInTheDocument();

    await user.click(screen.getByText('Fulfill'));

    // A native select shows only the selected row, clipped to the control's
    // width — on a phone that is the phone's width, and the tail it cuts is
    // where the marker and the count live.
    await waitFor(() => expect(screen.getByLabelText('Item to fulfill with')).toHaveValue('polo-l'));
    expect(screen.getByText('size L · requested size · 6 issuable')).toBeInTheDocument();
  });

  it('shows no detail line until a row is chosen', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [poloRequest()] });
    mockGetFulfillmentOptions.mockResolvedValue(
      fulfillmentOptions({ suggested_item_id: null, options: [option('polo-l')] })
    );
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Polo')).toBeInTheDocument();

    await user.click(screen.getByText('Fulfill'));

    expect(await screen.findByLabelText('Item to fulfill with')).toHaveValue('');
    // Describing a row nobody picked would read as a selection that was made.
    expect(screen.queryByText('size L · requested size · 6 issuable')).not.toBeInTheDocument();
  });

  it('says when the option list was capped rather than exhausted', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [poloRequest()] });
    mockGetFulfillmentOptions.mockResolvedValue(fulfillmentOptions({ truncated: true, options: [option('polo-l')] }));
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Polo')).toBeInTheDocument();

    await user.click(screen.getByText('Fulfill'));

    // A picker that quietly stops at its cap reads as "that is all there is",
    // which is the one thing it cannot promise.
    expect(await screen.findByText(/more inventory matched than fits this list/)).toBeInTheDocument();
  });

  it('widens the browse when the substitution override is turned on', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [poloRequest()] });
    mockGetFulfillmentOptions.mockResolvedValue(fulfillmentOptions({ options: [option('polo-l')] }));
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Polo')).toBeInTheDocument();

    await user.click(screen.getByText('Fulfill'));
    await user.click(await screen.findByLabelText(/Override requested item\/category compatibility/));

    // The wider catalog is fetched, not filtered out of a list the client
    // already holds: on a department with more gear than one page, "everything
    // else" is not something the browser has seen.
    await waitFor(() => {
      expect(mockGetFulfillmentOptions).toHaveBeenCalledWith('req-1', { include_incompatible: true });
    });
  });

  it('does not offer to fulfil now when the backend says nothing is issuable', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({
      requests: [makeRequest({ status: 'pending', category_id: 'cat-1' })],
    });
    mockGetFulfillmentOptions.mockResolvedValue(
      fulfillmentOptions({
        can_fulfill_now: false,
        options: [option('gloves', { name: 'Gloves', status: 'in_maintenance', available: 0 })],
      })
    );
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Radio XTS 5000')).toBeInTheDocument();

    await user.click(screen.getByText('Review'));

    // Twelve on the shelf, none issuable: offering "Approve & fulfill now"
    // here promises a fulfilment `issue_from_pool` refuses.
    expect(await screen.findByRole('button', { name: /Approve & fulfill now/ })).toBeDisabled();
  });

  it('displays fulfillment details for fulfilled requests', async () => {
    mockGetEquipmentRequests.mockResolvedValue({
      requests: [
        makeRequest({ status: 'fulfilled', fulfillment_type: 'issuance', fulfilled_at: '2026-01-16T10:00:00Z' }),
      ],
    });
    renderWithRouter(<EquipmentRequestsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Fulfilled via issuance/)).toBeInTheDocument();
    });
    expect(screen.queryByText('Fulfill')).not.toBeInTheDocument();
  });
});

/**
 * Arriving from the inventory hub's attention queue.
 *
 * Own block, own resets: `vi.clearAllMocks()` clears calls but leaves
 * implementations in place (CLAUDE.md #28). The URL is the fixture here, so
 * it has to be put back or it leaks into whatever runs next.
 */
describe('EquipmentRequestsPage — opened from the attention queue', () => {
  const onPageOne = makeRequest({ id: 'req-1', item_name: 'Gloves' });
  const onPageTwo = makeRequest({ id: 'req-40', item_name: 'Nomex Hood' });
  // 25 rows a page; this request sits at offset 25, i.e. the top of page two.
  const wholeList = [...Array.from({ length: 25 }, (_, i) => makeRequest({ id: `filler-${i}` })), onPageTwo];

  beforeEach(() => {
    mockGetEquipmentRequests.mockReset();
    mockGetFulfillmentOptions.mockReset();
    mockGetFulfillmentOptions.mockResolvedValue(fulfillmentOptions({ can_fulfill_now: false }));
    mockReviewEquipmentRequest.mockReset();
    mockReviewEquipmentRequest.mockResolvedValue({});
    mockToastError.mockReset();
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('opens a request that is already on the page', async () => {
    mockGetEquipmentRequests.mockResolvedValue({ requests: [onPageOne], total: 1, skip: 0, limit: 25 });
    window.history.pushState({}, '', '/inventory/admin/requests?request=req-1');
    renderWithRouter(<EquipmentRequestsPage />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('turns to the page holding a request the first page does not carry', async () => {
    // The queue links any pending request; this page shows 25 at a time, so a
    // linked request can sit on a later page where it would never be found.
    mockGetEquipmentRequests.mockImplementation((params: { skip?: number; limit?: number } = {}) => {
      const skip = params.skip ?? 0;
      const limit = params.limit ?? 25;
      return Promise.resolve({
        requests: wholeList.slice(skip, skip + limit),
        total: wholeList.length,
        skip,
        limit,
      });
    });
    window.history.pushState({}, '', '/inventory/admin/requests?request=req-40');
    renderWithRouter(<EquipmentRequestsPage />);

    // Page two loads, and the hook then opens the record it names.
    expect(await screen.findByText('Nomex Hood')).toBeInTheDocument();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('never asks for more than the endpoint accepts', async () => {
    // `list_equipment_requests` declares `limit=Query(50, ge=1, le=200)`. A
    // single oversized request 422s, the catch swallows it and the ref blocks
    // a second attempt — so for precisely the long queue this scan exists for,
    // the modal never opened.
    const long = [
      ...Array.from({ length: 260 }, (_, i) => makeRequest({ id: `bulk-${i}` })),
      makeRequest({ id: 'req-far', item_name: 'Bunker Coat' }),
    ];
    mockGetEquipmentRequests.mockImplementation((params: { skip?: number; limit?: number } = {}) => {
      const skip = params.skip ?? 0;
      const limit = params.limit ?? 25;
      if (limit > 200) return Promise.reject(new Error('422 limit above maximum'));
      return Promise.resolve({ requests: long.slice(skip, skip + limit), total: long.length, skip, limit });
    });
    window.history.pushState({}, '', '/inventory/admin/requests?request=req-far');
    renderWithRouter(<EquipmentRequestsPage />);

    expect(await screen.findByText('Bunker Coat')).toBeInTheDocument();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(mockToastError).not.toHaveBeenCalled();
    for (const call of mockGetEquipmentRequests.mock.calls) {
      expect((call[0] as { limit?: number } | undefined)?.limit ?? 0).toBeLessThanOrEqual(200);
    }
  });

  it('reports a locator failure rather than silently opening nothing', async () => {
    // Every rejection here is operational: a request that is simply gone comes
    // back as a list not containing it, not as an error. The reader clicked
    // Review expecting something to open.
    // Keyed on the request, not on how many have been made: the page issues
    // its own list loads alongside the locator's, and counting calls made this
    // depend on their interleaving. The locator is the only caller asking for
    // 200 at a time, so that is what identifies it.
    mockGetEquipmentRequests.mockImplementation((params: { limit?: number } = {}) =>
      params.limit === 200
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ requests: [onPageOne], total: 400, skip: 0, limit: 25 })
    );
    window.history.pushState({}, '', '/inventory/admin/requests?request=req-40');
    renderWithRouter(<EquipmentRequestsPage />);

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
  });

  it('leaves the list alone for a request that no longer exists', async () => {
    mockGetEquipmentRequests.mockResolvedValue({ requests: [onPageOne], total: 1, skip: 0, limit: 25 });
    window.history.pushState({}, '', '/inventory/admin/requests?request=gone');
    renderWithRouter(<EquipmentRequestsPage />);
    await screen.findByText('Gloves');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
