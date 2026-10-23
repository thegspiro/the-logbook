import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetSessionSettings = vi.fn();
const mockSetKioskSession = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
const mockSignal = vi.fn();

vi.mock('../services/api', () => ({
  authService: {
    getSessionSettings: () => mockGetSessionSettings() as unknown,
    setKioskSession: (enabled: boolean) => mockSetKioskSession(enabled) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({
  default: {
    success: (m: string) => mockToastSuccess(m) as unknown,
    error: (m: string) => mockToastError(m) as unknown,
  },
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../hooks/useIdleTimer', () => ({
  signalSessionSettingsChanged: () => mockSignal() as unknown,
}));

import { KioskSessionCard } from './KioskSessionCard';

beforeEach(() => {
  mockGetSessionSettings.mockReset();
  mockSetKioskSession.mockReset();
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
  mockSignal.mockReset();
});

describe('KioskSessionCard', () => {
  it('renders nothing for a member without the permission', async () => {
    mockGetSessionSettings.mockResolvedValue({ session_timeout_minutes: 15, kiosk_available: false });
    const { container } = render(<KioskSessionCard />);
    await waitFor(() => expect(mockGetSessionSettings).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('offers to turn the kiosk session on, then reports the new limits', async () => {
    mockGetSessionSettings.mockResolvedValue({
      session_timeout_minutes: 15,
      session_ends_at: null,
      is_kiosk: false,
      kiosk_available: true,
    });
    mockSetKioskSession.mockResolvedValue({
      is_kiosk: true,
      session_timeout_minutes: 720,
      session_ends_at: '2026-10-28T12:00:00Z',
    });
    render(<KioskSessionCard />);

    await userEvent.click(await screen.findByRole('button', { name: 'Turn on kiosk session' }));

    expect(mockSetKioskSession).toHaveBeenCalledWith(true);
    expect(await screen.findByRole('button', { name: 'Turn off kiosk session' })).toBeInTheDocument();
    expect(screen.getByText(/12 hours of inactivity/)).toBeInTheDocument();
    expect(mockSignal).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith('Kiosk session on');
  });

  it('turns it back off', async () => {
    mockGetSessionSettings.mockResolvedValue({
      session_timeout_minutes: 720,
      session_ends_at: '2026-10-28T12:00:00Z',
      is_kiosk: true,
      kiosk_available: true,
    });
    mockSetKioskSession.mockResolvedValue({
      is_kiosk: false,
      session_timeout_minutes: 15,
      session_ends_at: '2026-10-22T06:00:00Z',
    });
    render(<KioskSessionCard />);

    await userEvent.click(await screen.findByRole('button', { name: 'Turn off kiosk session' }));

    expect(mockSetKioskSession).toHaveBeenCalledWith(false);
    expect(await screen.findByRole('button', { name: 'Turn on kiosk session' })).toBeInTheDocument();
  });

  it('keeps the current state and says so when the server refuses', async () => {
    mockGetSessionSettings.mockResolvedValue({
      session_timeout_minutes: 15,
      is_kiosk: false,
      kiosk_available: true,
    });
    mockSetKioskSession.mockRejectedValue(new Error('Forbidden'));
    render(<KioskSessionCard />);

    await userEvent.click(await screen.findByRole('button', { name: 'Turn on kiosk session' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Forbidden'));
    expect(screen.getByRole('button', { name: 'Turn on kiosk session' })).toBeInTheDocument();
    expect(mockSignal).not.toHaveBeenCalled();
  });
});
