import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mockGetDashboard = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: { getDashboard: (...args: unknown[]) => mockGetDashboard(...args) as unknown },
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));
// The page renders through AdminHubFrame now, which fetches the store's
// metrics row and attention queue. Stubbed rather than left to reject: the
// frame degrades quietly on failure, which would hide a real regression here.
const mockGetAdminHubSummary = vi.fn();
vi.mock('../../../services/adminHubService', () => ({
  adminHubService: { getSummary: (...args: unknown[]) => mockGetAdminHubSummary(...args) as unknown },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../components/StoreCatalogTab', () => ({ StoreCatalogTab: () => null }));
vi.mock('../components/StorePaymentsTab', () => ({ StorePaymentsTab: () => null }));
vi.mock('../components/StoreSettingsTab', () => ({ StoreSettingsTab: () => null }));
vi.mock('../../../components/admin/AdminMetricsSettings', () => ({
  __esModule: true,
  default: () => <div>metrics-settings</div>,
  AdminMetricsSettings: () => <div>metrics-settings</div>,
}));
vi.mock('../components/StoreWindowsTab', () => ({ StoreWindowsTab: () => null }));
vi.mock('../components/StoreOrdersTab', () => ({
  StoreOrdersTab: ({
    initialStatusFilter,
    initialPaymentFilter,
    initialOrderId,
    initialSubmittedWithinHours,
    initialOpenOnly,
  }: {
    initialStatusFilter?: string;
    initialPaymentFilter?: string;
    initialOrderId?: string;
    initialSubmittedWithinHours?: number;
    initialOpenOnly?: boolean;
  }) => (
    <div>
      Orders filter: {initialStatusFilter || 'all'}; payment: {initialPaymentFilter || 'all'}; detail:{' '}
      {initialOrderId || 'none'}; recent: {initialSubmittedWithinHours ?? 'none'}; open:{' '}
      {initialOpenOnly ? 'yes' : 'no'}
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
    mockGetAdminHubSummary.mockResolvedValue({
      moduleKey: 'storefront',
      generatedAt: '2026-09-01T12:00:00Z',
      timezone: 'UTC',
      metrics: [],
      attention: [],
    });
  });

  it('shows new-order and workflow counts from the dashboard', async () => {
    render(<StoreAdminPage />, { wrapper: MemoryRouter });

    expect(await screen.findByText('New (24 hours)')).toBeInTheDocument();
    expect(screen.getByText('Updates from the last 7 days')).toBeInTheDocument();
    expect(screen.getByText('Status changed to Ordered from vendor')).toBeInTheDocument();
    const newest = screen.getByText(/ORD-2026-0001/);
    const older = screen.getByText(/ORD-2026-0002/);
    expect(newest.compareDocumentPosition(older)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // The workflow grid, not a stat tile: the tiles restating a frame metric
    // left this page when it adopted the shared admin frame.
    expect(screen.getByRole('button', { name: /ready for pickup1/i })).toBeInTheDocument();
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

  it('filters to open orders from the workflow header', async () => {
    // The Orders tab can clear this filter but has no control to set it, so
    // the entry point has to exist somewhere on the overview.
    const user = userEvent.setup();
    render(<StoreAdminPage />, { wrapper: MemoryRouter });
    await screen.findByText('Order workflow');

    await user.click(screen.getByRole('button', { name: 'Open only' }));

    expect(await screen.findByText(/open: yes/)).toBeInTheDocument();
  });
});

/**
 * The tab bar, now that the console lives inside Inventory Administration.
 *
 * Own block, own resets: `vi.clearAllMocks()` clears calls but leaves
 * implementations in place, so a block that configures nothing runs on
 * whatever its neighbour left behind (CLAUDE.md #28).
 */
describe('StoreAdminPage — tabs in the URL', () => {
  beforeEach(() => {
    mockGetDashboard.mockReset();
    mockGetDashboard.mockResolvedValue(dashboard);
    mockGetAdminHubSummary.mockReset();
    mockGetAdminHubSummary.mockResolvedValue({
      moduleKey: 'storefront',
      generatedAt: '2026-09-01T12:00:00Z',
      timezone: 'UTC',
      metrics: [],
      attention: [],
    });
  });

  const renderAt = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <StoreAdminPage />
      </MemoryRouter>
    );

  it('opens on the overview with no parameter', async () => {
    renderAt('/inventory/admin/store');

    expect(await screen.findByText('Order workflow')).toBeInTheDocument();
  });

  it('opens the tab a link names, so the hub can point at one', async () => {
    renderAt('/inventory/admin/store?tab=orders');

    expect(await screen.findByText(/Orders filter: all/)).toBeInTheDocument();
    expect(screen.queryByText('Order workflow')).not.toBeInTheDocument();
  });

  it('carries the attention queue\u2019s payment filter in from the URL', async () => {
    // The frame's "Verify payments" row links in from outside the page, so its
    // filter cannot be the local state the overview's own hand-offs use. Landing
    // on an unfiltered list leaves the counted work to be found by eye.
    renderAt('/inventory/admin/store?tab=orders&payment=pending_verification');

    expect(await screen.findByText(/payment: pending_verification/)).toBeInTheDocument();
  });

  it('ignores a payment filter the Orders tab does not offer', async () => {
    renderAt('/inventory/admin/store?tab=orders&payment=not-a-status');

    expect(await screen.findByText(/payment: all/)).toBeInTheDocument();
  });

  it('does not mistake an inherited property for a payment status', async () => {
    // `'toString' in PAYMENT_STATUS_LABELS` is true via Object.prototype, and
    // the value would then be forwarded to the API as a payment_status that
    // matches nothing — an empty list instead of the documented fallback.
    renderAt('/inventory/admin/store?tab=orders&payment=toString');

    expect(await screen.findByText(/payment: all/)).toBeInTheDocument();
  });

  it('falls back to the overview for a tab that does not exist', async () => {
    renderAt('/inventory/admin/store?tab=not-a-tab');

    expect(await screen.findByText('Order workflow')).toBeInTheDocument();
  });

  it('puts the chosen tab in the URL', async () => {
    const user = userEvent.setup();
    renderAt('/inventory/admin/store');
    await screen.findByText('Order workflow');

    await user.click(screen.getByRole('tab', { name: 'Payments' }));

    // The frame owns the tab bar; selecting one is what writes ?tab=, which is
    // what makes a deep link possible in the first place.
    expect(screen.getByRole('tab', { name: 'Payments' })).toHaveAttribute('aria-selected', 'true');
  });

  it('offers the headline-metric picker on the settings tab', async () => {
    // The store's registry defines six metrics and defaults to three, so
    // without this control an admin can never reach the other three — every
    // other module's admin page carries the same one.
    const user = userEvent.setup();
    renderAt('/inventory/admin/store');
    await screen.findByText('Order workflow');

    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    expect(await screen.findByText('metrics-settings')).toBeInTheDocument();
  });

  it('keeps the overview hand-off into a pre-filtered Orders tab', async () => {
    // Five local filters plus a remount key seed StoreOrdersTab when a status
    // is clicked. Moving the tab into the URL is the easiest way to break that
    // silently, so it is asserted end to end.
    const user = userEvent.setup();
    renderAt('/inventory/admin/store');
    await screen.findByText('Order workflow');

    await user.click(screen.getByRole('button', { name: /ordered from vendor1/i }));

    expect(await screen.findByText(/Orders filter: ordered/)).toBeInTheDocument();
  });
});
