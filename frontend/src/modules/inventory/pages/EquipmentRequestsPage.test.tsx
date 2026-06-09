import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    mockGetEquipmentRequests.mockResolvedValue({ requests: [makeRequest()] });
    mockGetItems.mockResolvedValue({ items: [{ id: 'item-9', name: 'Radio XTS 5000', tracking_type: 'individual' }], total: 1, skip: 0, limit: 500 });
  });

  it('renders page title and subtitle', async () => {
    renderWithRouter(<EquipmentRequestsPage />);
    expect(screen.getByText('Equipment Requests')).toBeInTheDocument();
    expect(screen.getByText('Review member requests for equipment')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockGetEquipmentRequests).toHaveBeenCalledWith({ status: 'pending' });
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
    expect(screen.getByText('checkout')).toBeInTheDocument();
    expect(screen.getByText(/John Doe/)).toBeInTheDocument();
    expect(screen.getByText(/Need for shift/)).toBeInTheDocument();
  });

  it('shows empty state when no requests', async () => {
    mockGetEquipmentRequests.mockResolvedValue({ requests: [] });
    renderWithRouter(<EquipmentRequestsPage />);
    await waitFor(() => {
      expect(screen.getByText('No Requests')).toBeInTheDocument();
    });
  });

  it('filters requests by status', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EquipmentRequestsPage />);
    await waitFor(() => {
      expect(mockGetEquipmentRequests).toHaveBeenCalledWith({ status: 'pending' });
    });
    const select = screen.getByLabelText('Filter by status');
    await user.selectOptions(select, 'approved');
    await waitFor(() => {
      expect(mockGetEquipmentRequests).toHaveBeenCalledWith({ status: 'approved' });
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
    await waitFor(() => {
      expect(screen.getByText('Approve')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Approve'));
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
    await user.click(await screen.findByText('Approve'));
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
      requests: [makeRequest({ status: 'approved', request_type: 'issuance', item_id: 'item-9', quantity: 2 })],
    });
    mockFulfillEquipmentRequest.mockResolvedValue({ id: 'req-1', status: 'fulfilled', fulfillment_type: 'issuance', fulfillment_reference_id: 'iss-1', message: 'ok' });
    renderWithRouter(<EquipmentRequestsPage />);
    await waitFor(() => {
      expect(screen.getByText('Radio XTS 5000')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Fulfill'));
    // Modal pre-fills the request's item and quantity
    await user.click(await screen.findByRole('button', { name: /Fulfill Request/ }));
    await waitFor(() => {
      expect(mockFulfillEquipmentRequest).toHaveBeenCalledWith('req-1', {
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
      requests: [makeRequest({ status: 'fulfilled', fulfillment_type: 'issuance', fulfilled_at: '2026-01-16T10:00:00Z' })],
    });
    renderWithRouter(<EquipmentRequestsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Fulfilled via issuance/)).toBeInTheDocument();
    });
    expect(screen.queryByText('Fulfill')).not.toBeInTheDocument();
  });
});
