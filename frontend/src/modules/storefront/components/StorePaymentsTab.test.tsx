import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockListPaymentEvents = vi.fn();
const mockApplyPaymentEvent = vi.fn();
const mockIgnorePaymentEvent = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: {
    listPaymentEvents: (...args: unknown[]) => mockListPaymentEvents(...args) as unknown,
    applyPaymentEvent: (...args: unknown[]) => mockApplyPaymentEvent(...args) as unknown,
    ignorePaymentEvent: (...args: unknown[]) => mockIgnorePaymentEvent(...args) as unknown,
  },
}));

const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => mockToastError(...args) as unknown },
}));

import { StorePaymentsTab } from './StorePaymentsTab';

const event = (overrides: Record<string, unknown> = {}) => ({
  id: 'pe1',
  provider: 'paypal',
  externalId: 'CAP-123',
  amount: '45.00',
  currency: 'USD',
  payerName: 'Pat Member',
  payerEmail: 'pat@example.org',
  reference: 'ORD-2026-0001',
  status: 'matched',
  note: null,
  matchedOrderId: 'o1',
  matchedOrderNumber: 'ORD-2026-0001',
  matchedOrderMember: 'Pat Member',
  matchedOrderBalance: '45.00',
  receivedAt: '2026-08-01T12:00:00Z',
  resolvedAt: null,
  ...overrides,
});

describe('StorePaymentsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPaymentEvents.mockResolvedValue({ items: [event()], unresolvedCount: 1 });
    mockApplyPaymentEvent.mockResolvedValue(event({ status: 'applied' }));
    mockIgnorePaymentEvent.mockResolvedValue(event({ status: 'ignored' }));
  });

  it('loads the unresolved queue by default', async () => {
    render(<StorePaymentsTab onChanged={vi.fn()} />);

    await waitFor(() => {
      expect(mockListPaymentEvents).toHaveBeenCalledWith({ unresolvedOnly: true });
    });
    expect(await screen.findByText('ORD-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('1 payment needs review.')).toBeInTheDocument();
  });

  it('shows resolved payments when asked', async () => {
    const user = userEvent.setup();
    render(<StorePaymentsTab onChanged={vi.fn()} />);
    await screen.findByText('ORD-2026-0001');

    await user.click(screen.getByLabelText('Show resolved'));

    await waitFor(() => {
      expect(mockListPaymentEvents).toHaveBeenCalledWith({ unresolvedOnly: false });
    });
  });

  it('applies a matched payment without asking for an order', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<StorePaymentsTab onChanged={onChanged} />);

    await user.click(await screen.findByRole('button', { name: /Apply to order/ }));

    await waitFor(() => {
      expect(mockApplyPaymentEvent).toHaveBeenCalledWith('pe1', undefined);
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('refuses to apply an unmatched payment with no order given', async () => {
    mockListPaymentEvents.mockResolvedValue({
      items: [event({ status: 'unmatched', matchedOrderId: null, matchedOrderNumber: null })],
      unresolvedCount: 1,
    });
    const user = userEvent.setup();
    render(<StorePaymentsTab onChanged={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Apply to order/ }));

    expect(mockApplyPaymentEvent).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith('Enter the order ID this payment belongs to');
  });

  it('applies an unmatched payment to the order an admin names', async () => {
    mockListPaymentEvents.mockResolvedValue({
      items: [event({ status: 'unmatched', matchedOrderId: null, matchedOrderNumber: null })],
      unresolvedCount: 1,
    });
    const user = userEvent.setup();
    render(<StorePaymentsTab onChanged={vi.fn()} />);

    await user.type(await screen.findByPlaceholderText('Order ID to credit'), 'order-42');
    await user.click(screen.getByRole('button', { name: /Apply to order/ }));

    await waitFor(() => {
      expect(mockApplyPaymentEvent).toHaveBeenCalledWith('pe1', 'order-42');
    });
  });

  it('dismisses a payment', async () => {
    const user = userEvent.setup();
    render(<StorePaymentsTab onChanged={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Dismiss/ }));

    await waitFor(() => {
      expect(mockIgnorePaymentEvent).toHaveBeenCalledWith('pe1');
    });
  });

  it('offers no actions on an already-applied payment', async () => {
    mockListPaymentEvents.mockResolvedValue({
      items: [event({ status: 'applied', resolvedAt: '2026-08-01T12:05:00Z' })],
      unresolvedCount: 0,
    });
    render(<StorePaymentsTab onChanged={vi.fn()} />);

    expect(await screen.findByText('Applied')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Apply to order/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dismiss/ })).not.toBeInTheDocument();
    expect(screen.getByText('Nothing is waiting on you.')).toBeInTheDocument();
  });

  it('shows an empty state when nothing has come in', async () => {
    mockListPaymentEvents.mockResolvedValue({ items: [], unresolvedCount: 0 });
    render(<StorePaymentsTab onChanged={vi.fn()} />);

    expect(await screen.findByText('No payments to review')).toBeInTheDocument();
  });

  it('surfaces a load failure instead of rendering an empty queue silently', async () => {
    mockListPaymentEvents.mockRejectedValue(new Error('boom'));
    render(<StorePaymentsTab onChanged={vi.fn()} />);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledTimes(1);
    });
  });
});
