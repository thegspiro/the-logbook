import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: {
    getSettings: (...args: unknown[]) => mockGetSettings(...args) as unknown,
    updateSettings: (...args: unknown[]) => mockUpdateSettings(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { StoreSettingsTab } from './StoreSettingsTab';

const settings = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  organizationId: 'org1',
  isEnabled: true,
  storeName: 'Department Store',
  currency: 'USD',
  acceptedPaymentMethods: ['cash'],
  paymentPolicy: 'none',
  taxRate: '0',
  allowPickup: true,
  allowShipping: false,
  notifyEmails: [],
  notifyAdminsOnOrder: true,
  sendOrderConfirmation: true,
  sendStatusUpdates: true,
  sendPaymentReminders: true,
  sendPaymentReceipts: true,
  sendWindowOpened: true,
  sendWindowClosingReminder: true,
  sendWindowClosed: true,
  sendVendorOrderUpdates: true,
  paymentReminderDays: 3,
  windowReminderHours: 48,
  ...overrides,
});

/**
 * The settings screen is where a quartermaster answers "what does this store
 * email people?". These guard that the list is complete — every notice the
 * backend can send has a switch here — and that unticking one actually
 * reaches the API rather than only changing the checkbox.
 */
describe('StoreSettingsTab notification switches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue(settings());
    mockUpdateSettings.mockResolvedValue(settings());
  });

  it('lists every notice the store can send', async () => {
    render(<StoreSettingsTab onChanged={vi.fn()} />);
    await screen.findByText('Notifications');

    for (const label of [
      'Order confirmation',
      'Status changes',
      'Payment receipts',
      'Payment reminders',
      'New order alert',
      'Ordering is open',
      'Last call',
      'Ordering has closed',
      'Order placed with the vendor',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('says who receives each notice, not just its name', async () => {
    render(<StoreSettingsTab onChanged={vi.fn()} />);
    await screen.findByText('Notifications');

    // The one a quartermaster most often gets wrong: unticking "Status
    // changes" also stops the cancellation email.
    expect(screen.getByText(/becomes ordered, ready for pickup, picked up, or cancelled/)).toBeInTheDocument();
    expect(screen.getByText(/when you record the vendor order/)).toBeInTheDocument();
  });

  it('reflects a notice that is switched off', async () => {
    mockGetSettings.mockResolvedValue(settings({ sendWindowOpened: false }));
    render(<StoreSettingsTab onChanged={vi.fn()} />);

    const opened = await screen.findByLabelText(/Ordering is open/);
    expect(opened).not.toBeChecked();
    expect(screen.getByLabelText(/Ordering has closed/)).toBeChecked();
  });

  it('sends the switch it changed to the API', async () => {
    const user = userEvent.setup();
    render(<StoreSettingsTab onChanged={vi.fn()} />);

    const vendor = await screen.findByLabelText(/Order placed with the vendor/);
    await user.click(vendor);
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(mockUpdateSettings).toHaveBeenCalledWith(
        // The rest travel unchanged — a partial update must not silently reset them.
        expect.objectContaining({
          sendVendorOrderUpdates: false,
          sendWindowOpened: true,
          sendWindowClosed: true,
          sendWindowClosingReminder: true,
          sendPaymentReceipts: true,
        }),
      ),
    );
  });
});
