import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPreviewNotification = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: {
    previewNotification: (...args: unknown[]) => mockPreviewNotification(...args) as unknown,
  },
}));

import { NotificationPreviewModal } from './NotificationPreviewModal';

const preview = (overrides: Record<string, unknown> = {}) => ({
  notice: 'order_confirmation',
  label: 'Order confirmation',
  setting: 'sendOrderConfirmation',
  audience: 'The member who ordered',
  alsoGoverns: [],
  enabled: true,
  subject: 'Order ORD-2026-0042 received',
  htmlBody: '<html><body><h1>Order Confirmation</h1><p>Balance due: $53.00</p></body></html>',
  textBody: 'Order ORD-2026-0042 received.',
  ...overrides,
});

describe('NotificationPreviewModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreviewNotification.mockResolvedValue(preview());
  });

  it('asks the backend to render the notice it was given', async () => {
    render(<NotificationPreviewModal notice="window_closed" onClose={vi.fn()} />);
    await screen.findByText(/ORD-2026-0042 received/);
    expect(mockPreviewNotification).toHaveBeenCalledWith('window_closed');
  });

  it('shows the subject line and who receives it', async () => {
    render(<NotificationPreviewModal notice="order_confirmation" onClose={vi.fn()} />);

    expect(await screen.findByText('Order ORD-2026-0042 received')).toBeInTheDocument();
    expect(screen.getByText(/The member who ordered/)).toBeInTheDocument();
  });

  it('renders the body in an iframe rather than into the page', async () => {
    /* Email HTML brings its own layout; injected inline it would both break
       and let template markup reach the admin screen. */
    render(<NotificationPreviewModal notice="order_confirmation" onClose={vi.fn()} />);
    await screen.findByText('Order ORD-2026-0042 received');

    const frame = screen.getByTitle('Order confirmation preview');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('sandbox', '');
    // The body text lives inside the frame, not in the surrounding document.
    expect(screen.queryByRole('heading', { name: 'Order Confirmation' })).toBeNull();
  });

  it('warns when the notice being previewed is switched off', async () => {
    mockPreviewNotification.mockResolvedValue(preview({ enabled: false }));
    render(<NotificationPreviewModal notice="order_confirmation" onClose={vi.fn()} />);

    expect(await screen.findByText(/currently switched off/)).toBeInTheDocument();
  });

  it('names the other emails the same switch controls', async () => {
    mockPreviewNotification.mockResolvedValue(
      preview({ alsoGoverns: ['Waived balances', 'Refunds'] }),
    );
    render(<NotificationPreviewModal notice="payment_receipt" onClose={vi.fn()} />);

    expect(await screen.findByText(/Waived balances, Refunds/)).toBeInTheDocument();
  });

  it('can switch to phone width', async () => {
    const user = userEvent.setup();
    render(<NotificationPreviewModal notice="order_confirmation" onClose={vi.fn()} />);
    await screen.findByText('Order ORD-2026-0042 received');

    await user.click(screen.getByRole('button', { name: /phone width/i }));
    expect(screen.getByTitle('Order confirmation preview')).toHaveStyle({ width: '390px' });
  });

  it('reports a failure instead of showing an empty frame', async () => {
    mockPreviewNotification.mockRejectedValue(new Error('boom'));
    render(<NotificationPreviewModal notice="order_confirmation" onClose={vi.fn()} />);

    expect(await screen.findByText(/Could not render that notice|boom/)).toBeInTheDocument();
  });
});
