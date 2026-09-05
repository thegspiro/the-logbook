import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockGetEquipmentRequests = vi.fn();
const mockReviewEquipmentRequest = vi.fn();
const mockFulfillEquipmentRequest = vi.fn();
const mockGetItems = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getEquipmentRequests: (...args: unknown[]) => mockGetEquipmentRequests(...args) as unknown,
    reviewEquipmentRequest: (...args: unknown[]) => mockReviewEquipmentRequest(...args) as unknown,
    fulfillEquipmentRequest: (...args: unknown[]) => mockFulfillEquipmentRequest(...args) as unknown,
    getItems: (...args: unknown[]) => mockGetItems(...args) as unknown,
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

describe('EquipmentRequestsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [makeRequest()], total: 1, skip: 0, limit: 25 });
    mockGetItems.mockResolvedValue({
      items: [{ id: 'item-9', name: 'Radio XTS 5000', tracking_type: 'individual' }],
      total: 1,
      skip: 0,
      limit: 500,
    });
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

  /** A pool variant row as `create_size_variants` names it: "base — Size". */
  const variant = (id: string, size: string, overrides: Record<string, unknown> = {}) => ({
    id,
    name: `Polo — ${size.toUpperCase()}`,
    category_id: 'cat-1',
    tracking_type: 'pool',
    quantity: 6,
    status: 'available',
    condition: 'good',
    standard_size: size,
    ...overrides,
  });

  const poloRequest = (overrides: Record<string, unknown> = {}) =>
    makeRequest({
      item_name: 'Polo',
      status: 'approved',
      category_id: 'cat-1',
      requested_size: 'l',
      ...overrides,
    });

  it('preselects the stocked variant matching the size the member asked for', async () => {
    const user = userEvent.setup();
    // No item_id: the member asked for a size the catalog had nothing in when
    // the request was filed, so the picker has to find the variant itself.
    mockGetEquipmentRequests.mockResolvedValue({ requests: [poloRequest()] });
    mockGetItems.mockResolvedValue({ items: [variant('polo-m', 'm'), variant('polo-l', 'l')], total: 2 });
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Polo')).toBeInTheDocument();

    await user.click(screen.getByText('Fulfill'));

    expect(await screen.findByLabelText('Item to fulfill with')).toHaveValue('polo-l');
    // Pool stock is refused unless the method is issuance, so the automatic
    // selection has to move the method with it.
    expect(screen.getByLabelText('Final fulfillment method')).toHaveValue('issuance');
  });

  it('never preselects a different product that happens to share the size', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [poloRequest()] });
    // Same category, same size, different garment. Choosing this for the
    // member would issue trousers against a shirt request, and the backend
    // waives the substitution justification because the category matches.
    mockGetItems.mockResolvedValue({
      items: [variant('trousers-l', 'l', { name: 'Duty Trousers — L' })],
      total: 1,
    });
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Polo')).toBeInTheDocument();

    await user.click(screen.getByText('Fulfill'));

    expect(await screen.findByLabelText('Item to fulfill with')).toHaveValue('');
  });

  it('does not preselect a variant that cannot cover the requested quantity', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [poloRequest({ quantity: 6 })] });
    mockGetItems.mockResolvedValue({ items: [variant('polo-l', 'l', { quantity: 1 })], total: 1 });
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Polo')).toBeInTheDocument();

    await user.click(screen.getByText('Fulfill'));

    // The dialog pre-fills the full six, so selecting the single unit would
    // submit a fulfilment that fails on insufficient stock.
    expect(await screen.findByLabelText('Item to fulfill with')).toHaveValue('');
  });

  it('matches a custom-sized row on its real size, not the sentinel', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [poloRequest({ requested_size: '34W' })] });
    mockGetItems.mockResolvedValue({
      items: [variant('polo-34w', 'custom', { name: 'Polo — 34W', size: '34W' })],
      total: 1,
    });
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Polo')).toBeInTheDocument();

    await user.click(screen.getByText('Fulfill'));

    // `standard_size: 'custom'` means "the real size is in `size`" — comparing
    // the sentinel makes a legitimately sized row unmatchable.
    expect(await screen.findByLabelText('Item to fulfill with')).toHaveValue('polo-34w');
  });

  it('folds size spellings together when matching', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [poloRequest({ requested_size: 'Large' })] });
    mockGetItems.mockResolvedValue({ items: [variant('polo-l', 'l')], total: 1 });
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Polo')).toBeInTheDocument();

    await user.click(screen.getByText('Fulfill'));

    // A member who recorded "Large" and stock filed as "l" are the same size.
    expect(await screen.findByLabelText('Item to fulfill with')).toHaveValue('polo-l');
  });

  it('says so when nothing on hand is the requested size', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({
      requests: [makeRequest({ status: 'approved', category_id: 'cat-1', requested_size: 'xxl' })],
    });
    mockGetItems.mockResolvedValue({
      items: [
        {
          id: 'polo-m',
          name: 'Polo',
          category_id: 'cat-1',
          tracking_type: 'pool',
          quantity: 6,
          status: 'available',
          condition: 'good',
          standard_size: 'm',
        },
      ],
      total: 1,
    });
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Radio XTS 5000')).toBeInTheDocument();

    await user.click(screen.getByText('Fulfill'));

    // Every option is a different size, so issuing one silently changes what
    // the member receives unless the screen says otherwise.
    expect(await screen.findByText(/Nothing on hand is size/)).toBeInTheDocument();
  });

  it('does not warn about the size before availability has been queried', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [poloRequest({ requested_size: 'xxl' })] });
    let releaseItems: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      releaseItems = resolve;
    });
    mockGetItems.mockReset();
    mockGetItems.mockImplementation(async () => {
      await pending;
      return { items: [variant('polo-xxl', 'xxl')], total: 1 };
    });
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findByText('Polo')).toBeInTheDocument();

    await user.click(screen.getByText('Fulfill'));

    // The stock is there; it just has not arrived yet. Announcing a shortage
    // now can send a quartermaster off to order gear that already exists.
    expect(screen.queryByText(/Nothing on hand is size/)).not.toBeInTheDocument();

    releaseItems(null);
    expect(await screen.findByLabelText('Item to fulfill with')).toHaveValue('polo-xxl');
    expect(screen.queryByText(/Nothing on hand is size/)).not.toBeInTheDocument();
  });

  it('ignores a stale item load from a dialog that has been closed', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({
      requests: [poloRequest({ id: 'req-a', requested_size: 'm' }), poloRequest({ id: 'req-b', requested_size: 'l' })],
    });
    let releaseFirst: (value: unknown) => void = () => {};
    const first = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const catalog = { items: [variant('polo-m', 'm'), variant('polo-l', 'l')], total: 2 };
    mockGetItems.mockReset();
    mockGetItems
      .mockImplementationOnce(async () => {
        await first;
        return catalog;
      })
      .mockResolvedValue(catalog);
    renderWithRouter(<EquipmentRequestsPage />);
    expect(await screen.findAllByText('Polo')).toHaveLength(2);

    // Open request A (size M), close it, open request B (size L) — all before
    // A's item query lands.
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

  it('does not count quarantined stock as available to fulfil', async () => {
    const user = userEvent.setup();
    mockGetEquipmentRequests.mockResolvedValue({
      requests: [makeRequest({ status: 'pending', category_id: 'cat-1' })],
    });
    mockGetItems.mockResolvedValue({
      items: [
        {
          id: 'gloves',
          name: 'Gloves',
          category_id: 'cat-1',
          tracking_type: 'pool',
          quantity: 12,
          status: 'in_maintenance',
          condition: 'good',
        },
      ],
      total: 1,
    });
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
    mockGetItems.mockReset();
    mockGetItems.mockResolvedValue({ items: [], total: 0 });
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
