import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: {
    getSettings: (...args: unknown[]) => mockGetSettings(...args) as unknown,
    updateSettings: (...args: unknown[]) => mockUpdateSettings(...args) as unknown,
    previewNotification: vi.fn(),
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
  showOpenOrderBanner: true,
  acceptedPaymentMethods: ['paypal'],
  paymentPolicy: 'none',
  paypalMeUrl: 'https://paypal.me/auxiliary',
  paypalEmail: null,
  paypalUseConnected: false,
  connectedPaypal: null,
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

const connected = {
  paypalMeUrl: 'https://paypal.me/oakvillefd',
  accountEmail: 'treasurer@oakvillefd.org',
};

/**
 * The store's PayPal button can use the connected PayPal integration's link
 * and email, or an account entered on the store. These guard that the choice
 * reaches the API, and that the screen says what the button will actually do
 * in each case, including the fallback when the connected account cannot
 * supply a link.
 */
describe('StoreSettingsTab PayPal account', () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockUpdateSettings.mockReset();
    mockGetSettings.mockResolvedValue(settings());
    mockUpdateSettings.mockImplementation((payload: Record<string, unknown>) =>
      Promise.resolve(settings({ ...payload, connectedPaypal: connected }))
    );
  });

  it('saves the choice to use the connected account', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(settings({ connectedPaypal: connected }));
    render(<StoreSettingsTab onChanged={vi.fn()} />);

    await user.click(await screen.findByRole('radio', { name: 'The connected PayPal account' }));
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ paypalUseConnected: true }))
    );
  });

  it('names the connected link and email when the store uses them', async () => {
    mockGetSettings.mockResolvedValue(settings({ paypalUseConnected: true, connectedPaypal: connected }));
    render(<StoreSettingsTab onChanged={vi.fn()} />);

    const note = await screen.findByTestId('paypal-account-note');
    expect(note).toHaveTextContent(
      'Members are sent to https://paypal.me/oakvillefd · treasurer@oakvillefd.org. Payments to it are matched to orders automatically.'
    );
    expect(screen.getByLabelText('Fallback PayPal.Me link')).toHaveValue('https://paypal.me/auxiliary');
  });

  it('says members get the fallback when PayPal is not connected', async () => {
    mockGetSettings.mockResolvedValue(settings({ paypalUseConnected: true, connectedPaypal: null }));
    render(<StoreSettingsTab onChanged={vi.fn()} />);

    expect(await screen.findByTestId('paypal-account-note')).toHaveTextContent(
      'PayPal is not connected on the Integrations page. Until it is, members are sent to the fallback link and email below.'
    );
  });

  it('says members get the fallback when the connected account has no link or email', async () => {
    mockGetSettings.mockResolvedValue(
      settings({ paypalUseConnected: true, connectedPaypal: { paypalMeUrl: null, accountEmail: null } })
    );
    render(<StoreSettingsTab onChanged={vi.fn()} />);

    expect(await screen.findByTestId('paypal-account-note')).toHaveTextContent(
      'The connected PayPal account has no PayPal.Me link or email yet.'
    );
  });

  it('warns that another account is not reconciled while PayPal is connected', async () => {
    mockGetSettings.mockResolvedValue(settings({ paypalUseConnected: false, connectedPaypal: connected }));
    render(<StoreSettingsTab onChanged={vi.fn()} />);

    expect(await screen.findByTestId('paypal-account-note')).toHaveTextContent(
      'Payments to an account other than the connected one are not matched to orders automatically'
    );
    expect(screen.getByLabelText('PayPal.Me link')).toHaveValue('https://paypal.me/auxiliary');
  });

  it('shows no note for a store entering its own account with PayPal not connected', async () => {
    render(<StoreSettingsTab onChanged={vi.fn()} />);

    await screen.findByLabelText('PayPal.Me link');
    expect(screen.queryByTestId('paypal-account-note')).not.toBeInTheDocument();
  });
});
