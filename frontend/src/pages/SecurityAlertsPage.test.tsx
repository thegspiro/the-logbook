/**
 * SEC2-28-7: security alerts had endpoints and no screen. This page lists
 * them, lets an `audit.export` holder acknowledge and resolve them, and shows
 * the export log — and must not offer actions a read-only auditor would be
 * refused, nor show "nothing waiting" over an endpoint that failed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { SecurityAlertRecord as SecurityAlert } from '../services/securityAlertsService';

const mockGetAlerts = vi.fn();
const mockAcknowledge = vi.fn();
const mockResolve = vi.fn();
const mockGetDownloadActivity = vi.fn();

vi.mock('../services/securityAlertsService', () => ({
  securityAlertsService: {
    getAlerts: (...args: unknown[]) => mockGetAlerts(...args) as unknown,
    acknowledgeAlert: (...args: unknown[]) => mockAcknowledge(...args) as unknown,
    resolveAlert: (...args: unknown[]) => mockResolve(...args) as unknown,
    getDownloadActivity: (...args: unknown[]) => mockGetDownloadActivity(...args) as unknown,
  },
}));

const mockCheckPermission = vi.fn();
const mockAuthState: Record<string, unknown> = {
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as unknown,
};
vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(mockAuthState) : mockAuthState
  ),
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import SecurityAlertsPage from './SecurityAlertsPage';

const alert = (overrides: Partial<SecurityAlert> = {}): SecurityAlert => ({
  id: 'alert-1',
  alert_type: 'brute_force',
  threat_level: 'high',
  timestamp: '2026-10-05T12:00:00Z',
  description: 'Brute force attack detected from 198.51.100.4',
  source_ip: '198.51.100.4',
  user_id: null,
  details: { failed_attempts: 10 },
  acknowledged: false,
  acknowledged_by: null,
  acknowledged_at: null,
  resolved: false,
  resolved_by: null,
  resolved_at: null,
  resolution_note: null,
  ...overrides,
});

const counts = { open: 1, unacknowledged: 1, acknowledged: 0, resolved: 0 };

describe('SecurityAlertsPage', () => {
  beforeEach(() => {
    mockGetAlerts.mockReset();
    mockAcknowledge.mockReset();
    mockResolve.mockReset();
    mockGetDownloadActivity.mockReset();
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(true);
    mockGetAlerts.mockResolvedValue({ alerts: [alert()], total: 1, counts });
    mockAcknowledge.mockResolvedValue({ status: 'acknowledged', alert_id: 'alert-1' });
    mockResolve.mockResolvedValue({ status: 'resolved', alert_id: 'alert-1' });
    mockGetDownloadActivity.mockResolvedValue({ exports: [] });
  });

  it('loads open alerts and shows what was detected', async () => {
    renderWithRouter(<SecurityAlertsPage />);
    expect(await screen.findByText('Brute-force sign-in')).toBeInTheDocument();
    expect(screen.getByText('198.51.100.4')).toBeInTheDocument();
    expect(mockGetAlerts).toHaveBeenCalledWith({ state: 'open', limit: 200 });
  });

  it('acknowledges an alert and reloads', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SecurityAlertsPage />);
    await user.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    expect(mockAcknowledge).toHaveBeenCalledWith('alert-1');
    await waitFor(() => expect(mockGetAlerts).toHaveBeenCalledTimes(2));
  });

  it('resolves with the note the officer typed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SecurityAlertsPage />);
    await user.click(await screen.findByRole('button', { name: 'Resolve' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/What did you find/), 'Member mistyped; confirmed by phone.');
    await user.click(within(dialog).getByRole('button', { name: 'Resolve alert' }));
    expect(mockResolve).toHaveBeenCalledWith('alert-1', 'Member mistyped; confirmed by phone.');
  });

  it('offers no actions to a read-only auditor', async () => {
    mockCheckPermission.mockImplementation((perm: string) => perm !== 'audit.export');
    renderWithRouter(<SecurityAlertsPage />);
    expect(await screen.findByText('Brute-force sign-in')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
  });

  it('shows who resolved an alert and why', async () => {
    mockGetAlerts.mockResolvedValue({
      alerts: [
        alert({
          acknowledged: true,
          acknowledged_by: 'chief',
          resolved: true,
          resolved_by: 'chief',
          resolved_at: '2026-10-05T13:00:00Z',
          resolution_note: 'Pen-test window',
        }),
      ],
      total: 1,
      counts: { ...counts, open: 0, unacknowledged: 0, resolved: 1 },
    });
    renderWithRouter(<SecurityAlertsPage />);
    expect(await screen.findByText(/Resolved by chief.*Pen-test window/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
  });

  it('reports a malformed response instead of an empty list', async () => {
    mockGetAlerts.mockResolvedValue('<html>captive portal</html>');
    renderWithRouter(<SecurityAlertsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/unexpected response/);
    expect(screen.queryByText('Nothing waiting')).not.toBeInTheDocument();
  });

  it('lists recorded exports on the second tab', async () => {
    const user = userEvent.setup();
    mockGetDownloadActivity.mockResolvedValue({
      exports: [
        {
          id: 7,
          timestamp: '2026-10-05T12:30:00Z',
          user_id: 'u1',
          username: 'quartermaster',
          ip_address: '203.0.113.5',
          endpoint: '/api/v1/inventory/items/export',
          method: 'GET',
          bytes: 2048,
        },
      ],
    });
    renderWithRouter(<SecurityAlertsPage />);
    await screen.findByText('Brute-force sign-in');
    await user.click(screen.getByRole('tab', { name: /Data exports/ }));
    expect(await screen.findByText('quartermaster')).toBeInTheDocument();
    expect(screen.getByText('GET /api/v1/inventory/items/export')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(mockGetDownloadActivity).toHaveBeenCalledWith(100);
  });
});
