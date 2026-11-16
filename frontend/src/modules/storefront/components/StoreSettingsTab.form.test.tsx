/**
 * Store settings as a form (forms review batch 21): a value outside what the
 * server accepts is named on its field before anything is sent, a refusal
 * lands on the field it names, and either holds the whole save back — these
 * settings carry the payment configuration, so half of them is not saved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { StoreSettingsTab } from './StoreSettingsTab';

const settings = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  organizationId: 'org1',
  isEnabled: true,
  storeName: 'Department Store',
  currency: 'USD',
  showOpenOrderBanner: true,
  acceptedPaymentMethods: ['venmo'],
  paymentPolicy: 'none',
  venmoHandle: '@dept',
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

describe('StoreSettingsTab — the settings form', () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockUpdateSettings.mockReset();
    mockGetSettings.mockResolvedValue(settings());
    mockUpdateSettings.mockImplementation((payload: Record<string, unknown>) => Promise.resolve(settings(payload)));
  });

  // Forms review F-3: a reminder of 120 days went to the server and came back
  // as a toast that named no field.
  it('names an out-of-range reminder on its field, lists it at the top, and saves nothing', async () => {
    const user = userEvent.setup();
    render(<StoreSettingsTab onChanged={vi.fn()} />);
    const days = await screen.findByRole('spinbutton', { name: /Payment reminder after/ });
    await user.clear(days);
    await user.type(days, '120');

    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(days).toHaveAccessibleDescription('Enter a whole number of days from 1 to 90.');
    const summary = screen.getByRole('alert', { name: /Fix these before saving the settings/ });
    expect(within(summary).getByRole('link', { name: /Payment reminder after/ })).toBeInTheDocument();
    expect(summary).toHaveFocus();
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('names a recipient that is not an email address', async () => {
    const user = userEvent.setup();
    render(<StoreSettingsTab onChanged={vi.fn()} />);
    const recipients = await screen.findByRole('textbox', { name: /Extra recipients/ });
    await user.type(recipients, 'quartermaster@dept.org, not-an-email');

    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(recipients).toHaveAccessibleDescription(/Check not-an-email: each recipient must be an email address\./);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  // Forms review F-2: a refusal from the server was a toast, and the screen
  // gave no clue which of thirty boxes to fix.
  it("puts the server's refusal on the field it names", async () => {
    mockUpdateSettings.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { detail: [{ field: 'venmo_handle', message: 'A Venmo handle has only letters, digits, - and _.' }] },
      },
    });
    const user = userEvent.setup();
    render(<StoreSettingsTab onChanged={vi.fn()} />);
    const venmo = await screen.findByRole('textbox', { name: /Venmo handle/ });
    await user.clear(venmo);
    await user.type(venmo, '@dept!');

    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(venmo).toHaveAccessibleDescription('A Venmo handle has only letters, digits, - and _.'));
    expect(venmo).toHaveValue('@dept!');
    expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
  });

  it('saves on Enter, as a form', async () => {
    const user = userEvent.setup();
    render(<StoreSettingsTab onChanged={vi.fn()} />);
    const pickup = await screen.findByRole('textbox', { name: /Pickup location/ });

    await user.type(pickup, 'Station 1 bay{Enter}');

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledTimes(1));
    expect(mockUpdateSettings.mock.calls[0]?.[0]).toMatchObject({ pickupLocation: 'Station 1 bay' });
  });
});
