import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockLogout = vi.fn();
const mockNavigate = vi.fn();
const mockGetSessionSettings = vi.fn();

vi.mock('react-router', () => ({ useNavigate: () => mockNavigate }));
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { dismiss: vi.fn() }),
}));
vi.mock('../utils/apiCache', () => ({ clearCache: vi.fn() }));
vi.mock('../services/api', () => ({
  authService: { getSessionSettings: () => mockGetSessionSettings() as unknown },
}));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ logout: mockLogout, isAuthenticated: true }),
}));

import { useIdleTimer, signalUserActivity, USER_ACTIVITY_EVENT } from './useIdleTimer';

const TIMEOUT_MINUTES = 15;
const TIMEOUT_MS = TIMEOUT_MINUTES * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSessionSettings.mockResolvedValue({ session_timeout_minutes: TIMEOUT_MINUTES });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Let the session-settings promise resolve so the timers are armed. */
async function armTimers() {
  await vi.advanceTimersByTimeAsync(0);
}

describe('useIdleTimer', () => {
  it('logs out after the configured idle period', async () => {
    renderHook(() => useIdleTimer());
    await armTimers();

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1000);

    expect(mockLogout).toHaveBeenCalled();
  });

  it('keeps the session alive when a surface signals activity', async () => {
    // An NFC tap fires no mouse, key, scroll or touch event, so a check-in
    // station in constant use looked idle and logged itself out mid-drill.
    renderHook(() => useIdleTimer());
    await armTimers();

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 60_000);
    signalUserActivity();
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 60_000);

    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('still times out a station nobody is tapping', async () => {
    // A reset, not an exemption: the control exists for exactly this state —
    // an authenticated session left unattended in a bay, showing the names of
    // everyone who has checked in.
    renderHook(() => useIdleTimer());
    await armTimers();

    signalUserActivity();
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1000);

    expect(mockLogout).toHaveBeenCalled();
  });

  it('is reset by ordinary DOM input too', async () => {
    renderHook(() => useIdleTimer());
    await armTimers();

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 60_000);
    document.dispatchEvent(new Event('mousedown'));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 60_000);

    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('signals through a custom event, never a synthetic keystroke', () => {
    // A fake `keydown` would also reach every other keyboard listener on the
    // page — including the station's USB-reader capture, which would read it
    // as part of a card serial.
    const onKeyDown = vi.fn();
    const onCustom = vi.fn();
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener(USER_ACTIVITY_EVENT, onCustom);

    signalUserActivity();

    expect(onCustom).toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();

    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener(USER_ACTIVITY_EVENT, onCustom);
  });

  it('stops listening once unmounted', async () => {
    const { unmount } = renderHook(() => useIdleTimer());
    await armTimers();
    unmount();

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1000);

    expect(mockLogout).not.toHaveBeenCalled();
  });
});
