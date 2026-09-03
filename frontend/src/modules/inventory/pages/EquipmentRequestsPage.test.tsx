import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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

  it('leaves the list alone for a request that no longer exists', async () => {
    mockGetEquipmentRequests.mockResolvedValue({ requests: [onPageOne], total: 1, skip: 0, limit: 25 });
    window.history.pushState({}, '', '/inventory/admin/requests?request=gone');
    renderWithRouter(<EquipmentRequestsPage />);
    await screen.findByText('Gloves');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
