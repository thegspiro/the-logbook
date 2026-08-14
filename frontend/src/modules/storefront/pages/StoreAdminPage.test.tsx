import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mockGetDashboard = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: { getDashboard: (...args: unknown[]) => mockGetDashboard(...args) as unknown },
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../components/StoreCatalogTab', () => ({ StoreCatalogTab: () => null }));
vi.mock('../components/StorePaymentsTab', () => ({ StorePaymentsTab: () => null }));
vi.mock('../components/StoreSettingsTab', () => ({ StoreSettingsTab: () => null }));
vi.mock('../components/StoreWindowsTab', () => ({ StoreWindowsTab: () => null }));
vi.mock('../components/StoreOrdersTab', () => ({
  StoreOrdersTab: ({
    initialStatusFilter,
    initialOrderId,
    initialSubmittedWithinHours,
    initialOpenOnly,
  }: {
    initialStatusFilter?: string;
    initialOrderId?: string;
    initialSubmittedWithinHours?: number;
    initialOpenOnly?: boolean;
  }) => (
    <div>
      Orders filter: {initialStatusFilter || 'all'}; detail: {initialOrderId || 'none'}; recent:{' '}
      {initialSubmittedWithinHours ?? 'none'}; open: {initialOpenOnly ? 'yes' : 'no'}
    </div>
  ),
}));

import StoreAdminPage from './StoreAdminPage';

const dashboard = {
  isEnabled: true,
  activeWindow: null,
  newOrderCount: 3,
  openOrderCount: 6,
  awaitingPaymentCount: 2,
  pendingVerificationCount: 1,
  readyForPickupCount: 1,
  outstandingBalance: '40.00',
  collectedThisWindow: '120.00',
  activeProductCount: 4,
  statusCounts: {
    submitted: 0,
    awaiting_payment: 2,
    paid: 2,
    ordered: 1,
    ready_for_pickup: 1,
    fulfilled: 5,
    cancelled: 1,
  },
  recentActivity: [
    {
      id: 'event-1',
      orderId: 'order-1',
      orderNumber: 'ORD-2026-0001',
      customerName: 'A. Member',
      eventType: 'status_changed',
      toStatus: 'ordered',
      createdAt: '2026-08-14T10:00:00Z',
    },
    {
      id: 'event-2',
      orderId: 'order-2',
      orderNumber: 'ORD-2026-0002',
      customerName: 'B. Member',
      eventType: 'payment_reported',
      createdAt: '2026-08-12T10:00:00Z',
    },
  ],
  recentOrders: [],
};

describe('StoreAdminPage overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDashboard.mockResolvedValue(dashboard);
  });

  it('shows new-order and workflow counts from the dashboard', async () => {
    render(<StoreAdminPage />, { wrapper: MemoryRouter });

    expect(await screen.findByText('New (24 hours)')).toBeInTheDocument();
    expect(screen.getByText('Updates from the last 7 days')).toBeInTheDocument();
    expect(screen.getByText('Status changed to Ordered from vendor')).toBeInTheDocument();
    const newest = screen.getByText(/ORD-2026-0001/);
    const older = screen.getByText(/ORD-2026-0002/);
    expect(newest.compareDocumentPosition(older)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole('button', { name: /ready for pickup 1/i })).toBeInTheDocument();
  });

  it('opens the corresponding status queue from the workflow', async () => {
    const user = userEvent.setup();
    render(<StoreAdminPage />, { wrapper: MemoryRouter });
    await screen.findByText('Order workflow');

    await user.click(screen.getByRole('button', { name: /ordered from vendor1/i }));

    expect(await screen.findByText(/Orders filter: ordered/)).toBeInTheDocument();
  });

  it('opens the exact order selected from weekly activity', async () => {
    const user = userEvent.setup();
    render(<StoreAdminPage />, { wrapper: MemoryRouter });
    await screen.findByText('Updates from the last 7 days');

    const openOrderButtons = screen.getAllByRole('button', { name: 'Open order' });
    expect(openOrderButtons).toHaveLength(2);
    await user.click(openOrderButtons[0] as HTMLElement);

    expect(await screen.findByText(/detail: order-1/)).toBeInTheDocument();
  });

  it('opens the new-order tile as a 24-hour queue', async () => {
    const user = userEvent.setup();
    render(<StoreAdminPage />, { wrapper: MemoryRouter });

    await user.click(await screen.findByRole('button', { name: /new \(24 hours\) 3/i }));

    expect(await screen.findByText(/recent: 24/)).toBeInTheDocument();
  });

  it('opens the open-order tile without closed orders', async () => {
    const user = userEvent.setup();
    render(<StoreAdminPage />, { wrapper: MemoryRouter });

    await user.click(await screen.findByRole('button', { name: /open orders 6/i }));

    expect(await screen.findByText(/open: yes/)).toBeInTheDocument();
  });
});
